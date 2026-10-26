import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { textHighlightsFromEvents } from './text-highlights';

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
});
