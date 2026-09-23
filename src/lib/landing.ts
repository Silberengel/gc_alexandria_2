import type { Event, Filter } from 'nostr-tools';
import { KIND } from './constants';
import { GITCITADEL_CURATOR_HEX } from './hex';
import { humanizeTag } from './cover-fallback';
import { landingLabels } from './labels';
import {
  LIBRARY_KIND_TAGS,
  addressPath,
  isLibraryHighlight,
  libraryAddresses,
  newestCommentPerWork,
  newestHighlightPerAddress,
  parseAddress,
  referencedLibraryAddress,
  referencedSectionAddress
} from './library-scope';
import { displayTitle } from './metadata';
import { followPubkeysFromMetadata } from './mute';
import { newestRatingPerPublication } from './ratings';
import {
  cacheGetLandingSnapshot,
  cachePutLandingSnapshot,
  cacheScanByKind,
  type LandingShelfSnap,
  type LandingSnapshot
} from './nostr/cache';
import { fetchByAddress, fetchByIds, poolMap } from './nostr/fetch';
import { mercuryFilter } from './nostr/mercury';
import { relayPool } from './nostr/pool';
import { documentStack, highlightStack, socialStack } from './nostr/selector';
import { cacheFindByAddress } from './nostr/cache';
import { memoryFindByAddress } from './nostr/event-memory';
import { eventAddress, isTopLevel30040 } from './nostr/verify';
import { assignShelves, isViewerBoundShelfId, membershipsFromEvents, nestedShelvesForViewer, SHELF_TITLES, type Membership, type Shelf } from './shelves';
import { session } from './stores/session';

export type LandingView = LandingSnapshot & {
  subjects: string[];
  shelves: LandingShelfSnap[];
  labels: string[];
  viewerPubkey?: string | null;
};

function currentViewerPubkey(): string | null {
  return session.getPubkey()?.toLowerCase() ?? null;
}

function sameViewer(cached: LandingView | LandingSnapshot | null | undefined, viewer: string | null): boolean {
  if (!cached) return false;
  // Legacy snapshots without viewerPubkey are treated as anonymous-only.
  const cachedViewer = cached.viewerPubkey === undefined ? null : cached.viewerPubkey;
  return (cachedViewer ?? null) === (viewer ?? null);
}

function landingHasPaint(view: LandingView | LandingSnapshot): boolean {
  return !!(
    view.publications?.length ||
    view.highlights?.length ||
    view.comments?.length ||
    (view.ratings?.length ?? 0) ||
    (view.shelves ?? []).some((s) => s.events.length) ||
    (view.labels?.length ?? 0)
  );
}

function shelvesHaveCovers(shelves: LandingShelfSnap[] | undefined): boolean {
  return (shelves ?? []).some((s) => s.events.length > 0);
}

/**
 * Persist as soon as we have something to show — do not wait for resolveReferenced.
 * Never replace a snapshot that has shelf covers with a later paint that only has feeds.
 */
function persistLandingSoon(view: LandingView): void {
  if (!landingHasPaint(view)) return;
  void (async () => {
    try {
      const prev = await cacheGetLandingSnapshot();
      const shelves =
        shelvesHaveCovers(view.shelves) || !shelvesHaveCovers(prev?.shelves)
          ? (view.shelves ?? [])
          : (prev?.shelves ?? []);
      const ratings =
        (view.ratings?.length ?? 0) > 0 ? view.ratings : (prev?.ratings ?? view.ratings ?? []);
      const labels =
        (view.labels?.length ?? 0) > 0 ? view.labels : (prev?.labels ?? view.labels ?? []);
      await cachePutLandingSnapshot({
        ...view,
        shelves,
        ratings,
        labels
      });
    } catch {
      /* private mode / quota */
    }
  })();
}

export const LANDING_FEED_LIMIT = 10;

