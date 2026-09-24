import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  compareReplaceableNewestFirst,
  isAddressableKind,
  isNewerReplaceable,
  isReplaceableKind,
  pickLatestAddressable,
  pickLatestReplaceable,
  pruneToLatestReplaceables,
  replaceableCoord
} from './replaceable';

function ev(over: Partial<Event> & { id: string; kind: number }): Event {
  return {
    id: over.id.toLowerCase(),
    pubkey: (over.pubkey ?? 'a'.repeat(64)).toLowerCase(),
    created_at: over.created_at ?? 1,
    kind: over.kind,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig ?? 'b'.repeat(128)
  };
}

describe('NIP-01 replaceable helpers', () => {
  it('classifies replaceable and addressable kinds', () => {
    expect(isReplaceableKind(0)).toBe(true);
    expect(isReplaceableKind(3)).toBe(true);
    expect(isReplaceableKind(16374)).toBe(true);
    expect(isReplaceableKind(10003)).toBe(true);
    expect(isReplaceableKind(1)).toBe(false);
    expect(isAddressableKind(30040)).toBe(true);
    expect(isAddressableKind(30045)).toBe(true);
    expect(isAddressableKind(16374)).toBe(false);
  });

  it('builds coords for replaceable and addressable events', () => {
    const pk = 'c'.repeat(64);
    expect(replaceableCoord(ev({ id: '1'.repeat(64), kind: 16374, pubkey: pk }))).toBe(
      `16374:${pk}`
    );
    expect(
      replaceableCoord(ev({ id: '2'.repeat(64), kind: 30045, pubkey: pk, tags: [['d', 'folder']] }))
    ).toBe(`30045:${pk}:folder`);
    expect(replaceableCoord(ev({ id: '3'.repeat(64), kind: 1985, pubkey: pk }))).toBeNull();
  });

  it('prefers higher created_at, then lowest id on a tie', () => {
    const older = ev({ id: 'f'.repeat(64), kind: 0, created_at: 1 });
    const newer = ev({ id: '0'.repeat(64), kind: 0, created_at: 2 });
    expect(isNewerReplaceable(newer, older)).toBe(true);
    expect(isNewerReplaceable(older, newer)).toBe(false);

    const low = ev({ id: 'a'.repeat(64), kind: 0, created_at: 5 });
    const high = ev({ id: 'f'.repeat(64), kind: 0, created_at: 5 });
    expect(isNewerReplaceable(low, high)).toBe(true);
    expect(isNewerReplaceable(high, low)).toBe(false);
    expect(compareReplaceableNewestFirst(low, high)).toBeLessThan(0);
  });

  it('picks the NIP-01 winner among replaceables', () => {
    const pk = 'd'.repeat(64);
    const stale = ev({ id: '1'.repeat(64), kind: 16374, pubkey: pk, created_at: 10 });
    const fresh = ev({ id: '2'.repeat(64), kind: 16374, pubkey: pk, created_at: 20 });
    const other = ev({ id: '3'.repeat(64), kind: 16374, pubkey: 'e'.repeat(64), created_at: 99 });
    expect(pickLatestReplaceable([stale, fresh, other], 16374, pk)?.id).toBe(fresh.id);
    expect(pickLatestReplaceable([stale, fresh, other], 16374)?.id).toBe(other.id);
  });

  it('picks the newest addressable by d', () => {
    const pk = 'd'.repeat(64);
    const a = ev({
      id: '1'.repeat(64),
      kind: 30045,
      pubkey: pk,
      created_at: 1,
      tags: [['d', 'adventure']]
    });
    const b = ev({
      id: '2'.repeat(64),
      kind: 30045,
      pubkey: pk,
      created_at: 2,
      tags: [['d', 'adventure']]
    });
    const c = ev({
      id: '3'.repeat(64),
      kind: 30045,
      pubkey: pk,
      created_at: 9,
      tags: [['d', 'other']]
    });
    expect(pickLatestAddressable([a, b, c], 30045, pk, 'adventure')?.id).toBe(b.id);
  });

  it('prunes to one winner per coord while keeping regular events', () => {
    const pk = 'd'.repeat(64);
    const oldQ = ev({ id: '1'.repeat(64), kind: 16374, pubkey: pk, created_at: 1 });
    const newQ = ev({ id: '2'.repeat(64), kind: 16374, pubkey: pk, created_at: 2 });
    const label = ev({ id: '3'.repeat(64), kind: 1985, pubkey: pk, created_at: 1 });
    const pruned = pruneToLatestReplaceables([oldQ, newQ, label]);
    expect(pruned.map((e) => e.id).sort()).toEqual([newQ.id, label.id].sort());
  });
});
