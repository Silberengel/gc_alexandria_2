import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { GITCITADEL_CURATOR_HEX } from './hex';
import {
  GC_STARTER_GENRE_D_TAGS,
  GC_STARTER_GUIDES_D_TAG,
  childGuideFolderDTags,
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

function leaf(d: string, created_at = 1): Event {
  return dir(d, [], created_at);
}

describe('starter guides', () => {
  it('maps display titles for genres', () => {
    expect(starterGuideTitle('ancient-classics')).toBe('Ancient classics');
    expect(starterGuideTitle('classic-novels')).toBe('Classic novels');
    expect(starterGuideTitle('catholic-classics')).toBe('Catholic classics');
    expect(starterGuideTitle('black-authors')).toBe('Black authors');
  });

  it('builds curator coordinates', () => {
    expect(starterGuideCoordinate('great-books')).toBe(
      `${KIND.DIRECTORY}:${GITCITADEL_CURATOR_HEX}:great-books`
    );
  });

  it('lists nested folder d-tags from a parent', () => {
    const root = dir(GC_STARTER_GUIDES_D_TAG, ['ancient-classics', 'great-books']);
    expect(childGuideFolderDTags(root)).toEqual(['ancient-classics', 'great-books']);
  });

  it('orders genre chips when the full tree is present', () => {
    const events = [
      dir(GC_STARTER_GUIDES_D_TAG, [...GC_STARTER_GENRE_D_TAGS]),
      ...GC_STARTER_GENRE_D_TAGS.map((d) => leaf(d))
    ];
    const chips = starterGuideChipsFromDirectories(events);
    expect(chips.map((c) => c.d)).toEqual([...GC_STARTER_GENRE_D_TAGS]);
    expect(chips[0]?.href).toContain('bookshelf=ancient-classics');
    expect(chips[0]?.href).toContain('npub=');
    expect(chips.every((c) => c.title.length > 0)).toBe(true);
  });

  it('returns empty chips when no curator directories are loaded', () => {
    expect(starterGuideChipsFromDirectories([])).toEqual([]);
  });

  it('ignores directories from other authors', () => {
    const foreign: Event = {
      ...leaf('ancient-classics'),
      pubkey: 'f'.repeat(64),
      id: 'c'.repeat(64)
    };
    expect(starterGuideChipsFromDirectories([foreign])).toEqual([]);
  });
});
