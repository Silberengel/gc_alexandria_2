import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { findQuoteOffset, inkMarginChipsFromEvents, isInkMarginComment } from './ink-margin';

function ev(partial: Partial<Event> & Pick<Event, 'content'>): Event {
  return {
    id: '1'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1,
    kind: 1111,
    tags: [],
    sig: 'b'.repeat(128),
    ...partial
  };
}

describe('ink-margin', () => {
  it('detects quote + gif comments', () => {
    const ink = ev({
      content: '> Hello world\n\nhttps://cdn.example.com/sketch.gif'
    });
    expect(isInkMarginComment(ink)).toBe(true);
    expect(isInkMarginComment(ev({ content: 'just a gif https://x.com/a.gif' }))).toBe(false);
    const chips = inkMarginChipsFromEvents([ink]);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.quote).toBe('Hello world');
    expect(chips[0]?.gifUrl).toContain('.gif');
  });

  it('detects quote + static png ink', () => {
    const ink = ev({
      content: '> Hello world\n\nhttps://cdn.example.com/sketch.png'
    });
    expect(isInkMarginComment(ink)).toBe(true);
    expect(inkMarginChipsFromEvents([ink])[0]?.gifUrl).toContain('.png');
  });

  it('finds quotes in haystacks', () => {
    expect(findQuoteOffset('aaa Hello world bbb', 'Hello world')).toBe(4);
    expect(findQuoteOffset('aaa', 'zzz')).toBe(-1);
  });
});
