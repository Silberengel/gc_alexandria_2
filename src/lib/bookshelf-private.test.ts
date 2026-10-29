import { describe, expect, it } from 'vitest';
import { KIND } from './constants';
import {
  createBookshelfDirectoryDraftParts,
  directoryContainsPublication,
  directoryMembershipKey,
  privateMembershipKeys,
  splitDirectoryTags
} from './bookshelf';
import { directoryExplorerEntries } from './directory-explorer';
import type { Event } from 'nostr-tools';

const pk = 'b'.repeat(64);
const pub = {
  id: 'c'.repeat(64),
  kind: KIND.PUBLICATION,
  pubkey: pk,
  tags: [['d', 'edition-one']]
};
const coord = `${KIND.PUBLICATION}:${pk}:edition-one`;

describe('directory private memberships', () => {
  it('adds a private membership into privateTags only', () => {
    const existing = { tags: [['d', 'my-book-collection']] };
    const parts = createBookshelfDirectoryDraftParts(existing, [], 'my-book-collection', pub, {
      addAsPrivate: true
    });
    if ('error' in parts) throw new Error('unexpected full');
    expect(parts.added).toBe(true);
    expect(parts.tags.some((t) => t[0] === 'a' && t[1] === coord)).toBe(false);
    expect(parts.privateTags.some((t) => t[0] === 'a' && t[1] === coord)).toBe(true);
    expect(directoryContainsPublication(existing, pub, parts.privateTags)).toBe(true);
  });

  it('removes a private membership from both buckets', () => {
    const aTag = ['a', coord, '', pub.id];
    const existing = { tags: [['d', 'my-book-collection']] };
    const parts = createBookshelfDirectoryDraftParts(
      existing,
      [aTag],
      'my-book-collection',
      pub
    );
    if ('error' in parts) throw new Error('unexpected full');
    expect(parts.added).toBe(false);
    expect(parts.privateTags).toEqual([]);
    expect(parts.tags.some((t) => t[0] === 'a')).toBe(false);
  });

  it('splits public vs private by membership keys', () => {
    const aTag = ['a', coord, '', pub.id];
    const other = ['a', `${KIND.PUBLICATION}:${pk}:other`, '', 'd'.repeat(64)];
    const { publicTags, privateTags } = splitDirectoryTags(
      [['d', 'root'], aTag, other],
      new Set([directoryMembershipKey(aTag)!])
    );
    expect(publicTags.map((t) => t[0] + ':' + (t[1] ?? ''))).toEqual([
      'd:root',
      `a:${KIND.PUBLICATION}:${pk}:other`
    ]);
    expect(privateMembershipKeys(privateTags).has(`a:${coord}`)).toBe(true);
  });

  it('lists private explorer entries with a private marker', () => {
    const dir = { tags: [['d', 'root']] } as Pick<Event, 'tags'>;
    const priv = [['a', `${KIND.DIRECTORY}:${pk}:nested`, '', 'e'.repeat(64)]];
    const entries = directoryExplorerEntries(dir, priv);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.private).toBe(true);
    expect(entries[0]?.role).toBe('folder');
  });
});
