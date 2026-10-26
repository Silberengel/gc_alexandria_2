import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { pinEventIds, pickPinList, resolvePinnedNotes, samePinnedNoteIds } from './profile-pins';
import { rememberEvents } from './nostr/event-memory';

function ev(over: Partial<Event> & { tags?: string[][] }): Event {
  return {
    id: (over.id ?? 'a'.repeat(64)).toLowerCase(),
    pubkey: (over.pubkey ?? 'b'.repeat(64)).toLowerCase(),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? 1,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('profile pins', () => {
  it('extracts ordered unique e-tag ids from a kind 10001 list', () => {
    const id1 = '1'.repeat(64);
    const id2 = '2'.repeat(64);
    const list = ev({
      kind: KIND.PIN,
      tags: [
        ['e', id1],
        ['p', 'd'.repeat(64)],
        ['e', id2],
        ['e', id1]
      ]
    });
    expect(pinEventIds(list)).toEqual([id1, id2]);
    expect(pinEventIds(ev({ kind: KIND.BOOKMARK, tags: [['e', id1]] }))).toEqual([]);
  });

  it('picks the newest pin list for a pubkey', () => {
    const pk = 'b'.repeat(64);
    const older = ev({ id: '1'.repeat(64), kind: KIND.PIN, pubkey: pk, created_at: 1 });
    const newer = ev({ id: '2'.repeat(64), kind: KIND.PIN, pubkey: pk, created_at: 5 });
    const other = ev({ id: '3'.repeat(64), kind: KIND.PIN, pubkey: 'c'.repeat(64), created_at: 9 });
    expect(pickPinList([older, newer, other], pk)?.id).toBe(newer.id);
  });

  it('compares pinned note id sequences', () => {
    const a = ev({ id: 'a'.repeat(64) });
    const b = ev({ id: 'b'.repeat(64) });
    expect(samePinnedNoteIds([a, b], [a, b])).toBe(true);
    expect(samePinnedNoteIds([a, b], [b, a])).toBe(false);
    expect(samePinnedNoteIds([a], [])).toBe(false);
  });

  it('resolves pinned note ids via memory and fetch fallback', async () => {
    const noteA = ev({ id: 'a'.repeat(64), kind: KIND.TEXT_NOTE, content: 'first' });
    const noteB = ev({ id: 'b'.repeat(64), kind: KIND.TEXT_NOTE, content: 'second' });
    rememberEvents([noteA]);
    const list = ev({
      kind: KIND.PIN,
      tags: [
        ['e', noteA.id],
        ['e', noteB.id],
        ['e', 'f'.repeat(64)]
      ]
    });
    const notes = await resolvePinnedNotes(list, {
      fetchIds: async (ids) => {
        expect(ids).toEqual([noteB.id, 'f'.repeat(64)]);
        return [noteB];
      }
    });
    expect(notes.map((e) => e.id)).toEqual([noteA.id, noteB.id]);
  });
});
