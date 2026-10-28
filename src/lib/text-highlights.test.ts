import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { mergeInkIntoHighlights, textHighlightsFromEvents } from './text-highlights';

function hl(partial: Partial<Event> & Pick<Event, 'id' | 'pubkey' | 'content'>): Event {
  return {
    kind: 9802,
    created_at: 1,
    tags: [],
    sig: '',
    ...partial
  };
}

describe('textHighlightsFromEvents', () => {
  it('carries highlight event ids for thread deep-links', () => {
    const id = 'c'.repeat(64);
    const pk = 'd'.repeat(64);
    const out = textHighlightsFromEvents([
      hl({ id, pubkey: pk, content: 'A quote long enough to mark in the body.' })
    ]);
    expect(out).toEqual([
      {
        quote: 'A quote long enough to mark in the body.',
        pubkey: pk,
        eventId: id
      }
    ]);
  });

  it('includes NIP-84 comment notes on highlights', () => {
    const id = 'c'.repeat(64);
    const pk = 'd'.repeat(64);
    const out = textHighlightsFromEvents([
      hl({
        id,
        pubkey: pk,
        content: 'A quote long enough to mark in the body.',
        tags: [['comment', '  My margin note  ']]
      })
    ]);
    expect(out[0]?.note).toBe('My margin note');
  });

  it('merges ink chips onto matching highlight quotes', () => {
    const id = 'c'.repeat(64);
    const inkId = 'e'.repeat(64);
    const pk = 'd'.repeat(64);
    const quote = 'A quote long enough to mark in the body.';
    const merged = mergeInkIntoHighlights(
      textHighlightsFromEvents([hl({ id, pubkey: pk, content: quote })]),
      [{ eventId: inkId, quote, gifUrl: 'https://cdn.example.com/a.gif', pubkey: pk }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.eventId).toBe(id);
    expect(merged[0]?.inkUrl).toBe('https://cdn.example.com/a.gif');
    expect(merged[0]?.inkEventId).toBe(inkId);
  });
});
