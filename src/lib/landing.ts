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
import { newestRatingPerPublication, PUBLICATION_RATING_MARKS } from './ratings';
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
import {
  documentStack,
  highlightStack,
  publicationSearchStack,
  socialStack,
  viewerOutboxStack
} from './nostr/selector';
import { memoryFindByAddress, rememberEvents } from './nostr/event-memory';
import { warmAddress, warmNavEvent } from './nav-warm';
import { eventAddress, isTopLevel30040 } from './nostr/verify';
import { assignShelves, isViewerBoundShelfId, membershipsFromEvents, nestedShelvesForViewer, SHELF_TITLES, type Membership, type Shelf } from './shelves';
import { session } from './stores/session';

export type LandingView = LandingSnapshot & {
  subjects: string[];
  shelves: LandingShelfSnap[];
  labels: string[];
  viewerPubkey?: string | null;
};

export { warmAddress, warmNavEvent } from './nav-warm';

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

/**
 * Seed event-memory before SPA nav so Publication/Wiki paint without a relay round-trip.
 * Prefer resolved `referenced` hits; also re-assert any matching address already in memory (shelves).
 */
export function warmLandingRef(event: Event, referenced: Event[]): void {
  const work = referencedLibraryAddress(event);
  const section = referencedSectionAddress(event);
  const top = topLevelPublicationAddress(section ?? work, referenced);
  const coords = [top, work, section].filter((c): c is string => !!c);
  const hits = referenced.filter((e) => coords.includes(eventAddress(e)));
  const fromMem: Event[] = [];
  for (const coord of coords) {
    const hit = warmAddress(coord);
    if (hit) fromMem.push(hit);
  }
  const pooled = [...hits, ...fromMem, event];
  rememberEvents(pooled);
  const paint =
    (top && pooled.find((e) => eventAddress(e) === top)) ||
    (work && pooled.find((e) => eventAddress(e) === work)) ||
    pooled.find((e) => e.kind === KIND.PUBLICATION) ||
    null;
  if (paint) warmNavEvent(paint);
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
  { kinds: [KIND.RATING], '#m': [...PUBLICATION_RATING_MARKS], limit: 100 }
];

function landingRatings(...lists: Event[][]): Event[] {
  return newestRatingPerPublication(mergeEvents(...lists)).slice(0, LANDING_FEED_LIMIT);
}