export function subjectsFromPublications(publications: Event[]): string[] {
  const subjectCounts = new Map<string, number>();
  for (const p of publications) {
    for (const t of p.tags.filter((x) => x[0] === 't' && x[1])) {
      subjectCounts.set(t[1]!, (subjectCounts.get(t[1]!) ?? 0) + 1);
    }
  }
  return [...subjectCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([t]) => t);
}

export function preferLive<T>(live: T[], cached: T[] | undefined): T[] {
  return live.length ? live : (cached ?? []);
}

function mergeEvents(...lists: Event[][]): Event[] {
  const byId = new Map<string, Event>();
  for (const list of lists) {
    for (const event of list) byId.set(event.id, event);
  }
  return [...byId.values()];
}

/**
 * Progressive landing paints often replace a full shelf set with a thinner intermediate
 * (e.g. My shelf only). Union shelves/events so the UI does not flicker fewer→more→fewer.
 * Callers should still replace wholesale on identity change or final snapshot.
 */
export function mergeLandingShelves(
  prev: LandingShelfSnap[],
  next: LandingShelfSnap[]
): LandingShelfSnap[] {
  if (!prev.length) return next;
  if (!next.length) return prev;
  const prevById = new Map(prev.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: LandingShelfSnap[] = [];
  for (const shelf of next) {
    seen.add(shelf.id);
    const older = prevById.get(shelf.id);
    out.push(
      older
        ? {
            ...shelf,
            events: mergeEvents(older.events, shelf.events)
          }
        : shelf
    );
  }
  for (const shelf of prev) {
    if (!seen.has(shelf.id)) out.push(shelf);
  }
  return out;
}

function settled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === 'fulfilled' ? result.value : fallback;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const current = out[i]!;
    out[i] = out[j]!;
    out[j] = current;
  }
  return out;
}

