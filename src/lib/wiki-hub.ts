import type { Event } from 'nostr-tools';
import type { Filter } from 'nostr-tools';
import { KIND } from './constants';
import { dTagVariants, normalizeDTag } from './dtag';
import {
  compareAuthorsByGrapevine,
  type GrapevineTrustContext
} from './grapevine-rank';
import { ensureFollowsOfFollows, getFollowsOfFollowsSet } from './follows-of-follows';
import { displayTitle, libraryDocumentPath } from './metadata';
import { followPubkeysFromMetadata } from './mute';
import { mercuryFilter, mercuryWikiSearch } from './nostr/mercury';
import { cachedEventsByKind } from './nostr/cache';
import { memoryEventsByKind, rememberEvents } from './nostr/event-memory';
import { relayPool } from './nostr/pool';
import { relayTagSlug } from './nostr/relay-filters';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { wikiStack } from './nostr/selector';
import { firstTag } from './nostr/verify';
import { session } from './stores/session';
import { trust } from './stores/trust';
import { trustedAssertions } from './trusted-assertions';
import { SessionTtlCache } from './session-ttl-cache';
import { isWikiDeference } from './wiki-defer';
import {
  resolveWikiAliasArticles,
  wikiAliasMatchesQuery
} from './wiki-redirect';

const wikiHubSearchCache = new SessionTtlCache<Event[]>(5 * 60 * 1000, 40);

/** @deprecated Prefer {@link wikiAliasMatchesQuery}. */
export const wikiHubAliasMatchesQuery = wikiAliasMatchesQuery;

const WIKI_KINDS = [KIND.WIKI, KIND.SPEC] as const;

function isWikiish(event: Event): boolean {
  return event.kind === KIND.WIKI || event.kind === KIND.SPEC;
}

function mergeWikiEvents(batches: Event[][]): Event[] {
  const merged = pruneToLatestReplaceables(batches.flat().filter(isWikiish));
  rememberEvents(merged);
  return merged;
}

/** Real wiki/spec articles only — skip defers and empty shells (title/d with no body). */
function isWikiHubListingPage(event: Event): boolean {
  return isWikiish(event) && !isWikiDeference(event) && !!event.content?.trim();
}

function wikiTitleHay(event: Event): string {
  const titles = event.tags
    .filter((t) => (t[0] === 'title' || t[0] === 'T') && t[1]?.trim())
    .map((t) => t[1]!.trim());
  if (titles.length) return titles.join('\n');
  return displayTitle(event);
}

/** Normalized d-tag / title strings used for wiki-hub match + relevance. */
export function wikiHubSearchFields(event: Event): { d: string; title: string; titleNorm: string } {
  const d = normalizeDTag(firstTag(event, 'd') ?? '');
  const title = wikiTitleHay(event);
  return { d, title, titleNorm: normalizeDTag(title) };
}

/**
 * Wiki hub only matches d-tag and title (not body / author / content search).
 * Accepts exact d, normalized title equality, or substring in either.
 */
export function wikiHubMatchesQuery(event: Event, query: string): boolean {
  if (!isWikiish(event)) return false;
  const q = query.trim();
  if (!q) return false;
  const needle = normalizeDTag(q) || q.toLowerCase();
  if (!needle) return false;
  const { d, title, titleNorm } = wikiHubSearchFields(event);
  if (d && (d === needle || d.includes(needle))) return true;
  if (titleNorm && (titleNorm === needle || titleNorm.includes(needle))) return true;
  const lower = title.toLowerCase();
  const raw = q.toLowerCase();
  return lower.includes(raw);
}

/**
 * Higher = more relevant. Exact d-tag wins, then alias hits, then d prefix/contains, then title.
 */
export function wikiHubRelevanceScore(
  event: Event,
  query: string,
  opts?: { aliasMatchedIds?: ReadonlySet<string>; exactAliasIds?: ReadonlySet<string> }
): number {
  const q = query.trim();
  if (!q) return 0;
  const needle = normalizeDTag(q) || q.toLowerCase();
  const raw = q.toLowerCase();
  const { d, title, titleNorm } = wikiHubSearchFields(event);
  if (d && d === needle) return 100;
  // Exact alias redirect (e.g. query "btc" → article "bitcoin") ranks just under exact d.
  if (opts?.exactAliasIds?.has(event.id)) return 95;
  if (d && d.startsWith(needle)) return 85;
  if (opts?.aliasMatchedIds?.has(event.id)) return 80;
  if (d && d.includes(needle)) return 70;
  if (titleNorm && titleNorm === needle) return 60;
  if (titleNorm && titleNorm.startsWith(needle)) return 50;
  if (titleNorm && titleNorm.includes(needle)) return 40;
  const lower = title.toLowerCase();
  if (lower === raw) return 55;
  if (lower.startsWith(raw)) return 45;
  if (lower.includes(raw)) return 30;
  return 0;
}

