import type { Event, Filter } from 'nostr-tools';
import { KIND } from '../constants';
import { compareDirectoryListing } from '../directory-explorer';
import { emptyMuteState, filterMuted, type MuteState } from '../mute';
import { pruneToLatestReplaceables } from '../nostr/replaceable';
import { relayPool } from '../nostr/pool';
import { feedSinceFromLookback } from './lookback';

export const emptyMute: MuteState = emptyMuteState();

export function sortFeedEvents(events: Event[]): Event[] {
  return pruneToLatestReplaceables(events).sort((a, b) => {
    if (a.kind === KIND.DIRECTORY && b.kind === KIND.DIRECTORY) {
      return compareDirectoryListing(a, b);
    }
    return b.created_at - a.created_at;
  });
}

export type FeedLoaderOpts = {
  muted?: MuteState;
  onCache?: (events: Event[]) => void;
  lookbackSeconds?: number | null;
  accept: (event: Event) => boolean;
  recall: () => Promise<Event[]>;
  /** Personal / shipped ask filters (with since already applied by caller, or raw). */
  askFilters: Filter[];
  personal: string[];
  shipped: string[];
  /** Extra parallel query (e.g. follow authors). */
  extraQuery?: {
    relays: string[];
    maxRelays: number;
    filters: Filter[];
  } | null;
  queryTimeoutMs?: number;
};

/**
 * Shared recall → absorb → query → finalize shell used by all feed list loaders.
 */
export async function runFeedLoader(opts: FeedLoaderOpts): Promise<Event[]> {
  const muted = opts.muted ?? emptyMute;
  const since = feedSinceFromLookback(opts.lookbackSeconds ?? null);
  const inWindow = (event: Event): boolean =>
    since == null || event.created_at >= since;
  const cached = filterMuted(await opts.recall(), muted);
  const byId = new Map<string, Event>();
  const paint = (): void => {
    const posts = filterMuted(
      sortFeedEvents([...byId.values()].filter(inWindow)),
      muted
    );
    if (posts.length) opts.onCache?.(posts);
  };
  for (const event of cached) {
    if (!opts.accept(event) || !inWindow(event)) continue;
    byId.set(event.id, event);
  }
  if (byId.size) paint();

  const queryOpts = { includeCooling: true };
  const timeout = opts.queryTimeoutMs ?? 7000;
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (!opts.accept(event) || !inWindow(event) || byId.has(event.id)) continue;
      byId.set(event.id, event);
      added = true;
    }
    if (added) paint();
  };

  const ask = (urls: string[], maxRelays: number): Promise<Event[]> =>
    opts.askFilters.length
      ? relayPool
          .query(urls, opts.askFilters, timeout, maxRelays, absorb, queryOpts)
          .catch(() => [] as Event[])
      : Promise.resolve([]);

  const jobs: Promise<Event[]>[] = [
    opts.personal.length
      ? ask(opts.personal, Math.min(opts.personal.length, 8))
      : Promise.resolve([]),
    opts.shipped.length ? ask(opts.shipped, 4) : Promise.resolve([])
  ];
  if (opts.extraQuery?.relays.length && opts.extraQuery.filters.length) {
    jobs.push(
      relayPool
        .query(
          opts.extraQuery.relays,
          opts.extraQuery.filters,
          timeout,
          opts.extraQuery.maxRelays,
          absorb,
          queryOpts
        )
        .catch(() => [] as Event[])
    );
  }

  const batches = await Promise.all(jobs);
  for (const event of batches.flat()) {
    if (!opts.accept(event) || !inWindow(event)) continue;
    byId.set(event.id, event);
  }
  return filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
}
