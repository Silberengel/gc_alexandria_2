import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { rememberEvents } from './nostr/event-memory';
import {
  isRepostKind,
  parseEmbeddedRepostEvent,
  peekRepostExcerpt,
  repostTargetId
} from './repost';

function ev(partial: Partial<Event> & Pick<Event, 'kind'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('repost', () => {
  it('recognizes kind 6 and 16', () => {
    expect(isRepostKind(KIND.REPOST)).toBe(true);
    expect(isRepostKind(KIND.GENERIC_REPOST)).toBe(true);
    expect(isRepostKind(KIND.TEXT_NOTE)).toBe(false);
  });

  it('reads the NIP-18 e target and embedded JSON', () => {
    const targetId = 'd'.repeat(64);
    expect(
      repostTargetId(
        ev({
          kind: KIND.REPOST,
          tags: [
            ['e', targetId],
            ['p', 'b'.repeat(64)]
          ]
        })
      )
    ).toBe(targetId);

    const embedded = ev({
      id: targetId,
      kind: KIND.TEXT_NOTE,
      content: 'hello from note'
    });
    const parsed = parseEmbeddedRepostEvent(JSON.stringify(embedded));
    expect(parsed?.id).toBe(targetId);
    expect(
      peekRepostExcerpt(ev({ kind: KIND.REPOST, content: JSON.stringify(embedded) }))
    ).toBe('hello from note');
  });

  it('uses memory for an empty kind-6 boost', () => {
    const targetId = 'e'.repeat(64);
    rememberEvents([
      ev({
        id: targetId,
        kind: KIND.TEXT_NOTE,
        content: 'boosted text'
      })
    ]);
    expect(
      peekRepostExcerpt(
        ev({
          kind: KIND.REPOST,
          tags: [
            ['e', targetId],
            ['p', 'b'.repeat(64)]
          ]
        })
      )
    ).toBe('boosted text');
  });
});
