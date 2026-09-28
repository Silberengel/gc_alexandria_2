import { describe, expect, it } from 'vitest';
import { normalizeSearchKey } from './search';
import { searchSnapshotFresh, searchSnapshotMatchesViewer, type SearchSnapshot } from './nostr/cache';

describe('normalizeSearchKey', () => {
  it('folds case and whitespace so repeats hit the same snapshot', () => {
    expect(normalizeSearchKey('  Mansfield   Park ')).toBe('mansfield park');
    expect(normalizeSearchKey('MANSFIELD PARK')).toBe(normalizeSearchKey('mansfield park'));
  });
});

describe('search snapshot viewer binding', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const snap = (viewer: string | null | undefined, ageMs = 0): SearchSnapshot => ({
    savedAt: Date.now() - ageMs,
    events: [],
    viewerPubkey: viewer
  });

  it('rejects another identity and legacy anonymous snapshots for signed-in viewers', () => {
    expect(searchSnapshotMatchesViewer(snap(a), a)).toBe(true);
    expect(searchSnapshotMatchesViewer(snap(a), b)).toBe(false);
    expect(searchSnapshotMatchesViewer(snap(null), a)).toBe(false);
    expect(searchSnapshotMatchesViewer(snap(undefined), null)).toBe(true);
    expect(searchSnapshotFresh(snap(a), 60_000, b)).toBe(false);
    expect(searchSnapshotFresh(snap(a), 60_000, a)).toBe(true);
    // Explicit undefined must not skip the default TTL (callers pass viewer as 3rd arg).
    expect(searchSnapshotFresh(snap(a, 0), undefined, a)).toBe(true);
    expect(searchSnapshotFresh(snap(a, 21 * 60 * 1000), undefined, a)).toBe(false);
  });
});
describe('identifierHints', () => {
  it('expands Gutenberg URLs, colon ids, and short numbers', async () => {
    const { identifierHints } = await import('./search');
    expect(identifierHints('https://www.gutenberg.org/ebooks/141')).toContain('gutenberg:141');
    expect(identifierHints('https://www.gutenberg.org/ebooks/141')).toContain(
      'https://www.gutenberg.org/ebooks/141'
    );
    expect(identifierHints('gutenberg:141')).toContain('141');
    expect(identifierHints('141')).toContain('gutenberg:141');
  });
});

describe('matchesPageFilter', () => {
  it('matches tag text without a new lookup', async () => {
    const { matchesPageFilter } = await import('./page-filter');
    const event = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      created_at: 1,
      kind: 30040,
      tags: [['title', 'Mansfield Park']],
      content: '',
      sig: 'c'.repeat(128)
    };
    expect(matchesPageFilter(event, 'mansfield')).toBe(true);
    expect(matchesPageFilter(event, 'pride')).toBe(false);
  });
});

describe('preferTopLevelPublications', () => {
  it('hides nested 30040s when a top-level match exists', async () => {
    const { preferTopLevelPublications } = await import('./search');
    const pk = '1'.repeat(64);
    const nestedAddr = `30040:${pk}:ch`;
    const nested = {
      id: 'a'.repeat(64),
      pubkey: pk,
      created_at: 2,
      kind: 30040,
      tags: [['d', 'ch']],
      content: '',
      sig: 'c'.repeat(128)
    };
    const top = {
      id: 'b'.repeat(64),
      pubkey: pk,
      created_at: 1,
      kind: 30040,
      tags: [['d', 'book'], ['a', nestedAddr]],
      content: '',
      sig: 'c'.repeat(128)
    };
    const wiki = { ...nested, id: 'd'.repeat(64), kind: 30818, tags: [['d', 'w']] };
    const out = preferTopLevelPublications([nested, top, wiki]);
    expect(out.map((e) => e.id)).toEqual([top.id, wiki.id]);
  });
});
