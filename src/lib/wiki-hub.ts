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
import { rememberEvents } from './nostr/event-memory';
import { relayPool } from './nostr/pool';
import { relayTagSlug } from './nostr/relay-filters';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { wikiStack } from './nostr/selector';
import { firstTag } from './nostr/verify';
import { session } from './stores/session';
import { trust } from './stores/trust';
import { trustedAssertions } from './trusted-assertions';

const WIKI_KINDS = [KIND.WIKI, KIND.SPEC] as const;

function isWikiish(event: Event): boolean {
  return event.kind === KIND.WIKI || event.kind === KIND.SPEC;
}

function mergeWikiEvents(batches: Event[][]): Event[] {
  const merged = pruneToLatestReplaceables(batches.flat().filter(isWikiish));
  rememberEvents(merged);
  return merged;
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
 * Higher = more relevant. Exact d-tag wins, then d prefix/contains, then title.
 */
export function wikiHubRelevanceScore(event: Event, query: string): number {
  const q = query.trim();
  if (!q) return 0;
  const needle = normalizeDTag(q) || q.toLowerCase();
  const raw = q.toLowerCase();
  const { d, title, titleNorm } = wikiHubSearchFields(event);
  if (d && d === needle) return 100;
  if (d && d.startsWith(needle)) return 85;
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
  grapevine?: GrapevineTrustContext | null
): Event[] {
  return [...events].sort((a, b) => {
    const rel = wikiHubRelevanceScore(b, query) - wikiHubRelevanceScore(a, query);
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

/** Newest wiki + spec pages from Mercury (NostrWiki “Recent changes”). */
export async function loadWikiRecent(limit = 40): Promise<Event[]> {
  const half = Math.max(10, Math.ceil(limit / 2));
  const [wikis, specs] = await Promise.all([
    mercuryFilter({ kinds: [KIND.WIKI], limit: half }).catch(() => [] as Event[]),
    mercuryFilter({ kinds: [KIND.SPEC], limit: half }).catch(() => [] as Event[])
  ]);
  return mergeWikiEvents([wikis, specs])
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

/**
 * Pick a random wiki article — Mercury and wiki relays in parallel
 * (same race pattern as NostrWiki).
 */
export async function pickRandomWikiPage(): Promise<Event | null> {
  const mercuryP = mercuryFilter({ kinds: [KIND.WIKI], limit: 25 }).catch(() => [] as Event[]);
  const relaysP = relayPool
    .query(wikiStack(), [{ kinds: [KIND.WIKI], limit: 25 }], 2500)
    .catch(() => [] as Event[]);

  const first = await Promise.race([
    mercuryP.then((events) => ({ events, src: 'm' as const })),
    relaysP.then((events) => ({ events, src: 'r' as const }))
  ]);
  const otherP = first.src === 'm' ? relaysP : mercuryP;
  const more = await Promise.race([
    otherP,
    new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), 350))
  ]);
  let list = mergeWikiEvents([first.events, more]);
  if (!list.length) {
    const [m, r] = await Promise.all([mercuryP, relaysP]);
    list = mergeWikiEvents([m, r]);
  }
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)] ?? null;
}

/**
 * Wiki/spec search for the wiki hub page: d-tag and title only (30818 / 30817),
 * ranked by match relevance then grapevine pubkey rank.
 */
export async function searchWikiHub(q: string, limit = 60): Promise<Event[]> {
  const query = q.trim();
  if (!query) return [];

  const slug = normalizeDTag(query);
  const variants = dTagVariants(query);
  const titleSlug = relayTagSlug(query);
  const dFilter: Filter = {
    kinds: [...WIKI_KINDS],
    '#d': variants.length ? variants.slice(0, 12) : [query],
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

  // Mercury `/api/wiki/search` requires `q` (min 2). Pass title/d so we do not
  // pull body/content hits — bare `q` alone matches article text.
  let mercuryBatches: Event[][] = [];
  if (query.length >= 2) {
    mercuryBatches = await Promise.all([
      mercuryWikiSearch({ q: query, title: query, limit }).catch(() => [] as Event[]),
      mercuryWikiSearch({ q: query, d: slug || query, limit }).catch(() => [] as Event[]),
      relaysP
    ]);
  } else {
    mercuryBatches = [await relaysP];
  }

  const merged = mergeWikiEvents(mercuryBatches).filter((e) => wikiHubMatchesQuery(e, query));
  const grapevine = await hydrateWikiGrapevine(merged);
  return sortWikiHubResults(merged, query, grapevine).slice(0, limit);
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
