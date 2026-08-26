import type { Event, Filter } from 'nostr-tools';
import { KIND } from './constants';
import { humanizeTag } from './cover-fallback';
import { landingLabels } from './labels';
import {
  LIBRARY_KIND_TAGS,
  addressPath,
  libraryAddresses,
  newestCommentPerWork,
  newestHighlightPerAddress,
  parseAddress,
  referencedLibraryAddress,
  referencedSectionAddress
} from './library-scope';
import { displayTitle } from './metadata';
import { followPubkeysFromMetadata } from './mute';
import {
  cacheGetLandingSnapshot,
  cachePutLandingSnapshot,
  cacheScanByKind,
  type LandingShelfSnap,
  type LandingSnapshot
} from './nostr/cache';
import { fetchByAddress, fetchByAddresses, fetchByIds, poolMap } from './nostr/fetch';
import { mercuryFilter } from './nostr/mercury';
import { relayPool } from './nostr/pool';
import { documentStack, highlightStack, socialStack } from './nostr/selector';
import { eventAddress, isTopLevel30040 } from './nostr/verify';
import { assignShelves, membershipsFromEvents, type Membership, type Shelf } from './shelves';
import { session } from './stores/session';

export type LandingView = LandingSnapshot & {
  subjects: string[];
  shelves: LandingShelfSnap[];
  labels: string[];
};

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

export function hrefForRef(event: Event, referenced: Event[]): string | null {
  const work = referencedLibraryAddress(event);
  const section = referencedSectionAddress(event);
  const top = topLevelPublicationAddress(section ?? work, referenced);
  return addressPath(top ?? work ?? '');
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
    const fetched = await poolMap(missing, 6, fetchByAddress);
    for (const event of fetched) {
      if (event) byAddr.set(eventAddress(event), event);
    }
  }

  const children = [...needed].filter((addr) => {
    const parsed = parseAddress(addr);
    return parsed && (parsed.kind === KIND.SECTION || parsed.kind === KIND.PUBLICATION);
  });
  const parents = await poolMap(children.slice(0, 20), 4, fetchContainingPublication);
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

async function mercuryFilters(filters: Filter[]): Promise<Event[]> {
  const batches = await Promise.all(filters.map((filter) => mercuryFilter(filter)));
  return mergeEvents(...batches);
}