function byNewest(a: Event, b: Event): number {
  if (b.created_at !== a.created_at) return b.created_at - a.created_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Fewer than 10: all items, newest first.
 * 10+: pin the 3 newest, shuffle the rest with a UNIX-timestamp seed.
 */
export function orderShelfCovers(events: Event[], unixSeconds: number): Event[] {
  const newest = [...events].sort(byNewest);
  if (newest.length < 10) return newest;
  return [...newest.slice(0, 3), ...shuffle(newest.slice(3), unixSeconds)];
}

export function withSubjects(snap: LandingSnapshot): LandingView {
  return {
    ...snap,
    referenced: snap.referenced ?? [],
    shelves: snap.shelves ?? [],
    labels: snap.labels ?? [],
    ratings: snap.ratings ?? [],
    subjects: subjectsFromPublications(snap.publications)
  };
}

export function titleForAddress(coord: string, referenced: Event[]): string {
  if (!coord) return 'Untitled';
  const hit = referenced.find((e) => eventAddress(e) === coord);
  if (hit) return displayTitle(hit);
  const parsed = parseAddress(coord);
  if (parsed?.d) return humanizeTag(parsed.d);
  return 'Untitled';
}

function publicationsListing(coord: string, referenced: Event[]): Event[] {
  return referenced.filter(
    (event) =>
      event.kind === KIND.PUBLICATION && event.tags.some((t) => t[0] === 'a' && t[1] === coord)
  );
}

/** Walk nested 30040 indexes until the top-level edition (same publisher). */
export function topLevelPublicationAddress(coord: string | null, referenced: Event[]): string | null {
  if (!coord) return null;
  const parsed = parseAddress(coord);
  if (!parsed) return null;
  if (parsed.kind === KIND.WIKI || parsed.kind === KIND.SPEC) return coord;

  const pubs = referenced.filter((e) => e.kind === KIND.PUBLICATION);
  let current = coord;
  let currentPk = parsed.pubkey;
  for (let i = 0; i < 5; i++) {
    const parents = publicationsListing(current, referenced);
    if (!parents.length) {
      return parseAddress(current)?.kind === KIND.PUBLICATION ? current : null;
    }
    const sameAuthor = parents.filter((p) => p.pubkey === currentPk);
    const pool = sameAuthor.length ? sameAuthor : parents;
    const top = pool.find((p) => isTopLevel30040(p, pubs)) ?? pool[0]!;
    current = eventAddress(top);
    currentPk = top.pubkey;
    if (!sameAuthor.length || isTopLevel30040(top, pubs)) return current;
  }
  return current;
}

export function displayRefTitle(event: Event, referenced: Event[]): string {
  const section = referencedSectionAddress(event);
  const work = referencedLibraryAddress(event);
  const top =
    topLevelPublicationAddress(section ?? work, referenced) ??
    (work && parseAddress(work)?.kind !== KIND.SECTION ? work : null);

  if (section) {
    const pubTitle = top ? titleForAddress(top, referenced) : '';
    const secTitle = titleForAddress(section, referenced);
    if (pubTitle && secTitle && pubTitle !== secTitle) return `${pubTitle}: ${secTitle}`;
    return pubTitle || secTitle || 'Untitled';
  }
  if (top) return titleForAddress(top, referenced);
  if (work) return titleForAddress(work, referenced);
  return 'Untitled';
}

export function publisherForAddress(coord: string, referenced: Event[]): string {
  const hit = referenced.find((e) => eventAddress(e) === coord);
  if (hit) return hit.pubkey;
  return parseAddress(coord)?.pubkey ?? '';
}

/** Path to the work page top (no deep-link query). */
export function pathForRef(event: Event, referenced: Event[]): string | null {
  const work = referencedLibraryAddress(event);
  const section = referencedSectionAddress(event);
  const top = topLevelPublicationAddress(section ?? work, referenced);
  return addressPath(top ?? work ?? '');
}

/** Path that opens/scrolls to this highlight, review, or comment on the work page. */
export function focusHrefForRef(event: Event, referenced: Event[]): string | null {
  const path = pathForRef(event, referenced);
  if (!path) return null;
  const params = new URLSearchParams();
  if (event.kind === KIND.COMMENT || event.kind === KIND.TEXT_NOTE) {
    params.set('comment', event.id.toLowerCase());
  } else if (event.kind === KIND.RATING) {
    params.set('rating', event.id.toLowerCase());
  } else if (event.kind === KIND.HIGHLIGHT) {
    const section = referencedSectionAddress(event);
    if (section) params.set('section', section);
    const q = event.content.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (q) params.set('quote', q);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** @deprecated Prefer {@link pathForRef} (title) or {@link focusHrefForRef} (View …). */
export function hrefForRef(event: Event, referenced: Event[]): string | null {
  return focusHrefForRef(event, referenced);
}

async function fetchContainingPublication(childAddr: string, hops = 0): Promise<Event | null> {
  if (hops > 4) return null;
  const parsed = parseAddress(childAddr);
  if (!parsed || (parsed.kind !== KIND.SECTION && parsed.kind !== KIND.PUBLICATION)) return null;
  const filter: Filter = { kinds: [KIND.PUBLICATION], '#a': [childAddr], limit: 5 };
  const mercury = await mercuryFilter(filter);
  const hits = mercury.length ? mercury : await relayPool.query(documentStack(), [filter]);
  if (!hits.length) return null;
  const sameAuthor = hits.filter(
    (event) => event.pubkey === parsed.pubkey && eventAddress(event) !== childAddr
  );
  const first =
    sameAuthor[0] ?? hits.find((event) => eventAddress(event) !== childAddr) ?? null;
  if (!first) return null;
  if (first.pubkey !== parsed.pubkey) return first;
  const higher = await fetchContainingPublication(eventAddress(first), hops + 1);
  return higher ?? first;
}

export async function resolveReferenced(events: Event[], known: Event[]): Promise<Event[]> {
  const needed = new Set<string>();
  for (const event of events) {
    for (const addr of libraryAddresses(event)) needed.add(addr);
  }
  const byAddr = new Map<string, Event>();
  for (const event of known) byAddr.set(eventAddress(event), event);

  const missing = [...needed].filter((addr) => !byAddr.has(addr)).slice(0, 40);
  if (missing.length) {
    const fetched = await poolMap(missing, 3, fetchByAddress);
    for (const event of fetched) {
      if (event) byAddr.set(eventAddress(event), event);
    }
  }

  const children = [...needed].filter((addr) => {
    const parsed = parseAddress(addr);
    return parsed && (parsed.kind === KIND.SECTION || parsed.kind === KIND.PUBLICATION);
  });
  const parents = await poolMap(children.slice(0, 12), 2, fetchContainingPublication);
  for (const event of parents) {
    if (!event) continue;
    byAddr.set(eventAddress(event), event);
    needed.add(eventAddress(event));
  }

  return [...needed].flatMap((addr) => {
    const event = byAddr.get(addr);
    return event ? [event] : [];
  });
}

const COMMENT_FILTERS: Filter[] = [
  { kinds: [KIND.COMMENT], '#K': LIBRARY_KIND_TAGS, limit: 100 },
  { kinds: [KIND.COMMENT], '#k': LIBRARY_KIND_TAGS, limit: 100 }
];

const HIGHLIGHT_FILTERS: Filter[] = [
  { kinds: [KIND.HIGHLIGHT], '#k': LIBRARY_KIND_TAGS, limit: 100 },
  { kinds: [KIND.HIGHLIGHT], '#K': LIBRARY_KIND_TAGS, limit: 100 }
];

const RATING_FILTERS: Filter[] = [
  { kinds: [KIND.RATING], '#k': [String(KIND.PUBLICATION)], limit: 100 },
  { kinds: [KIND.RATING], '#K': [String(KIND.PUBLICATION)], limit: 100 },
  { kinds: [KIND.RATING], '#m': ['book'], limit: 100 }
];

function landingRatings(...lists: Event[][]): Event[] {
  return newestRatingPerPublication(mergeEvents(...lists)).slice(0, LANDING_FEED_LIMIT);
}

async function resolveShelfPublications(memberships: Membership[], known: Event[]): Promise<Map<string, Event>> {
  const byAddr = new Map<string, Event>();
  for (const event of known) {
    if (event.kind === KIND.PUBLICATION) byAddr.set(eventAddress(event), event);
  }

  const missingAddrs = [
    ...new Set(memberships.flatMap((m) => (m.address && !byAddr.has(m.address) ? [m.address] : [])))
  ].slice(0, 80);

  // Local cache/memory first — My shelf should paint without waiting on relays.
  await poolMap(missingAddrs, 8, async (addr) => {
    const parsed = parseAddress(addr);
    if (!parsed || parsed.kind !== KIND.PUBLICATION) return;
    let event = memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d);
    if (!event) {
      try {
        event = await cacheFindByAddress(parsed.kind, parsed.pubkey, parsed.d);
      } catch {
        event = null;
      }
    }
    if (event?.kind === KIND.PUBLICATION) byAddr.set(eventAddress(event), event);
  });

  // Batch remaining by author — one Mercury/WS round-trip per author, not per address.
  type AuthorGroup = { pubkey: string; ds: string[] };
  const groups = new Map<string, AuthorGroup>();
  for (const addr of missingAddrs) {
    if (byAddr.has(addr)) continue;
    const parsed = parseAddress(addr);
    if (!parsed || parsed.kind !== KIND.PUBLICATION) continue;
    const g = groups.get(parsed.pubkey) ?? { pubkey: parsed.pubkey, ds: [] };
    if (!g.ds.includes(parsed.d)) g.ds.push(parsed.d);
    groups.set(parsed.pubkey, g);
  }

  // Shelf covers must win against feed/reference queries — keep concurrency modest but
  // give each author group enough relay wait time (2s was starving under pool contention).
  await poolMap([...groups.values()], 3, async (group) => {
    const dValues = group.ds.slice(0, 40);
    if (!dValues.length) return;
    const filter = {
      kinds: [KIND.PUBLICATION],
      authors: [group.pubkey],
      '#d': dValues,
      limit: Math.min(100, dValues.length)
    };
    try {
      for (const event of await mercuryFilter(filter)) {
        if (event.kind === KIND.PUBLICATION) byAddr.set(eventAddress(event), event);
      }
    } catch {
      /* mercury soft-fail */
    }
    const still = dValues.filter((d) => !byAddr.has(`${KIND.PUBLICATION}:${group.pubkey}:${d}`));
    if (!still.length) return;
    try {
      const ws = await relayPool.query(
        documentStack(),
        [{ kinds: [KIND.PUBLICATION], authors: [group.pubkey], '#d': still, limit: still.length }],
        4500,
        4
      );
      for (const event of ws) {
        if (event.kind === KIND.PUBLICATION) byAddr.set(eventAddress(event), event);
      }
    } catch {
      /* relay soft-fail */
    }
  });

  const missingIds = [...new Set(memberships.flatMap((m) => (m.eventId ? [m.eventId] : [])))];
  const byId = new Map((await fetchByIds(missingIds.slice(0, 40), 6)).map((e) => [e.id, e]));
  for (const membership of memberships) {
    if (membership.address) continue;
    if (!membership.eventId) continue;
    const event = byId.get(membership.eventId);
    if (event?.kind === KIND.PUBLICATION) {
      membership.address = eventAddress(event);
      byAddr.set(membership.address, event);
    }
  }
  return byAddr;
}

type ShelfMembershipPack = {
  liveLabels: Event[];
  liveBookmarks: Event[];
  liveDirs: Event[];
};

const EMPTY_MEMBERSHIP: ShelfMembershipPack = {
  liveLabels: [],
  liveBookmarks: [],
  liveDirs: []
};

/** Labels/bookmarks/directories for landing shelves — started in parallel with feed queries. */
async function fetchShelfMembershipEvents(): Promise<ShelfMembershipPack> {
  const social = socialStack();
  const document = documentStack();
  const curator = GITCITADEL_CURATOR_HEX;
  const [socialLabels, socialCuratorLabels, bookmarkWs, dirWs] = await Promise.allSettled([
    // Labels / bookmarks / directories are social — Mercury only indexes document kinds.
    relayPool.query(social, [{ kinds: [KIND.LABEL], limit: 80 }], 2500),
    // GitCitadel shelf membership is curator-authored; pin that author so new labels show up on refresh.
    relayPool.query(social, [{ kinds: [KIND.LABEL], authors: [curator], limit: 100 }], 2500),
    relayPool.query(social, [{ kinds: [KIND.BOOKMARK], limit: 80 }], 2500),
    relayPool.query(document, [{ kinds: [KIND.DIRECTORY], limit: 80 }], 2500)
  ]);
  return {
    liveLabels: mergeEvents(settled(socialLabels, []), settled(socialCuratorLabels, [])),
    liveBookmarks: settled(bookmarkWs, []),
    liveDirs: settled(dirWs, [])
  };
}

async function loadShelvesAndLabels(
  knownPubs: Event[],
  cached?: LandingView | null,
  membership?: ShelfMembershipPack
): Promise<{ shelves: LandingShelfSnap[]; labels: string[] }> {
  // Signed-in: wait briefly for login lists so "My shelf" is not skipped on the first paint.
  const viewerEarly = session.getPubkey();
  if (viewerEarly && !session.getMetadata().length) {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        unsub();
        clearTimeout(timer);
        resolve();
      };
      const unsub = session.metadata.subscribe((events) => {
        if (events.length) finish();
      });
      const timer = setTimeout(finish, 6_000);
      if (session.getMetadata().length) finish();
    });
  }

  const mine = session.getMetadata();
  const pack = membership ?? (await fetchShelfMembershipEvents());
  const { liveLabels, liveBookmarks, liveDirs } = pack;
  const mineDirs = mine.filter((e) => e.kind === KIND.DIRECTORY);
  const combined = mergeEvents(liveLabels, liveBookmarks, liveDirs, mine);
  const memberships = membershipsFromEvents(combined);
  const publications = await resolveShelfPublications(memberships, [
    ...knownPubs,
    ...(cached?.shelves ?? []).flatMap((s) => s.events)
  ]);
  const viewer = session.getPubkey();
  const follows = followPubkeysFromMetadata(mine);
  const shelves: Shelf[] = assignShelves(memberships, publications, viewer, follows);
  const nested =
    viewer != null
      ? nestedShelvesForViewer(mergeEvents(liveDirs, mineDirs), publications, viewer)
      : [];
  const labels = landingLabels(liveLabels.length ? liveLabels : combined);
  let viewerNpub = '';
  if (viewer) {
    try {
      const { nip19 } = await import('nostr-tools');
      viewerNpub = nip19.npubEncode(viewer);
    } catch {
      viewerNpub = '';
    }
  }
  const shelfSnaps: LandingShelfSnap[] = [
    ...shelves.map((s) => ({ id: s.id, title: s.title, events: s.events })),
    ...nested.map((s) => ({
      id: s.id,
      title: s.title,
      events: s.events,
      href: `/search?bookshelf=${encodeURIComponent(s.d)}${viewerNpub ? `&npub=${viewerNpub}` : ''}`
    }))
  ];
  return {
    shelves: shelfSnaps,
    labels
  };
}

