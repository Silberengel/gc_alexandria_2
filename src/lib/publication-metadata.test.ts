import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  buildProvenanceChips,
  editionMetadata,
  formatAuthorLabel,
  formatPublicationType,
  parsePublicationIdentifier
} from './publication-metadata';

function ev(tags: string[][], content = ''): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: 30040,
    tags,
    content,
    sig: 'c'.repeat(128)
  };
}

describe('publication metadata', () => {
  it('parses authors with roles, imprint, type, version, date, and all identifiers', () => {
    const meta = editionMetadata(
      ev([
        ['title', 'Jane Eyre'],
        ['author', 'Charlotte Brontë'],
        ['author', 'Emily Brontë', 'contributor'],
        ['published_by', 'GitCitadel Publishing'],
        ['type', 'book'],
        ['version', '1'],
        ['published_on', '1847'],
        ['l', 'en'],
        ['L', 'ugc'],
        ['t', 'classic'],
        ['s', 'https://www.gutenberg.org/ebooks/1260'],
        ['i', 'gutenberg:1260'],
        ['i', 'isbn:9780141441146'],
        ['i', 'openlibrary:OL1095380W'],
        ['a', '30041:' + '1'.repeat(64) + ':ch1'],
        ['a', '30041:' + '1'.repeat(64) + ':ch2'],
        ['summary', 'An orphan becomes a governess.']
      ])
    );

    expect(meta.titles).toEqual(['Jane Eyre']);
    expect(meta.authors.map(formatAuthorLabel)).toEqual([
      'Charlotte Brontë',
      'Emily Brontë (contributor)'
    ]);
    expect(meta.publishedBy).toBe('GitCitadel Publishing');
    expect(formatPublicationType(meta.type!)).toBe('Book');
    expect(meta.version).toBe('1');
    expect(meta.releaseDate).toBe('1847');
    expect(meta.language).toBe('en');
    expect(meta.subjects).toEqual(['classic']);
    expect(meta.summary).toBe('An orphan becomes a governess.');
    expect(meta.sectionCount).toBe(2);
    expect(meta.identifiers.map((i) => i.scheme)).toEqual(['gutenberg', 'isbn', 'openlibrary']);
    expect(meta.provenance.some((p) => /gutenberg/i.test(p.label))).toBe(true);
    expect(meta.provenance.some((p) => p.label.startsWith('ISBN'))).toBe(true);
    expect(meta.provenance.some((p) => p.label === 'Open Library')).toBe(true);
  });

  it('falls back to N tags and prefers l over L for language', () => {
    const meta = editionMetadata(ev([['N', 'jane-austen'], ['L', 'ugc'], ['l', 'de']]));
    expect(meta.authors[0]?.name).toMatch(/Jane Austen/i);
    expect(meta.language).toBe('de');
  });

  it('does not use wiki/spec body content as the header summary', () => {
    const wiki = editionMetadata({
      ...ev([['title', 'Encrypted Drive'], ['d', 'encrypted-drive']], '## Motivation\n\nPrivate drive.'),
      kind: 30817
    });
    expect(wiki.summary).toBeUndefined();
    const withTag = editionMetadata({
      ...ev(
        [['title', 'Encrypted Drive'], ['d', 'encrypted-drive'], ['summary', 'A private drive.']],
        '## Motivation\n\nPrivate drive.'
      ),
      kind: 30817
    });
    expect(withTag.summary).toBe('A private drive.');
  });

  it('builds isbn chips as searchable/copyable without external href', () => {
    const id = parsePublicationIdentifier('isbn:0879801220')!;
    expect(id.label).toBe('ISBN 0879801220');
    expect(id.url).toBeUndefined();
    const chips = buildProvenanceChips(undefined, [id]);
    expect(chips[0]?.copyText).toBe('0879801220');
    expect(chips[0]?.search).toBe('isbn:0879801220');
    expect(chips[0]?.href).toBeUndefined();
  });
});
