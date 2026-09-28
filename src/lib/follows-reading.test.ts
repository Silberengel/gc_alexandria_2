import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { groupFollowsReadingByPublication } from './follows-reading';

function queue(pubkey: string, books: [string, number][], created_at = 10): Event {
  return {
    id: pubkey.slice(0, 8).padEnd(64, '0'),
    kind: KIND.READING_QUEUE,
    pubkey,
    created_at,
    content: '',
    tags: books.map(([a, updated]) => ['book', a, '0', '10', '', String(updated)]),
    sig: 'b'.repeat(128)
  };
}

const a1 = `30040:${'c'.repeat(64)}:book-one`;
const a2 = `30040:${'d'.repeat(64)}:book-two`;

describe('groupFollowsReadingByPublication', () => {
  it('groups by publication and sorts by reader count', () => {
    const pk1 = '1'.repeat(64);
    const pk2 = '2'.repeat(64);
    const pk3 = '3'.repeat(64);
    const rows = groupFollowsReadingByPublication([
      queue(pk1, [[a1, 100], [a2, 50]]),
      queue(pk2, [[a1, 90]]),
      queue(pk3, [[a2, 80]])
    ]);
    expect(rows[0]?.address).toBe(a1);
    expect(rows[0]?.readers.size).toBe(2);
    expect(rows[1]?.address).toBe(a2);
    expect(rows[1]?.readers.size).toBe(2);
  });

  it('excludes the viewer and respects concurrent active slots', () => {
    const me = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    const rows = groupFollowsReadingByPublication(
      [queue(me, [[a1, 1]]), queue(other, [[a1, 2], [a2, 3], [`30040:${'e'.repeat(64)}:third`, 4]])],
      { concurrent: 2, excludePubkey: me }
    );
    expect(rows.every((r) => !r.readers.has(me))).toBe(true);
    // concurrent=2 keeps a1 (updated 2) and a2 (updated 3); newest activity first.
    expect(rows.map((r) => r.address)).toEqual([a2, a1]);
  });
});
