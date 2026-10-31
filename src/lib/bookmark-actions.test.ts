import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  listIncludesEvent,
  membershipListKind,
  tagsIncludeEvent,
  withBookmarkTag,
  withListMembershipTag
} from './bookmark-actions';
import { KIND } from './constants';
import { eventAddress } from './nostr/verify';

function ev(over: Partial<Event> & { tags?: string[][] }): Event {
  return {
    id: over.id ?? 'a'.repeat(64),
    pubkey: over.pubkey ?? 'b'.repeat(64),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? KIND.TEXT_NOTE,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('membershipListKind', () => {
  it('pins own events and bookmarks others', () => {
    const me = '1'.repeat(64);
    const mine = ev({ pubkey: me, kind: KIND.TEXT_NOTE });
    const theirs = ev({ pubkey: '2'.repeat(64), kind: KIND.TEXT_NOTE });
    expect(membershipListKind(mine, me)).toBe(KIND.PIN);
    expect(membershipListKind(theirs, me)).toBe(KIND.BOOKMARK);
  });
});

describe('withListMembershipTag / withBookmarkTag', () => {
  it('preserves other bookmark tags when adding and removing a publication', () => {
    const pub = ev({
      id: 'd'.repeat(64),
      pubkey: 'e'.repeat(64),
      kind: KIND.PUBLICATION,
      tags: [['d', 'book']]
    });
    const existing = ev({
      kind: KIND.BOOKMARK,
      tags: [
        ['a', '30040:ff:other'],
        ['e', '9'.repeat(64)]
      ]
    });
    const added = withBookmarkTag(existing, pub, true);
    expect(added.some((t) => t[0] === 'a' && t[1] === eventAddress(pub))).toBe(true);
    expect(added.some((t) => t[1] === '30040:ff:other')).toBe(true);
    const removed = withBookmarkTag({ ...existing, tags: added }, pub, false);
    expect(removed.some((t) => t[1] === eventAddress(pub))).toBe(false);
    expect(removed.some((t) => t[1] === '30040:ff:other')).toBe(true);
    expect(removed.some((t) => t[1] === '9'.repeat(64))).toBe(true);
  });

  it('uses e-tags for notes; tag bags go through withListMembershipTag', () => {
    const note = ev({ id: 'f'.repeat(64), kind: KIND.TEXT_NOTE });
    const tags = withBookmarkTag(null, note, true);
    expect(tags).toEqual([['e', note.id]]);
    expect(withListMembershipTag([], note, true)).toEqual([['e', note.id]]);
    expect(listIncludesEvent(ev({ kind: KIND.BOOKMARK, tags }), note)).toBe(true);
    expect(tagsIncludeEvent(tags, note)).toBe(true);
  });
});
