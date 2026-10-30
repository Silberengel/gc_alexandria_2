import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { emptyMuteState } from '../mute';
import { applyFeedView } from './view';
import {
  admitPendingVisible,
  createFeedListState,
  feedFetchKey,
  ingestFeedList,
  markFeedListSettled
} from './list-store';
import { feedControllerFetchKey } from './controller';
import { socialAskFilters } from './relay-plan';
import { KIND } from '../constants';

function ev(partial: Partial<Event> & { id: string; kind?: number }): Event {
  return {
    id: partial.id.padEnd(64, '0').slice(0, 64),
    pubkey: (partial.pubkey ?? 'b'.repeat(64)).toLowerCase(),
    created_at: partial.created_at ?? 100,
    kind: partial.kind ?? KIND.TEXT_NOTE,
    tags: partial.tags ?? [],
    content: partial.content ?? 'hi',
    sig: 'c'.repeat(128)
  };
}

describe('applyFeedView', () => {
  it('filters by kind and text for the timeline and pending alike', () => {
    const muted = emptyMuteState();
    const events = [
      ev({ id: '1', kind: KIND.HIGHLIGHT, content: 'alpha', created_at: 200 }),
      ev({ id: '2', kind: KIND.TEXT_NOTE, content: 'alpha', created_at: 190 }),
      ev({ id: '3', kind: KIND.HIGHLIGHT, content: 'beta', created_at: 180 })
    ];
    const view = applyFeedView(events, {
      sinceUnix: null,
      kind: KIND.HIGHLIGHT,
      q: 'alpha',
      muted,
      author: null
    });
    expect(view.map((e) => e.id[0])).toEqual(['1']);
  });
});

describe('admitPendingVisible', () => {
  it('admits only view-matching pending so kind filter does not vanish rows', () => {
    const muted = emptyMuteState();
    let state = createFeedListState();
    const shown = ev({ id: '1', kind: KIND.HIGHLIGHT, created_at: 100 });
    state = ingestFeedList(state, [shown], muted);
    state = markFeedListSettled(state, '24h');
    const note = ev({ id: '2', kind: KIND.TEXT_NOTE, created_at: 200 });
    const highlight = ev({ id: '3', kind: KIND.HIGHLIGHT, created_at: 210 });
    state = ingestFeedList(state, [note, highlight], muted);
    expect(state.pendingNew).toHaveLength(2);

    const visiblePending = applyFeedView(state.pendingNew, {
      sinceUnix: null,
      kind: KIND.HIGHLIGHT,
      q: '',
      muted,
      author: null
    });
    expect(visiblePending).toHaveLength(1);
    state = admitPendingVisible(state, visiblePending);
    expect(state.items.map((e) => e.id[0]).sort()).toEqual(['1', '3']);
    expect(state.pendingNew.map((e) => e.id[0])).toEqual(['2']);
  });
});

describe('fetch key', () => {
  it('includes tab author and since, not kind', () => {
    expect(feedFetchKey('replies', null)).toBe('replies:');
    expect(feedControllerFetchKey('replies', null, '1w')).toBe('replies::1w');
    expect(feedControllerFetchKey('replies', null, '1w')).not.toContain('9802');
  });
});

describe('socialAskFilters', () => {
  it('packs note/post/highlight/comment/repost into one filter array', () => {
    const filters = socialAskFilters();
    expect(filters.length).toBe(5);
    expect(filters.some((f) => f.kinds?.includes(KIND.HIGHLIGHT) && f.kinds?.length === 1)).toBe(
      true
    );
  });
});