/** Relay hints from `["a", coord, relayUrl]` on bookmark/label/directory events. */
function relayHintsForAddresses(events: Event[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const event of events) {
    for (const tag of event.tags) {
      if (tag[0] !== 'a' || !tag[1] || !tag[2]) continue;
      const hint = tag[2].trim();
      if (!/^wss?:\/\//i.test(hint)) continue;
      const list = out.get(tag[1]) ?? [];
      if (!list.includes(hint)) list.push(hint);
      out.set(tag[1], list);
    }
  }
  return out;
}

async function resolveShelfPublications(
  memberships: Membership[],
  known: Event[],
  opts?: {
    networkBudgetMs?: number;
    maxAddrs?: number;
    maxGroups?: number;
    hintEvents?: Event[];
  }
): Promise<Map<string, Event>> {
  const byAddr = new Map<string, Event>();
  for (const event of known) {
    if (event.kind === KIND.PUBLICATION) byAddr.set(eventAddress(event), event);
  }

  const maxAddrs = opts?.maxAddrs ?? 24;
  const maxGroups = opts?.maxGroups ?? 4;
  const networkBudgetMs = opts?.networkBudgetMs ?? 6_000;

  const missingAddrs = [
    ...new Set(memberships.flatMap((m) => (m.address && !byAddr.has(m.address) ? [m.address] : [])))
  ].slice(0, maxAddrs);

  const hints = relayHintsForAddresses(opts?.hintEvents ?? []);

  const run = async (): Promise<void> => {
    // Fast local only — never O(n) Cache Storage scans per address (that hung My shelf).
    let landing: LandingSnapshot | null = null;
    try {
      landing = await cacheGetLandingSnapshot();
    } catch {
      landing = null;
    }
    const landingPool: Event[] = [];
    if (landing) {
      landingPool.push(...(landing.publications ?? []));
      landingPool.push(...(landing.referenced ?? []));
      for (const shelf of landing.shelves ?? []) landingPool.push(...shelf.events);
    }
    for (const addr of missingAddrs) {
      if (byAddr.has(addr)) continue;
      const parsed = parseAddress(addr);
      if (!parsed || parsed.kind !== KIND.PUBLICATION) continue;
      let event = memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d);
      if (!event) {
        for (const e of landingPool) {
          if (e.kind !== KIND.PUBLICATION) continue;
          if (eventAddress(e) === addr) {
            event = e;
            break;
          }
        }
      }
      if (event?.kind === KIND.PUBLICATION) byAddr.set(addr, event);
    }

    type AuthorGroup = { pubkey: string; ds: string[]; hintRelays: string[] };
    const groups = new Map<string, AuthorGroup>();
    for (const addr of missingAddrs) {
      if (byAddr.has(addr)) continue;
      const parsed = parseAddress(addr);
      if (!parsed || parsed.kind !== KIND.PUBLICATION) continue;
      const g = groups.get(parsed.pubkey) ?? { pubkey: parsed.pubkey, ds: [], hintRelays: [] };
      if (!g.ds.includes(parsed.d)) g.ds.push(parsed.d);
      for (const url of hints.get(addr) ?? []) {
        if (!g.hintRelays.includes(url)) g.hintRelays.push(url);
      }
      groups.set(parsed.pubkey, g);
    }

    await poolMap([...groups.values()].slice(0, maxGroups), 2, async (group) => {
      const dValues = group.ds.slice(0, 24);
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
      const relays = [...group.hintRelays, ...publicationSearchStack()];
      try {
        const ws = await relayPool.query(
          relays,
          [{ kinds: [KIND.PUBLICATION], authors: [group.pubkey], '#d': still, limit: still.length }],
          2500,
          5
        );
        for (const event of ws) {
          if (event.kind === KIND.PUBLICATION) byAddr.set(eventAddress(event), event);
        }
      } catch {
        /* relay soft-fail */
      }
    });

    const missingIds = [...new Set(memberships.flatMap((m) => (m.eventId ? [m.eventId] : [])))];
    if (!missingIds.length) return;
    try {
      const byId = new Map(
        (await Promise.race([
          fetchByIds(missingIds.slice(0, 12), 2),
          new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 2500))
        ])).map((e) => [e.id, e])
      );
      for (const membership of memberships) {
        if (membership.address) continue;
        if (!membership.eventId) continue;
        const event = byId.get(membership.eventId);
        if (event?.kind === KIND.PUBLICATION) {
          membership.address = eventAddress(event);
          byAddr.set(membership.address, event);
        }
      }
    } catch {
      /* id resolve soft-fail */
    }
  };

  await Promise.race([
    run(),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn('[alexandria:landing] resolveShelfPublications budget exhausted', networkBudgetMs);
        resolve();
      }, networkBudgetMs);
    })
  ]);

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
  const outbox = viewerOutboxStack();
  const curator = GITCITADEL_CURATOR_HEX;
  const viewer = session.getPubkey();
  // Two waves so we do not take 6 pool slots at once beside feed queries.
  const [socialLabels, socialCuratorLabels, bookmarkWs] = await Promise.allSettled([
    relayPool.query(social, [{ kinds: [KIND.LABEL], limit: 80 }], 2500),
    relayPool.query(social, [{ kinds: [KIND.LABEL], authors: [curator], limit: 100 }], 2500),
    relayPool.query(social, [{ kinds: [KIND.BOOKMARK], limit: 80 }], 2500)
  ]);
  const [dirWs, myBookmarks, myDirs, myOutboxLists] = await Promise.allSettled([
    relayPool.query(document, [{ kinds: [KIND.DIRECTORY], limit: 80 }], 2500),
    viewer
      ? relayPool.query(social, [{ kinds: [KIND.BOOKMARK], authors: [viewer], limit: 5 }], 2500)
      : Promise.resolve([] as Event[]),
    viewer
      ? relayPool.query(
          document,
          [{ kinds: [KIND.DIRECTORY], authors: [viewer], limit: 40 }],
          2500
        )
      : Promise.resolve([] as Event[]),
    viewer
      ? relayPool.query(
          outbox,
          [
            {
              kinds: [KIND.BOOKMARK, KIND.DIRECTORY, KIND.LABEL],
              authors: [viewer],
              limit: 40
            }
          ],
          3000,
          5
        )
      : Promise.resolve([] as Event[])
  ]);
  const outboxEvents = settled(myOutboxLists, []);
  return {
    liveLabels: mergeEvents(
      settled(socialLabels, []),
      settled(socialCuratorLabels, []),
      outboxEvents.filter((e) => e.kind === KIND.LABEL)
    ),
    liveBookmarks: mergeEvents(
      settled(bookmarkWs, []),
      settled(myBookmarks, []),
      outboxEvents.filter((e) => e.kind === KIND.BOOKMARK)
    ),
    liveDirs: mergeEvents(
      settled(dirWs, []),
      settled(myDirs, []),
      outboxEvents.filter((e) => e.kind === KIND.DIRECTORY)
    )
  };
}

