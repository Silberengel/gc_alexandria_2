import { afterEach, describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { MY_BOOK_COLLECTION_D_TAG } from './bookshelf';
import {
  rememberDeletedTarget,
  resetDeletionStateForTests
} from './deletions';
import { GITCITADEL_CURATOR_HEX } from './hex';
import {
  childGuideFolderDTags,
  defaultStarterGuideChips,
  starterGuideChipsFromBookshelf,
  starterGuideChipsFromDirectories,
  starterGuideCoordinate,
  starterGuideTitle
} from './starter-guides';

function dir(d: string, childDs: string[], created_at = 1): Event {
  const tags: string[][] = [['d', d]];
  for (const child of childDs) {
    tags.push(['a', `${KIND.DIRECTORY}:${GITCITADEL_CURATOR_HEX}:${child}`, '', 'a'.repeat(64)]);
  }
  return {
    id: `${d}-${created_at}`.padEnd(64, '0').slice(0, 64),
    kind: KIND.DIRECTORY,
    pubkey: GITCITADEL_CURATOR_HEX,
    created_at,
    content: '',
    tags,
    sig: 'b'.repeat(128)
  };
}

function leaf(d: string, created_at = 1, title?: string): Event {
  const tags: string[][] = [['d', d]];
  if (title) tags.push(['title', title]);
  return {
    ...dir(d, [], created_at),
    tags
  };
}

describe('starter guides', () => {
  afterEach(() => {
    resetDeletionStateForTests();
  });

  it('maps display titles for genres and humanizes unknown d-tags', () => {
    expect(starterGuideTitle('ancient-classics')).toBe('Ancient classics');
    expect(starterGuideTitle('classic-novels')).toBe('Classic novels');
    expect(starterGuideTitle('catholic-classics')).toBe('Catholic classics');
    expect(starterGuideTitle('black-authors')).toBe('Black authors');
    expect(starterGuideTitle('reading-guides')).toBe('Reading guides');
    expect(starterGuideTitle('new-shelf-folder')).toBe('New shelf folder');
  });

  it('builds curator coordinates', () => {
    expect(starterGuideCoordinate('great-books')).toBe(
      `${KIND.DIRECTORY}:${GITCITADEL_CURATOR_HEX}:great-books`
    );
  });

  it('lists nested folder d-tags from my-book-collection in tag order', () => {
    const shelf = dir(MY_BOOK_COLLECTION_D_TAG, [
      'reading-guides',
      'ancient-classics',
      'great-books'
    ]);
    expect(childGuideFolderDTags(shelf)).toEqual([
      'reading-guides',
      'ancient-classics',
      'great-books'
    ]);
  });

  it('builds chips from bookshelf membership, preferring title tags', () => {
    const shelf = dir(MY_BOOK_COLLECTION_D_TAG, [
      'ancient-classics',
      'great-books',
      'reading-guides'
    ]);
    const chips = starterGuideChipsFromBookshelf(shelf, [
      leaf('ancient-classics', 1, 'Ancient Classics'),
      leaf('great-books'),
      leaf('reading-guides')
    ]);
    expect(chips.map((c) => c.d)).toEqual([
      'ancient-classics',
      'great-books',
      'reading-guides'
    ]);
    expect(chips[0]?.title).toBe('Ancient Classics');
    expect(chips[1]?.title).toBe('Great books');
    expect(chips[0]?.href).toContain('bookshelf=ancient-classics');
    expect(chips[0]?.href).toContain('npub=');
  });

  it('returns empty chips when the bookshelf is missing', () => {
    expect(starterGuideChipsFromBookshelf(null)).toEqual([]);
    expect(starterGuideChipsFromDirectories([])).toEqual([]);
  });

  it('paints default guide chips without waiting on relays', () => {
    const chips = defaultStarterGuideChips();
    expect(chips.map((c) => c.d)).toEqual([
      'ancient-classics',
      'great-books',
      'catholic-classics',
      'classic-novels',
      'classic-documents',
      'black-authors',
      'protestant-classics',
      'reading-guides'
    ]);
    expect(chips[0]?.href).toContain('bookshelf=ancient-classics');
    expect(chips[0]?.href).toContain('npub=');
  });

  it('ignores a bookshelf from another author', () => {
    const foreign = {
      ...dir(MY_BOOK_COLLECTION_D_TAG, ['ancient-classics']),
      pubkey: 'f'.repeat(64),
      id: 'c'.repeat(64)
    };
    expect(starterGuideChipsFromBookshelf(foreign)).toEqual([]);
  });

  it('omits NIP-09 deleted child folders even when the parent a-tag remains', () => {
    const shelf = dir(MY_BOOK_COLLECTION_D_TAG, ['ancient-classics', 'great-books']);
    const ancient = leaf('ancient-classics', 1, 'Ancient Classics');
    const great = leaf('great-books');
    rememberDeletedTarget(
      ancient,
      {
        id: 'd'.repeat(64),
        kind: KIND.DELETION,
        pubkey: GITCITADEL_CURATOR_HEX,
        created_at: 50,
        content: '',
        tags: [
          ['e', ancient.id],
          ['a', `${KIND.DIRECTORY}:${GITCITADEL_CURATOR_HEX}:ancient-classics`],
          ['k', String(KIND.DIRECTORY)]
        ],
        sig: 'b'.repeat(128)
      }
    );
    expect(
      starterGuideChipsFromBookshelf(shelf, [ancient, great]).map((c) => c.d)
    ).toEqual(['great-books']);
  });

  it('still accepts a mixed event bag via starterGuideChipsFromDirectories', () => {
    const events = [
      dir(MY_BOOK_COLLECTION_D_TAG, ['classic-documents', 'protestant-classics']),
      leaf('classic-documents'),
      leaf('protestant-classics')
    ];
    expect(starterGuideChipsFromDirectories(events).map((c) => c.d)).toEqual([
      'classic-documents',
      'protestant-classics'
    ]);
  });
});
