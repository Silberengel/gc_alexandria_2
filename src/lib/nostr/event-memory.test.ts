import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { memoryFindByAddress, rememberEvents } from './event-memory';

function pub(d: string, created_at = 1): Event {
  return {
    id: d.padEnd(64, '0').slice(0, 64),
    pubkey: 'a'.repeat(64),
    created_at,
    kind: 30040,
    tags: [
      ['d', d],
      ['title', `Title ${d}`]
    ],
    content: '',
    sig: 'b'.repeat(128)
  };
}

describe('event-memory', () => {
  it('recalls a shelf event by kind+author+d without Cache Storage', () => {
    const event = pub('koran');
    rememberEvents([event]);
    expect(memoryFindByAddress(30040, 'a'.repeat(64), 'koran')?.tags[1]?.[1]).toBe('Title koran');
    expect(memoryFindByAddress(30040, 'a'.repeat(64), 'Koran')?.id).toBe(event.id);
  });

  it('keeps the newest replaceable version', () => {
    rememberEvents([pub('jane', 1), pub('jane', 5)]);
    expect(memoryFindByAddress(30040, 'a'.repeat(64), 'jane')?.created_at).toBe(5);
  });
});
