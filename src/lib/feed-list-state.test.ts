import { describe, expect, it } from 'vitest';
import {
  clearFeedListRestore,
  discardFeedListState,
  feedListPathHasPendingRestore,
  peekFeedListState,
  rearmFeedListRestore,
  saveFeedListState,
  takeFeedListRestore
} from './feed-list-state';
import type { Event } from 'nostr-tools';

function ev(id: string): Event {
  return {
    id: id.padEnd(64, '0'),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: 'hi',
    sig: 'c'.repeat(128)
  };
}

describe('feed-list-state', () => {
  it('saves a one-shot restore for Back from a thread', () => {
    discardFeedListState();
    const id = ev('a').id.toLowerCase();
    saveFeedListState({
      tab: 'replies',
      items: [ev('a')],
      shown: { [id]: true },
      boostExcerpts: {},
      scrollY: 420,
      focusId: id,
      listSettled: true
    });
    expect(feedListPathHasPendingRestore()).toBe(true);
    expect(peekFeedListState()?.focusId).toBe(id);
    expect(rearmFeedListRestore()).toBe(true);
    const snap = takeFeedListRestore();
    expect(snap?.tab).toBe('replies');
    expect(snap?.focusId).toBe(id);
    expect(snap?.items).toHaveLength(1);
    expect(takeFeedListRestore()).toBeNull();
    clearFeedListRestore();
    expect(feedListPathHasPendingRestore()).toBe(false);
  });
});