export function sortWikiHubResults(
  events: Event[],
  query: string,
  grapevine?: GrapevineTrustContext | null,
  opts?: { aliasMatchedIds?: ReadonlySet<string>; exactAliasIds?: ReadonlySet<string> }
): Event[] {
  return [...events].sort((a, b) => {
    const rel =
      wikiHubRelevanceScore(b, query, opts) - wikiHubRelevanceScore(a, query, opts);
    if (rel !== 0) return rel;
    if (grapevine) {
      const byRank = compareAuthorsByGrapevine(a.pubkey, b.pubkey, grapevine);
      if (byRank !== 0) return byRank;
    }
    return b.created_at - a.created_at;
  });
}

function grapevineContext(): GrapevineTrustContext {
  const snap = trust.snapshot();
  const viewerPubkey = session.getPubkey();
  const followPubkeySet = followPubkeysFromMetadata(session.getMetadata());
  return {
    trustFilterEnabled: snap.enabled,
    rankCutoff: snap.rankMin,
    viewerPubkey,
    followPubkeySet,
    followsOfFollowsSet: getFollowsOfFollowsSet(viewerPubkey),
    getScore: (pk) => trustedAssertions.getScore(pk)
  };
}

async function hydrateWikiGrapevine(events: Event[]): Promise<GrapevineTrustContext> {
  const authors = [...new Set(events.map((e) => e.pubkey))];
  try {
    await trustedAssertions.resolveProvider(session.getPubkey());
    await trustedAssertions.requestScoresAndWait(authors);
  } catch {
    /* scores optional */
  }
  try {
    const follows = followPubkeysFromMetadata(session.getMetadata());
    await ensureFollowsOfFollows(session.getPubkey(), follows);
  } catch {
    /* FoF optional */
  }
  return grapevineContext();
}

/** Skip wiki-relay round-trips for a few minutes after a successful recent fetch. */
const WIKI_RECENT_TTL_MS = 5 * 60 * 1000;

type WikiRecentSnap = { at: number; fetchLimit: number; events: Event[] };

let wikiRecentSnap: WikiRecentSnap | null = null;
let wikiRecentInflight: Promise<Event[]> | null = null;

function rankWikiRecent(batches: Event[][], limit: number): Event[] {
  return mergeWikiEvents(batches)
    .filter(isWikiHubListingPage)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

/** Fold anything newly remembered in this session into a cached recent list. */
function wikiRecentWithMemory(events: Event[], limit: number): Event[] {
  return rankWikiRecent(
    [events, memoryEventsByKind(KIND.WIKI), memoryEventsByKind(KIND.SPEC)],
    limit
  );
}

/** Test helper — drop the in-memory recent TTL cache. */
export function resetWikiRecentCacheForTests(): void {
  wikiRecentSnap = null;
  wikiRecentInflight = null;
}

/**
 * Newest wiki + spec pages from IndexedDB/memory cache and (when stale) wiki relays.
 * Relay results are TTL-cached so hub ↔ recent navigation does not re-query every time.
 */
export async function loadWikiRecent(limit = 40): Promise<Event[]> {
  const fetchLimit = Math.max(50, Math.ceil(limit * 1.5));
  const snap = wikiRecentSnap;
  if (snap && Date.now() - snap.at < WIKI_RECENT_TTL_MS && snap.fetchLimit >= fetchLimit) {
    return wikiRecentWithMemory(snap.events, limit);
  }

  if (wikiRecentInflight) {
    const events = await wikiRecentInflight;
    return wikiRecentWithMemory(events, limit);
  }

  wikiRecentInflight = (async () => {
    const wikiFilter = { kinds: [KIND.WIKI], limit: fetchLimit };
    const specFilter = { kinds: [KIND.SPEC], limit: fetchLimit };
    const [cachedWikis, cachedSpecs, relayWikis, relaySpecs] = await Promise.all([
      cachedEventsByKind(KIND.WIKI).catch(() => [] as Event[]),
      cachedEventsByKind(KIND.SPEC).catch(() => [] as Event[]),
      relayPool.query(wikiStack(), [wikiFilter], 4000).catch(() => [] as Event[]),
      relayPool.query(wikiStack(), [specFilter], 4000).catch(() => [] as Event[])
    ]);
    const events = rankWikiRecent(
      [cachedWikis, cachedSpecs, relayWikis, relaySpecs],
      fetchLimit
    );
    wikiRecentSnap = { at: Date.now(), fetchLimit, events };
    return events;
  })();

  try {
    const events = await wikiRecentInflight;
    return wikiRecentWithMemory(events, limit);
  } finally {
    wikiRecentInflight = null;
  }
}

/** Pick a random wiki article — prefer the recent TTL cache, else cache + wiki relays. */
export async function pickRandomWikiPage(): Promise<Event | null> {
  const fromRecent = wikiRecentSnap
    ? wikiRecentWithMemory(wikiRecentSnap.events, wikiRecentSnap.events.length).filter(
        (e) => e.kind === KIND.WIKI
      )
    : [];
  if (fromRecent.length) {
    return fromRecent[Math.floor(Math.random() * fromRecent.length)] ?? null;
  }

  const filter = { kinds: [KIND.WIKI], limit: 60 };
  const [cached, relayHits] = await Promise.all([
    cachedEventsByKind(KIND.WIKI).catch(() => [] as Event[]),
    relayPool.query(wikiStack(), [filter], 2500).catch(() => [] as Event[])
  ]);
  const list = mergeWikiEvents([cached, relayHits]).filter(isWikiHubListingPage);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)] ?? null;
}