/**
 * Rebuild shelves from the signed-in viewer's login lists (bookmarks / labels / 30045).
 * Used after metadata arrives so "My shelf" does not wait on a full landing refresh.
 */
export async function loadViewerShelves(
  knownPubs: Event[] = []
): Promise<{ shelves: LandingShelfSnap[]; labels: string[] }> {
  return loadShelvesAndLabels(knownPubs, null, EMPTY_MEMBERSHIP);
}

export async function loadCachedLanding(): Promise<LandingView | null> {
  const viewer = currentViewerPubkey();
  const snap = await cacheGetLandingSnapshot();
  const snapForViewer = sameViewer(snap, viewer)
    ? snap
    : snap
      ? {
          ...snap,
          viewerPubkey: viewer,
          // Never reuse another identity's mine/follows/folder shelves.
          shelves: (snap.shelves ?? []).filter((s) => !isViewerBoundShelfId(s.id))
        }
      : null;

  if (
    snapForViewer &&
    (snapForViewer.publications.length ||
      snapForViewer.highlights.length ||
      snapForViewer.comments.length ||
      (snapForViewer.ratings?.length ?? 0) ||
      (snapForViewer.shelves ?? []).some((s) => s.events.length) ||
      (snapForViewer.labels?.length ?? 0))
  ) {
    return withSubjects({
      ...snapForViewer,
      viewerPubkey: viewer,
      highlights: newestHighlightPerAddress(snapForViewer.highlights).slice(0, LANDING_FEED_LIMIT),
      comments: newestCommentPerWork(snapForViewer.comments).slice(0, LANDING_FEED_LIMIT),
      ratings: landingRatings(snapForViewer.ratings ?? []),
      shelves: snapForViewer.shelves ?? [],
      labels: snapForViewer.labels ?? []
    });
  }

  const [publications, rawHighlights, rawComments, rawRatings] = await Promise.all([
    cacheScanByKind(KIND.PUBLICATION, 50),
    cacheScanByKind(KIND.HIGHLIGHT, 100),
    cacheScanByKind(KIND.COMMENT, 100),
    cacheScanByKind(KIND.RATING, 100)
  ]);
  if (!publications.length && !rawHighlights.length && !rawComments.length && !rawRatings.length) {
    return null;
  }

  const highlights = newestHighlightPerAddress(rawHighlights).slice(0, LANDING_FEED_LIMIT);
  const comments = newestCommentPerWork(rawComments).slice(0, LANDING_FEED_LIMIT);
  const ratings = landingRatings(rawRatings);
  // Never await resolveReferenced here — it contends for relay slots and delayed first paint
  // by minutes on cold IndexedDB. Titles hydrate on the live refresh path.
  return withSubjects({
    viewerPubkey: viewer,
    publications,
    highlights,
    comments,
    ratings,
    referenced: snapForViewer?.referenced ?? [],
    shelves: [],
    labels: snapForViewer?.labels ?? []
  });
}

