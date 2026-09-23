import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { cropListingCell, cropText, listingPageSize, listingTableRow, sortListingRows } from './listing-table';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey'>): Event {
  return {
    id: partial.id ?? 'ab'.repeat(32),
    created_at: partial.created_at ?? 1_700_000_000,
    kind: partial.kind,
    pubkey: partial.pubkey,
    tags: partial.tags ?? [],
    content: partial.content ?? '',
    sig: partial.sig ?? 'cd'.repeat(32)
  };
}

describe('cropText', () => {
  it('appends an ellipsis only when cropped', () => {
    expect(cropText('short', 20)).toBe('short');
    expect(cropText('x'.repeat(10), 8)).toBe(`${'x'.repeat(7)}…`);
    expect(cropText('  one   two  ', 20)).toBe('one two');
  });
});

describe('listingPageSize', () => {
  it('uses 250 for table and 25 otherwise', () => {
    expect(listingPageSize('table')).toBe(250);
    expect(listingPageSize('full')).toBe(25);
    expect(listingPageSize('list')).toBe(25);
  });
});

describe('listing table rows', () => {
  it('crops title and author to 100 chars', () => {
    const long = 'x'.repeat(120);
    expect(cropListingCell(long).length).toBe(100);
    expect(cropListingCell(long).endsWith('…')).toBe(true);
    const event = ev({
      kind: 30040,
      pubkey: 'aa'.repeat(32),
      tags: [
        ['title', long],
        ['author', long]
      ]
    });
    const row = listingTableRow(event);
    expect(row.title.length).toBe(100);
    expect(row.author.length).toBe(100);
    expect(row.titleFull).toBe(long);
    expect(row.authorFull).toBe(long);
  });

  it('maps title and author only', () => {
    const event = ev({
      kind: 30040,
      pubkey: 'aa'.repeat(32),
      tags: [
        ['title', 'Republic'],
        ['author', 'Plato'],
        ['l', 'en']
      ]
    });
    const row = listingTableRow(event);
    expect(row.title).toBe('Republic');
    expect(row.author).toBe('Plato');
    expect(row.href).toContain('/publication/');
  });

  it('sorts by title and author', () => {
    const a = listingTableRow(
      ev({
        id: '11'.repeat(32),
        kind: 30040,
        pubkey: 'aa'.repeat(32),
        tags: [
          ['title', 'Beta'],
          ['author', 'Zeno']
        ]
      })
    );
    const b = listingTableRow(
      ev({
        id: '22'.repeat(32),
        kind: 30040,
        pubkey: 'bb'.repeat(32),
        tags: [
          ['title', 'Alpha'],
          ['author', 'Aristotle']
        ]
      })
    );
    expect(sortListingRows([a, b], 'title', 'asc').map((r) => r.title)).toEqual(['Alpha', 'Beta']);
    expect(sortListingRows([a, b], 'author', 'asc').map((r) => r.author)).toEqual([
      'Aristotle',
      'Zeno'
    ]);
  });
});