async function resolveShelfPublications(memberships: Membership[], known: Event[]): Promise<Map<string, Event>> {
  const byAddr = new Map<string, Event>();
  for (const event of known) {
    if (event.kind === KIND.PUBLICATION) byAddr.set(eventAddress(event), event);
  }
  const missingAddrs = [...new Set(memberships.flatMap((m) => (m.address && !byAddr.has(m.address) ? [m.address] : [])))];
  for (const event of await fetchByAddresses(missingAddrs.slice(0, 80))) {
    if (event.kind === KIND.PUBLICATION) byAddr.set(eventAddress(event), event);
  }
  const missingIds = [...new Set(memberships.flatMap((m) => (m.eventId ? [m.eventId] : [])))];
  const byId = new Map((await fetchByIds(missingIds.slice(0, 40))).map((e) => [e.id, e]));
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

async function loadShelvesAndLabels(
  knownPubs: Event[],
  cached?: LandingView | null
): Promise<{ shelves: LandingShelfSnap[]; labels: string[] }> {
  const social = socialStack();
  const [labelWs, bookmarkWs] = await Promise.allSettled([
    relayPool.query(social, [{ kinds: [KIND.LABEL], limit: 200 }], 4000),
    relayPool.query(social, [{ kinds: [KIND.BOOKMARK], limit: 100 }], 4000)
  ]);
  const liveLabels = settled(labelWs, []);
  const liveBookmarks = settled(bookmarkWs, []);
  const mine = session.getMetadata();
  const combined = mergeEvents(liveLabels, liveBookmarks, mine);
  const memberships = membershipsFromEvents(combined);
  const publications = await resolveShelfPublications(memberships, [
    ...knownPubs,
    ...(cached?.shelves ?? []).flatMap((s) => s.events)
  ]);
  const viewer = session.getPubkey();
  const follows = followPubkeysFromMetadata(mine);
  const shelves: Shelf[] = assignShelves(memberships, publications, viewer, follows);
  const labels = landingLabels(liveLabels.length ? liveLabels : combined);
  return {
    shelves: shelves.map((s) => ({ id: s.id, title: s.title, events: s.events })),
    labels
  };
}

export async function loadCachedLanding(): Promise<LandingView | null> {
  const snap = await cacheGetLandingSnapshot();
  if (
    snap &&
    (snap.publications.length ||
      snap.highlights.length ||
      snap.comments.length ||
      (snap.shelves?.length ?? 0) ||
      (snap.labels?.length ?? 0))
  ) {
    return withSubjects({
      ...snap,
      highlights: newestHighlightPerAddress(snap.highlights).slice(0, LANDING_FEED_LIMIT),
      comments: newestCommentPerWork(snap.comments).slice(0, LANDING_FEED_LIMIT)
    });
  }

  const [publications, rawHighlights, rawComments] = await Promise.all([
    cacheScanByKind(KIND.PUBLICATION, 50),
    cacheScanByKind(KIND.HIGHLIGHT, 100),
    cacheScanByKind(KIND.COMMENT, 100)
  ]);
  if (!publications.length && !rawHighlights.length && !rawComments.length) return null;

  const highlights = newestHighlightPerAddress(rawHighlights).slice(0, LANDING_FEED_LIMIT);
  const comments = newestCommentPerWork(rawComments).slice(0, LANDING_FEED_LIMIT);
  return withSubjects({
    publications,
    highlights,
    comments,
    referenced: snap?.referenced?.length
      ? snap.referenced
      : await resolveReferenced([...highlights, ...comments], publications),
    shelves: snap?.shelves ?? [],
    labels: snap?.labels ?? []
  });
}

export async function refreshLanding(
  cached: LandingView | null,
  onUpdate?: (view: LandingView) => void
): Promise<LandingView> {
  const [pubsResult, wikiResult, commHttp, commWs, highHttp, highWs] = await Promise.allSettled([
    mercuryFilter({ kinds: [KIND.PUBLICATION], limit: 50 }),
    mercuryFilter({ kinds: [KIND.WIKI, KIND.SPEC], limit: 50 }),
    mercuryFilters(COMMENT_FILTERS),
    relayPool.query(socialStack(), COMMENT_FILTERS, 4000),
    mercuryFilters(HIGHLIGHT_FILTERS),
    relayPool.query(highlightStack(), HIGHLIGHT_FILTERS, 4000)
  ]);

  const publications = preferLive(
    mergeEvents(settled(pubsResult, []), settled(wikiResult, [])),
    cached?.publications
  );
  const comments = newestCommentPerWork(
    preferLive(mergeEvents(settled(commHttp, []), settled(commWs, [])), cached?.comments)
  ).slice(0, LANDING_FEED_LIMIT);
  const highlights = newestHighlightPerAddress(
    preferLive(mergeEvents(settled(highHttp, []), settled(highWs, [])), cached?.highlights)
  ).slice(0, LANDING_FEED_LIMIT);

  const painted = withSubjects({
    publications,
    comments,
    highlights,
    referenced: cached?.referenced ?? [],
    shelves: cached?.shelves ?? [],
    labels: cached?.labels ?? []
  });
  onUpdate?.(painted);

  const [referenced, shelfPack] = await Promise.all([
    resolveReferenced([...highlights, ...comments], [...publications, ...(cached?.referenced ?? [])]),
    loadShelvesAndLabels(publications, cached)
  ]);
  const view = withSubjects({
    publications,
    comments,
    highlights,
    referenced,
    shelves: shelfPack.shelves.length ? shelfPack.shelves : (cached?.shelves ?? []),
    labels: shelfPack.labels.length ? shelfPack.labels : (cached?.labels ?? [])
  });
  onUpdate?.(view);
  void cachePutLandingSnapshot(view);
  return view;
}