export async function refreshLanding(
  cached: LandingView | null,
  onUpdate?: (view: LandingView) => void
): Promise<LandingView> {
  const viewer = currentViewerPubkey();
  const cacheOk = sameViewer(cached, viewer);

  // Membership + social feeds are WSS only — Mercury indexes document kinds only.
  const membershipPromise = fetchShelfMembershipEvents();
  const feedWsPromise = Promise.all([
    relayPool.query(socialStack(), COMMENT_FILTERS, 4000),
    relayPool.query(highlightStack(), HIGHLIGHT_FILTERS, 4000),
    relayPool.query(socialStack(), RATING_FILTERS, 4000)
  ]);

  const [pubsResult, wikiResult] = await Promise.allSettled([
    mercuryFilter({ kinds: [KIND.PUBLICATION], limit: 50 }),
    mercuryFilter({ kinds: [KIND.WIKI, KIND.SPEC], limit: 50 })
  ]);

  const publications = preferLive(
    mergeEvents(settled(pubsResult, []), settled(wikiResult, [])),
    cacheOk ? cached?.publications : undefined
  );

  let comments = newestCommentPerWork(cacheOk ? (cached?.comments ?? []) : []).slice(
    0,
    LANDING_FEED_LIMIT
  );
  let highlights = newestHighlightPerAddress(cacheOk ? (cached?.highlights ?? []) : []).slice(
    0,
    LANDING_FEED_LIMIT
  );
  let ratings = landingRatings(cacheOk ? (cached?.ratings ?? []) : []);
  let shelves = cacheOk ? (cached?.shelves ?? []) : [];
  let labels = cacheOk ? (cached?.labels ?? []) : [];
  let referenced = cacheOk ? (cached?.referenced ?? []) : [];

  const paint = (partial: LandingView): void => {
    onUpdate?.(partial);
    persistLandingSoon(partial);
  };

  const snapshot = (): LandingView =>
    withSubjects({
      viewerPubkey: viewer,
      publications,
      comments,
      highlights,
      ratings,
      referenced,
      shelves,
      labels
    });

  paint(snapshot());

  // Immediate covers from Mercury pubs while label membership resolves (~5–8s).
  if (!shelvesHaveCovers(shelves) && publications.some((e) => e.kind === KIND.PUBLICATION)) {
    shelves = [
      {
        id: 'network',
        title: SHELF_TITLES.network,
        events: publications.filter((e) => e.kind === KIND.PUBLICATION).slice(0, 50)
      }
    ];
    paint(snapshot());
  }

  // Resolve shelves as soon as membership returns — do not wait on slow social feed queries.
  const shelvesPromise = membershipPromise.then((membership) =>
    loadShelvesAndLabels(publications, cacheOk ? cached : null, membership)
  );
  void shelvesPromise.then((pack) => {
    if (!shelvesHaveCovers(pack.shelves) && !pack.labels.length) return;
    // Merge — never replace, or a late membership pack wipes My shelf from minePack.
    if (shelvesHaveCovers(pack.shelves)) shelves = mergeLandingShelves(shelves, pack.shelves);
    if (pack.labels.length) labels = pack.labels;
    paint(snapshot());
  });

  // My shelf from login metadata — resolve in parallel with social membership (not after).
  const minePackPromise =
    viewer && session.getMetadata().length
      ? loadShelvesAndLabels(publications, cacheOk ? cached : null, EMPTY_MEMBERSHIP)
      : Promise.resolve(null);

  const [[commWs, highWs, rateWs], minePack] = await Promise.all([
    feedWsPromise,
    minePackPromise
  ]);

  if (minePack && shelvesHaveCovers(minePack.shelves)) {
    shelves = mergeLandingShelves(shelves, minePack.shelves);
    if (minePack.labels.length) labels = minePack.labels;
    paint(snapshot());
  }

  comments = newestCommentPerWork(
    mergeEvents(commWs, cacheOk ? (cached?.comments ?? []) : [])
  ).slice(0, LANDING_FEED_LIMIT);
  highlights = newestHighlightPerAddress(
    mergeEvents(highWs, cacheOk ? (cached?.highlights ?? []) : [])
  ).slice(0, LANDING_FEED_LIMIT);
  ratings = landingRatings(rateWs, cacheOk ? (cached?.ratings ?? []) : []);
  paint(snapshot());

  const shelfPack = await shelvesPromise;
  if (shelvesHaveCovers(shelfPack.shelves)) {
    shelves = mergeLandingShelves(shelves, shelfPack.shelves);
  } else if (!shelvesHaveCovers(shelves) && publications.length) {
    // Last resort: show recent Mercury/cache pubs so the landing is never shelf-less.
    shelves = [
      {
        id: 'network',
        title: SHELF_TITLES.network,
        events: publications.filter((e) => e.kind === KIND.PUBLICATION).slice(0, 50)
      }
    ];
  }
  if (shelfPack.labels.length) labels = shelfPack.labels;
  paint(snapshot());

  referenced = await resolveReferenced(
    [...highlights, ...comments, ...ratings],
    [...publications, ...(cacheOk ? (cached?.referenced ?? []) : []), ...shelves.flatMap((s) => s.events)]
  );

  const view = snapshot();
  paint(view);
  return view;
}

