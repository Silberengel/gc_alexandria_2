import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  deprecatedListD,
  findPendingNip51Migrations,
  isDeprecatedFollowSetMute,
  pickMuteList,
  pickPinListWithDeprecated,
  standardListTagsFromDeprecated
} from './nip51-deprecated-lists';
import { followPubkeysFromMetadata } from './mute';

function ev(over: Partial<Event> & { kind: number; tags: string[][] }): Event {
  return {
    id: over.id ?? 'a'.repeat(64),
    pubkey: over.pubkey ?? 'b'.repeat(64),
    created_at: over.created_at ?? 1,
    kind: over.kind,
    tags: over.tags,
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('nip51 deprecated lists', () => {
  const pk = '1'.repeat(64);

  it('recognizes deprecated mute / pin / bookmark / communities', () => {
    expect(
      deprecatedListD(ev({ kind: KIND.FOLLOW_SET, pubkey: pk, tags: [['d', 'mute'], ['p', '2'.repeat(64)]] }))
    ).toBe('mute');
    expect(
      deprecatedListD(
        ev({ kind: KIND.DEPRECATED_CATEGORIZED_LIST, pubkey: pk, tags: [['d', 'pin'], ['e', '3'.repeat(64)]] })
      )
    ).toBe('pin');
    expect(
      deprecatedListD(
        ev({
          kind: KIND.DEPRECATED_CATEGORIZED_LIST,
          pubkey: pk,
          tags: [['d', 'bookmark'], ['e', '3'.repeat(64)]]
        })
      )
    ).toBe('bookmark');
    expect(
      deprecatedListD(
        ev({
          kind: KIND.DEPRECATED_CATEGORIZED_LIST,
          pubkey: pk,
          tags: [['d', 'communities'], ['a', '34550:x:y']]
        })
      )
    ).toBe('communities');
    expect(
      deprecatedListD(ev({ kind: KIND.FOLLOW_SET, pubkey: pk, tags: [['d', 'friends'], ['p', '2'.repeat(64)]] }))
    ).toBeNull();
  });

  it('prefers kind 10000 mute over deprecated 30000 d=mute', () => {
    const deprecated = ev({
      id: 'd'.repeat(64),
      kind: KIND.FOLLOW_SET,
      pubkey: pk,
      created_at: 50,
      tags: [['d', 'mute'], ['p', '2'.repeat(64)]]
    });
    const standard = ev({
      id: 'e'.repeat(64),
      kind: KIND.MUTE,
      pubkey: pk,
      created_at: 10,
      tags: [['p', '3'.repeat(64)]]
    });
    expect(pickMuteList([deprecated, standard], pk)?.id).toBe(standard.id);
    expect(pickMuteList([deprecated], pk)?.id).toBe(deprecated.id);
  });

  it('falls back to deprecated pin when no 10001 exists', () => {
    const pin = ev({
      kind: KIND.DEPRECATED_CATEGORIZED_LIST,
      pubkey: pk,
      tags: [['d', 'pin'], ['e', '4'.repeat(64)]]
    });
    expect(pickPinListWithDeprecated([pin], pk)?.id).toBe(pin.id);
  });

  it('does not treat deprecated mute as a follow set', () => {
    const mute = ev({
      kind: KIND.FOLLOW_SET,
      pubkey: pk,
      tags: [['d', 'mute'], ['p', '2'.repeat(64)]]
    });
    const friends = ev({
      id: 'f'.repeat(64),
      kind: KIND.FOLLOW_SET,
      pubkey: pk,
      tags: [['d', 'friends'], ['p', '3'.repeat(64)]]
    });
    expect(isDeprecatedFollowSetMute(mute)).toBe(true);
    expect(followPubkeysFromMetadata([mute, friends])).toEqual(new Set(['3'.repeat(64)]));
  });

  it('lists pending migrations and strips d from standard tags', () => {
    const mute = ev({
      kind: KIND.FOLLOW_SET,
      pubkey: pk,
      tags: [['d', 'mute'], ['p', '2'.repeat(64)], ['word', 'spam']]
    });
    const pending = findPendingNip51Migrations([mute], pk);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.standardKind).toBe(KIND.MUTE);
    expect(standardListTagsFromDeprecated(mute)).toEqual([
      ['p', '2'.repeat(64)],
      ['word', 'spam']
    ]);
  });

  it('still offers migration when a newer standard list already exists', () => {
    const mute = ev({
      id: 'd'.repeat(64),
      kind: KIND.FOLLOW_SET,
      pubkey: pk,
      created_at: 1,
      tags: [['d', 'mute'], ['p', '2'.repeat(64)]]
    });
    const standard = ev({
      id: 'e'.repeat(64),
      kind: KIND.MUTE,
      pubkey: pk,
      created_at: 9,
      tags: [['p', '2'.repeat(64)]]
    });
    const pending = findPendingNip51Migrations([mute, standard], pk);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.deprecated.id).toBe(mute.id);
  });
});
