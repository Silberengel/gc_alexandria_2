import type { Event } from 'nostr-tools';
import { filterMuted, type MuteState } from '../mute';
import type { NotificationLookbackId } from './lookback';
import { feedLookbackIsWider } from './lookback';

/** Keep posts already on screen when a load comes back with nothing. */
export function keepFeedPosts(shown: Event[], incoming: Event[]): Event[] {
  return incoming.length ? incoming : shown;
}

/** Merge by id and sort newest-first — does not drop rows already on screen. */
export function mergeFeedPosts(shown: Event[], incoming: Event[]): Event[] {
  if (!incoming.length) return shown;
  const byId = new Map<string, Event>();
  for (const event of shown) {
    if (event?.id) byId.set(event.id.toLowerCase(), event);
  }
  for (const event of incoming) {
    if (event?.id) byId.set(event.id.toLowerCase(), event);
  }
  return [...byId.values()].sort((a, b) => b.created_at - a.created_at);
}

/**
 * After the feed has settled, newer posts are held for a "New Events" control
 * instead of jumping into the timeline (which steals scroll).
 */
export function collectNewFeedEvents(
  incoming: Event[],
  opts: {
    shown: Event[];
    pending: Event[];
    /** Max `created_at` already admitted to the timeline when it settled / last admit. */
    watermark: number;
  }
): Event[] {
  const known = new Set<string>();
  for (const event of opts.shown) {
    if (event?.id) known.add(event.id.toLowerCase());
  }
  for (const event of opts.pending) {
    if (event?.id) known.add(event.id.toLowerCase());
  }
  const byId = new Map<string, Event>();
  for (const event of opts.pending) {
    if (event?.id) byId.set(event.id.toLowerCase(), event);
  }
  for (const event of incoming) {
    if (!event?.id) continue;
    const id = event.id.toLowerCase();
    if (known.has(id)) continue;
    if (event.created_at <= opts.watermark) continue;
    byId.set(id, event);
    known.add(id);
  }
  return [...byId.values()].sort((a, b) => b.created_at - a.created_at);
}

/** Newest `created_at` in a list (0 when empty). */
export function feedEventsWatermark(events: Event[]): number {
  let max = 0;
  for (const event of events) {
    if (event.created_at > max) max = event.created_at;
  }
  return max;
}

/** Fetch-scope key — kind/q must not appear here (client view only). */
export function feedFetchKey(tab: string, author: string | null | undefined): string {
  return `${tab}:${author ?? ''}`;
}

export type FeedListState = {
  items: Event[];
  pendingNew: Event[];
  watermark: number;
  settled: boolean;
  loading: boolean;
  error: string;
  /** Last lookback successfully fetched for the current fetch key. */
  fetchedLookback: NotificationLookbackId | null;
  /** `${tab}:${author}` last loaded. */
  loadedKey: string | null;
};

export function createFeedListState(): FeedListState {
  return {
    items: [],
    pendingNew: [],
    watermark: 0,
    settled: false,
    loading: true,
    error: '',
    fetchedLookback: null,
    loadedKey: null
  };
}

export function resetForTab(state: FeedListState, listKey: string): FeedListState {
  return {
    ...state,
    items: [],
    pendingNew: [],
    watermark: 0,
    fetchedLookback: null,
    loadedKey: listKey,
    loading: true,
    settled: false,
    error: ''
  };
}

export function beginLookbackChange(
  state: FeedListState,
  next: NotificationLookbackId,
  prevFetched: NotificationLookbackId | null
): FeedListState {
  return {
    ...state,
    loading: true,
    settled: false,
    pendingNew: [],
    error: '',
    watermark: feedLookbackIsWider(next, prevFetched) ? 0 : state.watermark
  };
}

/** Merge incoming into items or stage behind New Events once settled. */
export function ingestFeedList(
  state: FeedListState,
  incoming: Event[],
  muted: MuteState
): FeedListState {
  const next = filterMuted(incoming, muted);
  if (!next.length) return state;
  if (!state.settled || !state.items.length) {
    const items = mergeFeedPosts(state.items, next);
    return {
      ...state,
      items,
      watermark: items.length ? feedEventsWatermark(items) : state.watermark
    };
  }
  return {
    ...state,
    pendingNew: collectNewFeedEvents(next, {
      shown: state.items,
      pending: state.pendingNew,
      watermark: state.watermark || feedEventsWatermark(state.items)
    })
  };
}

/**
 * Admit only the view-filtered pending rows so New Events never "vanishes"
 * under an active kind/text filter. Non-matching pending stays buffered.
 */
export function admitPendingVisible(state: FeedListState, visiblePending: Event[]): FeedListState {
  if (!visiblePending.length) return state;
  const admitted = new Set(
    visiblePending.map((event) => event.id.toLowerCase()).filter(Boolean)
  );
  const items = mergeFeedPosts(state.items, visiblePending);
  return {
    ...state,
    items,
    pendingNew: state.pendingNew.filter((event) => !admitted.has(event.id.toLowerCase())),
    watermark: feedEventsWatermark(items)
  };
}

export function markFeedListSettled(
  state: FeedListState,
  lookback: NotificationLookbackId
): FeedListState {
  return {
    ...state,
    loading: false,
    settled: true,
    fetchedLookback: lookback,
    watermark: Math.max(state.watermark, feedEventsWatermark(state.items))
  };
}