async function loadShelvesAndLabels(
  knownPubs: Event[],
  cached?: LandingView | null,
  membership?: ShelfMembershipPack,
  opts?: { viewerOnly?: boolean }
): Promise<{ shelves: LandingShelfSnap[]; labels: string[] }> {
  const viewerOnly = opts?.viewerOnly === true;
  // Signed-in: wait briefly for login lists so "My shelf" is not skipped on the first paint.
  // Viewer-only fold already has metadata — never block here.
  const viewerEarly = session.getPubkey();
  if (!viewerOnly && viewerEarly && !session.getMetadata().length) {
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
      const timer = setTimeout(finish, 4_000);
      if (session.getMetadata().length) finish();
    });
  }

  const mine = session.getMetadata();
  const pack = membership ?? (viewerOnly ? EMPTY_MEMBERSHIP : await fetchShelfMembershipEvents());
  const { liveLabels, liveBookmarks, liveDirs } = pack;
  const mineDirs = mine.filter((e) => e.kind === KIND.DIRECTORY);
  // For My-shelf fold: prefer bookmarks + directories so 12 labels do not explode author lookups.
  const mineForMembership = viewerOnly
    ? mine.filter(
        (e) => e.kind === KIND.BOOKMARK || e.kind === KIND.DIRECTORY || e.kind === KIND.LABEL
      )
    : mine;
  const combined = mergeEvents(liveLabels, liveBookmarks, liveDirs, mineForMembership);
  const memberships = membershipsFromEvents(combined);
  const publications = await resolveShelfPublications(
    memberships,
    [...knownPubs, ...(cached?.shelves ?? []).flatMap((s) => s.events)],
    {
      ...(viewerOnly
        ? { networkBudgetMs: 5_000, maxAddrs: 24, maxGroups: 6 }
        : { networkBudgetMs: 7_000, maxAddrs: 24, maxGroups: 4 }),
      hintEvents: combined
    }
  );
  const viewer = session.getPubkey();
  const follows = followPubkeysFromMetadata(mine);
  const shelves: Shelf[] = assignShelves(memberships, publications, viewer, follows);
  const nested =
    viewer != null
      ? nestedShelvesForViewer(mergeEvents(liveDirs, mineDirs), publications, viewer)
      : [];
  console.info('[alexandria:landing] loadShelvesAndLabels', {
    viewer: viewer?.slice(0, 8) ?? null,
    viewerOnly,
    memberships: memberships.length,
    resolvedPubs: publications.size,
    mineMeta: mine.length,
    liveBookmarks: liveBookmarks.length,
    liveDirs: liveDirs.length,
    shelves: [
      ...shelves.map((s) => `${s.id}:${s.events.length}`),
      ...nested.map((s) => `${s.id}:${s.events.length}`)
    ]
  });
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
  return loadShelvesAndLabels(knownPubs, null, EMPTY_MEMBERSHIP, { viewerOnly: true });
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

  // When the viewer identity changed, still seed curated shelves + feeds from cache so the
  // first paint does not blank a landing that already had covers (Home applies onUpdate live).
  const curatedCachedShelves = (cached?.shelves ?? []).filter((s) => !isViewerBoundShelfId(s.id));
  let comments = newestCommentPerWork(
    cacheOk || cached ? (cached?.comments ?? []) : []
  ).slice(0, LANDING_FEED_LIMIT);
  let highlights = newestHighlightPerAddress(
    cacheOk || cached ? (cached?.highlights ?? []) : []
  ).slice(0, LANDING_FEED_LIMIT);
  let ratings = landingRatings(cacheOk || cached ? (cached?.ratings ?? []) : []);
  let shelves = cacheOk ? (cached?.shelves ?? []) : curatedCachedShelves;
  let labels = cacheOk ? (cached?.labels ?? []) : [];
  let referenced = cacheOk || cached ? (cached?.referenced ?? []) : [];

  const paint = (partial: LandingView): void => {
    // Never push a totally empty snapshot — that wiped a warm Home paint on identity change.
    if (!landingHasPaint(partial)) return;
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
  // Single shelf resolve path (not a parallel minePack) so we do not saturate the relay pool.
  const shelvesPromise = membershipPromise.then((membership) =>
    loadShelvesAndLabels(publications, cacheOk ? cached : null, membership)
  );
  void shelvesPromise.then((pack) => {
    if (!shelvesHaveCovers(pack.shelves) && !pack.labels.length) return;
    if (shelvesHaveCovers(pack.shelves)) shelves = mergeLandingShelves(shelves, pack.shelves);
    if (pack.labels.length) labels = pack.labels;
    paint(snapshot());
  });

  const [commWs, highWs, rateWs] = await feedWsPromise;

  comments = newestCommentPerWork(
    mergeEvents(commWs, cacheOk ? (cached?.comments ?? []) : [])
  ).slice(0, LANDING_FEED_LIMIT);
  highlights = newestHighlightPerAddress(
    mergeEvents(highWs, cacheOk ? (cached?.highlights ?? []) : [])
  ).slice(0, LANDING_FEED_LIMIT);
  ratings = landingRatings(rateWs, cacheOk ? (cached?.ratings ?? []) : []);
  paint(snapshot());

  // Never block Home forever on shelf author lookups — race and paint whatever we have.
  const shelfPack = await Promise.race([
    shelvesPromise,
    new Promise<{ shelves: LandingShelfSnap[]; labels: string[] }>((resolve) => {
      setTimeout(() => {
        console.warn('[alexandria:landing] shelvesPromise timed out after 8s');
        resolve({ shelves: [], labels: [] });
      }, 8_000);
    })
  ]);
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

  // Hydrate highlight/comment titles in the background — do not gate landing return.
  void resolveReferenced(
    [...highlights, ...comments, ...ratings],
    [...publications, ...(cacheOk ? (cached?.referenced ?? []) : []), ...shelves.flatMap((s) => s.events)]
  ).then((refs) => {
    if (!refs.length) return;
    referenced = refs;
    paint(snapshot());
  });

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