/**
 * After the viewer publishes a highlight, fold it into the landing snapshot so Home
 * shows it without waiting on Mercury/relay refresh.
 */
export async function ingestLocalLandingHighlight(
  highlight: Event,
  work?: Event | null
): Promise<void> {
  if (!isLibraryHighlight(highlight)) return;
  const viewer = currentViewerPubkey();
  let snap: LandingSnapshot | null = null;
  try {
    snap = await cacheGetLandingSnapshot();
  } catch {
    snap = null;
  }
  if (snap && !sameViewer(snap, viewer)) {
    snap = {
      viewerPubkey: viewer,
      publications: snap.publications ?? [],
      highlights: [],
      comments: snap.comments ?? [],
      ratings: snap.ratings ?? [],
      referenced: snap.referenced ?? [],
      shelves: (snap.shelves ?? []).filter((s) => !isViewerBoundShelfId(s.id)),
      labels: []
    };
  }
  const base: LandingSnapshot = snap ?? {
    viewerPubkey: viewer,
    publications: [],
    highlights: [],
    comments: [],
    ratings: [],
    referenced: [],
    shelves: [],
    labels: []
  };
  const highlights = newestHighlightPerAddress(
    mergeEvents([highlight], base.highlights ?? [])
  ).slice(0, LANDING_FEED_LIMIT);
  const referenced = [...(base.referenced ?? [])];
  if (work?.id) {
    const byId = new Map(referenced.map((e) => [e.id, e]));
    byId.set(work.id, work);
    // Section highlight titles need the parent edition in `referenced`.
    referenced.length = 0;
    referenced.push(...byId.values());
  }
  const view = withSubjects({
    ...base,
    viewerPubkey: viewer,
    highlights,
    referenced
  });
  await cachePutLandingSnapshot(view);
}
