import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { mercuryFilter, mercuryWikiSearch } from './nostr/mercury';
import { relayPool } from './nostr/pool';
import { wikiStack } from './nostr/selector';
import { rememberEvents } from './nostr/event-memory';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { firstTag } from './nostr/verify';
import { displayTitle, libraryDocumentPath } from './metadata';

const WIKI_KINDS = [KIND.WIKI, KIND.SPEC] as const;

function isWikiish(event: Event): boolean {
  return event.kind === KIND.WIKI || event.kind === KIND.SPEC;
}

function mergeWikiEvents(batches: Event[][]): Event[] {
  const merged = pruneToLatestReplaceables(batches.flat().filter(isWikiish));
  rememberEvents(merged);
  return merged.sort((a, b) => b.created_at - a.created_at);
}

/** Newest wiki + spec pages from Mercury (NostrWiki “Recent changes”). */
export async function loadWikiRecent(limit = 40): Promise<Event[]> {
  const half = Math.max(10, Math.ceil(limit / 2));
  const [wikis, specs] = await Promise.all([
    mercuryFilter({ kinds: [KIND.WIKI], limit: half }).catch(() => [] as Event[]),
    mercuryFilter({ kinds: [KIND.SPEC], limit: half }).catch(() => [] as Event[])
  ]);
  return mergeWikiEvents([wikis, specs]).slice(0, limit);
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

/** Wiki/spec search: Mercury typed wiki search + relay NIP-50 when available. */
export async function searchWikiHub(q: string, limit = 60): Promise<Event[]> {
  const query = q.trim();
  if (!query) return [];
  // Wiki search requires `q` (min 2); title/d are optional filters on the same endpoint.
  const [byQ, byTitle, byD, relays] = await Promise.all([
    mercuryWikiSearch({ q: query, limit }).catch(() => [] as Event[]),
    mercuryWikiSearch({ q: query, title: query, limit }).catch(() => [] as Event[]),
    mercuryWikiSearch({ q: query, d: query, limit }).catch(() => [] as Event[]),
    relayPool
      .query(wikiStack(), [{ kinds: [...WIKI_KINDS], search: query, limit }], 4000)
      .catch(() => [] as Event[])
  ]);
  return mergeWikiEvents([byQ, byTitle, byD, relays]).slice(0, limit);
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
