import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  PROFILE_BOOKMARK_FETCH_LIMIT,
  bookmarkItemsFromTags,
  isProfileBookmarksSegment,
  privateBookmarkTags,
  profileBookmarkSections,
  profileBookmarksPath,
  resolveBookmarkItems
} from './profile-bookmarks';

const pk = 'b'.repeat(64);

function ev(over: Partial<Event> & { tags?: string[][] }): Event {
  return {
    id: (over.id ?? 'a'.repeat(64)).toLowerCase(),
    pubkey: (over.pubkey ?? pk).toLowerCase(),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? KIND.BOOKMARK,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('profile bookmarks path', () => {
  it('accepts the bookmarks segment and keeps a NIP-05 id', () => {
    expect(isProfileBookmarksSegment('bookmarks')).toBe(true);
    expect(isProfileBookmarksSegment('Bookmarks')).toBe(true);
    expect(isProfileBookmarksSegment('30003')).toBe(false);
    expect(profileBookmarksPath('roland@pareto.space')).toBe('/p/roland@pareto.space/bookmarks');
  });
});

describe('bookmarkItemsFromTags', () => {
  it('keeps e, a, t, and r in order and drops list metadata', () => {
    const note = '1'.repeat(64);
    const items = bookmarkItemsFromTags([
      ['d', 'reading'],
      ['title', 'Reading'],
      ['e', note, 'wss://relay.example'],
      ['a', `30023:${pk}:essay`],
      ['t', '#Nostr'],
      ['r', 'https://example.com/post'],
      ['e', 'not-an-id'],
      ['r', 'javascript:alert(1)']
    ]);
    expect(items.map((item) => item.type)).toEqual(['event', 'address', 'tag', 'url']);
    expect(items[0]).toMatchObject({ id: note, relay: 'wss://relay.example' });
    expect(items[1]).toMatchObject({ address: `30023:${pk}:essay` });
    expect(items[2]).toMatchObject({ tag: 'Nostr', key: 't:nostr' });
    expect(items[3]).toMatchObject({ url: 'https://example.com/post' });
  });

  it('dedupes the same address written as npub and hex', () => {
    const items = bookmarkItemsFromTags([
      ['a', `30040:${pk}:book`],
      ['a', `30040:${pk}:book`, 'wss://other.example']
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe(`a:30040:${pk}:book`);
  });
});

describe('profileBookmarkSections', () => {
  it('puts the kind 10003 list first and sorts sets by title', () => {
    const note = '2'.repeat(64);
    const sections = profileBookmarkSections([
      ev({
        id: '3'.repeat(64),
        kind: KIND.BOOKMARK_SET,
        created_at: 5,
        tags: [
          ['d', 'zeta'],
          ['title', 'Zeta'],
          ['e', note]
        ]
      }),
      ev({
        id: '4'.repeat(64),
        kind: KIND.BOOKMARK_SET,
        created_at: 9,
        tags: [
          ['d', 'alpha'],
          ['title', 'Alpha'],
          ['description', 'A short list']
        ]
      }),
      ev({
        id: '5'.repeat(64),
        kind: KIND.BOOKMARK,
        created_at: 2,
        tags: [['e', note]]
      }),
      ev({
        id: '6'.repeat(64),
        kind: KIND.BOOKMARK,
        created_at: 1,
        tags: [['e', '7'.repeat(64)]]
      })
    ]);
    expect(sections.map((section) => section.title)).toEqual(['Bookmarks', 'Alpha', 'Zeta']);
    expect(sections[0]?.listKind).toBe(KIND.BOOKMARK);
    expect(sections[0]?.items).toHaveLength(1);
    expect(sections[1]?.description).toBe('A short list');
    expect(sections[1]?.items).toHaveLength(0);
  });

  it('appends private rows that are not already public', async () => {
    const list = ev({
      id: '8'.repeat(64),
      kind: KIND.BOOKMARK,
      tags: [['e', '1'.repeat(64)]],
      content: JSON.stringify([['e', '1'.repeat(64)], ['t', 'secret']])
    });
    const privateTags = await privateBookmarkTags(list);
    const sections = profileBookmarkSections([list], new Map([[list.id, privateTags]]));
    expect(sections[0]?.items.map((item) => item.key)).toEqual([`e:${'1'.repeat(64)}`, 't:secret']);
  });

  it('omits event pointers past the fetch cap and still keeps later urls', () => {
    const tags: string[][] = [];
    for (let i = 0; i < PROFILE_BOOKMARK_FETCH_LIMIT + 3; i += 1) {
      tags.push(['e', i.toString(16).padStart(64, 'a')]);
    }
    tags.push(['r', 'https://example.com/kept']);
    const sections = profileBookmarkSections([
      ev({ id: '9'.repeat(64), kind: KIND.BOOKMARK, tags })
    ]);
    const items = sections[0]?.items ?? [];
    expect(items.filter((item) => item.type === 'event')).toHaveLength(PROFILE_BOOKMARK_FETCH_LIMIT);
    expect(items.at(-1)).toMatchObject({ type: 'url', url: 'https://example.com/kept' });
    expect(sections[0]?.omitted).toBe(3);
  });
});

describe('resolveBookmarkItems', () => {
  it('resolves event and address pointers and records misses', async () => {
    const note = ev({ id: 'd'.repeat(64), kind: 1, content: 'hello' });
    const map = await resolveBookmarkItems(
      [
        { type: 'event', key: `e:${note.id}`, id: note.id, relay: 'wss://relay.example' },
        { type: 'address', key: 'a:30023:missing:d', address: '30023:missing:d' },
        { type: 'url', key: 'r:https://example.com', url: 'https://example.com' }
      ],
      {
        eventById: async (id, relay) => {
          expect(relay).toBe('wss://relay.example');
          return id === note.id ? note : null;
        },
        eventByAddress: async () => null
      }
    );
    expect(map.get(`e:${note.id}`)?.id).toBe(note.id);
    expect(map.get('a:30023:missing:d')).toBeNull();
    expect(map.has('r:https://example.com')).toBe(false);
  });
});
