import type { Event } from 'nostr-tools';
import { rememberEvents } from '../nostr/event-memory';
import type { MuteState } from '../mute';
import {
  admitPendingVisible,
  beginLookbackChange,
  createFeedListState,
  feedFetchKey,
  ingestFeedList,
  markFeedListSettled,
  resetForTab,
  type FeedListState
} from './list-store';
import {
  notificationLookbackSeconds,
  type NotificationLookbackId
} from './lookback';
import { feedRelayGroups } from './relay-plan';
import { loadForFeedSource, recallForFeedSource } from './sources';
import type { FeedTab } from './tabs';
import { feedTabKinds } from './tabs';

export type FeedControllerInput = {
  tab: FeedTab;
  author: string | null;
  lookback: NotificationLookbackId;
  pubkey: string | null;
  sessionLoading: boolean;
  threadOpen: boolean;
  meta: Event[];
  muted: MuteState;
  /** Bump when inbox/favorites change. */
  feedRelaysEpoch: number;
  followAuthorsKey: string;
  muteKey: string;
};

export type FeedControllerHandlers = {
  onState: (state: FeedListState) => void;
  onRemember?: (events: Event[]) => void;
};

/**
 * Fetch key for requery — tab + author + since only.
 * Kind/q must never appear here (client view filters).
 */
export function feedControllerFetchKey(
  tab: FeedTab,
  author: string | null,
  lookback: NotificationLookbackId
): string {
  return `${feedFetchKey(tab, author)}:${lookback}`;
}

/**
 * Run one list load cycle (recall + relay retries). Returns a cancel function.
 * Quiet poll is separate via {@link startFeedQuietPoll}.
 */
export function startFeedListLoad(
  input: FeedControllerInput,
  prev: FeedListState,
  handlers: FeedControllerHandlers
): { cancel: () => void; state: FeedListState } {
  let state = { ...prev };
  const emit = (): void => handlers.onState(state);
  const remember = (events: Event[]): void => {
    if (!events.length) return;
    rememberEvents(events);
    handlers.onRemember?.(events);
  };

  const tab = input.tab;
  const author = input.author;
  const lookback = input.lookback;
  const lookbackSec = notificationLookbackSeconds(lookback);
  const listKey = feedFetchKey(tab, author);
  const tabChanged = state.loadedKey !== listKey;
  const lookbackChanged =
    !author && !tabChanged && state.fetchedLookback != null && state.fetchedLookback !== lookback;

  let cancelled = false;

  if (input.threadOpen) {
    return {
      cancel: () => {
        cancelled = true;
      },
      state
    };
  }

  state = { ...state, error: '' };

  if (tabChanged) {
    state = resetForTab(state, listKey);
  } else if (lookbackChanged) {
    state = beginLookbackChange(state, lookback, state.fetchedLookback);
  } else if (!state.items.length && !state.settled) {
    state = { ...state, loading: true };
  }
  emit();

  if ((tab === 'notifications' || tab === 'follows') && !input.pubkey) {
    state = markFeedListSettled(
      { ...state, items: [], pendingNew: [], loading: false },
      lookback
    );
    emit();
    return {
      cancel: () => {
        cancelled = true;
      },
      state
    };
  }

  const sourceCtx = {
    tab,
    author,
    pubkey: input.pubkey,
    meta: input.meta,
    muted: input.muted,
    lookbackSec
  };

  const ingest = (incoming: Event[]): void => {
    if (cancelled || !incoming.length) return;
    remember(incoming);
    state = ingestFeedList(state, incoming, input.muted);
    emit();
  };

  if (
    input.pubkey &&
    input.sessionLoading &&
    !feedRelayGroups().personal.length &&
    tab !== 'notifications'
  ) {
    void recallForFeedSource(sourceCtx).then((cached) => {
      if (cancelled || !cached.length) return;
      ingest(cached);
      state = { ...state, loading: false };
      emit();
    });
    return {
      cancel: () => {
        cancelled = true;
      },
      state
    };
  }

  if (!tabChanged && !lookbackChanged && state.settled && state.items.length) {
    return {
      cancel: () => {
        cancelled = true;
      },
      state
    };
  }

  let timer = 0;
  let resumeWait: (() => void) | null = null;
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      resumeWait = resolve;
      timer = window.setTimeout(resolve, ms);
    });

  void recallForFeedSource(sourceCtx).then((cached) => {
    if (cancelled || !cached.length) return;
    ingest(cached);
    state = { ...state, loading: false };
    emit();
  });

  const markSettled = (): void => {
    state = markFeedListSettled(state, lookback);
    emit();
  };

  void (async () => {
    for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
      try {
        const events = await loadForFeedSource(sourceCtx, (cached) => {
          if (cancelled || !cached.length) return;
          ingest(cached);
          state = { ...state, loading: false };
          emit();
        });
        if (cancelled) return;
        ingest(events);
        const listsMissing =
          tab !== 'notifications' && !!input.pubkey && !feedRelayGroups().personal.length;
        if (state.items.length && !listsMissing) {
          markSettled();
          return;
        }
        if (state.items.length) {
          state = { ...state, loading: false };
          emit();
        }
        if (tab === 'notifications' && state.items.length) {
          markSettled();
          return;
        }
      } catch (err: unknown) {
        if (cancelled) return;
        if (state.items.length) {
          markSettled();
          return;
        }
        state = {
          ...state,
          error: err instanceof Error ? err.message : 'Could not load the feed.'
        };
        markSettled();
        return;
      }
      if (attempt < 3 && !cancelled) await wait(1200);
    }
    if (cancelled) return;
    markSettled();
  })();

  return {
    cancel: () => {
      cancelled = true;
      window.clearTimeout(timer);
      resumeWait?.();
    },
    state
  };
}

/** Quiet refresh: stage newer posts for New Events (never auto-insert). */
export function startFeedQuietPoll(
  input: FeedControllerInput,
  getState: () => FeedListState,
  handlers: FeedControllerHandlers
): () => void {
  if (input.threadOpen) return () => {};
  const state0 = getState();
  if (!state0.settled) return () => {};
  if ((input.tab === 'notifications' || input.tab === 'follows') && !input.pubkey) {
    return () => {};
  }

  let cancelled = false;
  const sourceCtx = {
    tab: input.tab,
    author: input.author,
    pubkey: input.pubkey,
    meta: input.meta,
    muted: input.muted,
    lookbackSec: notificationLookbackSeconds(input.lookback)
  };

  const pull = async () => {
    try {
      const events = await loadForFeedSource(sourceCtx);
      if (cancelled || !events.length) return;
      rememberEvents(events);
      handlers.onRemember?.(events);
      const next = ingestFeedList(getState(), events, input.muted);
      handlers.onState(next);
    } catch {
      /* quiet */
    }
  };

  const first = window.setTimeout(() => void pull(), 15_000);
  const interval = window.setInterval(() => void pull(), 45_000);
  return () => {
    cancelled = true;
    window.clearTimeout(first);
    window.clearInterval(interval);
  };
}

export function admitFeedPendingVisible(
  state: FeedListState,
  visiblePending: Event[]
): FeedListState {
  return admitPendingVisible(state, visiblePending);
}

export { createFeedListState, feedTabKinds };
export type { FeedListState };