/**
 * Wiki/spec search for the wiki hub page: d-tag and title (30818 / 30817),
 * plus kind-30819 aliases that resolve to those articles.
 * Ranked by match relevance then grapevine pubkey rank.
 */
export async function searchWikiHub(q: string, limit = 60): Promise<Event[]> {
  const query = q.trim();
  if (!query) return [];
  const cacheKey = `wiki-search:${query.toLowerCase()}:${limit}`;
  return wikiHubSearchCache.getOrLoad(cacheKey, () => searchWikiHubUncached(query, limit));
}

async function searchWikiHubUncached(query: string, limit: number): Promise<Event[]> {
  const slug = normalizeDTag(query);
  const variants = dTagVariants(query);
  const titleSlug = relayTagSlug(query);
  const dValues = variants.length ? variants.slice(0, 12) : [query];
  const dFilter: Filter = {
    kinds: [...WIKI_KINDS],
    '#d': dValues,
    limit
  };
  const titleFilter: Filter | null = titleSlug
    ? { kinds: [...WIKI_KINDS], '#T': [titleSlug], limit }
    : null;

  const relaysP = Promise.all([
    relayPool.query(wikiStack(), [dFilter], 4000).catch(() => [] as Event[]),
    titleFilter
      ? relayPool.query(wikiStack(), [titleFilter], 4000).catch(() => [] as Event[])
      : Promise.resolve([] as Event[]),
    mercuryFilter(dFilter).catch(() => [] as Event[]),
    titleFilter ? mercuryFilter(titleFilter).catch(() => [] as Event[]) : Promise.resolve([] as Event[])
  ]).then((batches) => batches.flat());

  const aliasesP = resolveWikiAliasArticles(query, limit);

  // Mercury `/api/wiki/search` requires `q` (min 2). Pass title/d so we do not
  // pull body/content hits — bare `q` alone matches article text.
  let wikiBatches: Event[][] = [];
  let aliasHit: Awaited<ReturnType<typeof resolveWikiAliasArticles>>;
  if (query.length >= 2) {
    const [byTitle, byD, relays, aliases] = await Promise.all([
      mercuryWikiSearch({ q: query, title: query, limit }).catch(() => [] as Event[]),
      mercuryWikiSearch({ q: query, d: slug || query, limit }).catch(() => [] as Event[]),
      relaysP,
      aliasesP
    ]);
    wikiBatches = [byTitle, byD, relays];
    aliasHit = aliases;
  } else {
    const [relays, aliases] = await Promise.all([relaysP, aliasesP]);
    wikiBatches = [relays];
    aliasHit = aliases;
  }

  const merged = mergeWikiEvents([...wikiBatches, aliasHit.targets]).filter(
    (e) => wikiHubMatchesQuery(e, query) || aliasHit.aliasMatchedIds.has(e.id)
  );
  const grapevine = await hydrateWikiGrapevine(merged);
  return sortWikiHubResults(merged, query, grapevine, {
    aliasMatchedIds: aliasHit.aliasMatchedIds,
    exactAliasIds: aliasHit.exactAliasIds
  }).slice(0, limit);
}

export function wikiHubResultHref(event: Event): string {
  return `#${libraryDocumentPath(event)}`;
}

export function wikiHubResultLabel(event: Event): string {
  return displayTitle(event);
}

export function wikiHubKindLabel(event: Event): string {
  if (event.kind === KIND.SPEC) return 'Spec';
  return 'Wiki';
}

export function wikiHubDTag(event: Event): string {
  return firstTag(event, 'd')?.trim() || '';
}
