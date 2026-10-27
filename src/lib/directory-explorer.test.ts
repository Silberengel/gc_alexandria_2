import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { MY_BOOK_COLLECTION_D_TAG, ROOT_DIRECTORY_D_TAG } from './bookshelf';
import {
  compareDirectoryListing,
  directoryChildCounts,
  directoryChildHref,
  directoryCoordinateHref,
  directoryEntryIconClass,
  directoryEntryKindLine,
  directoryExplorerEntries,
  directoryExplorerTitle,
  formatDirectoryGmt,
  formatDirectoryGmtParts
} from './directory-explorer';

function ev(over: Partial<Event> & { tags?: string[][] }): Event {
  return {
    id: over.id ?? '1'.repeat(64),
    pubkey: over.pubkey ?? '2'.repeat(64),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? KIND.DIRECTORY,
    tags: over.tags ?? [['d', 'folder']],
    content: over.content ?? '',
    sig: over.sig ?? '3'.repeat(128)
  };
}

const pk = 'a'.repeat(64);

describe('directoryExplorerEntries', () => {
  it('lists a/e children in tag order and marks 30045 as folders', () => {
    const dir = ev({
      tags: [
        ['d', 'planning'],
        ['title', 'Plan'],
        [
          'a',
          `30045:${pk}:january`,
          'wss://relay.example.com',
          'January'
        ],
        [
          'a',
          `30040:${pk}:monte-cristo`,
          'wss://relay.example.com',
          'b'.repeat(64)
        ],
        ['e', 'c'.repeat(64), 'wss://relay.example.com', pk, 'Overview'],
        ['a', `0:${pk}:`, 'wss://relay.example.com', 'My vacation profile'],
        ['a', `1063:${pk}:photo`, '', 'Holiday photo'],
        ['a', `${KIND.WEB_BOOKMARK}:${pk}:site`, '', 'Site']
      ]
    });
    const entries = directoryExplorerEntries(dir);
    expect(entries.map((e) => [e.role, e.label, e.kind])).toEqual([
      ['folder', 'January', KIND.DIRECTORY],
      ['file', 'monte cristo', KIND.PUBLICATION],
      ['file', 'Overview', null],
      ['file', 'My vacation profile', KIND.METADATA],
      ['file', 'Holiday photo', 1063],
      ['file', 'Site', KIND.WEB_BOOKMARK]
    ]);
    expect(directoryEntryIconClass(entries[0]!)).toBe('is-folder');
    expect(directoryEntryIconClass(entries[1]!)).toBe('is-file');
    expect(directoryEntryIconClass(entries[4]!)).toBe('is-external');
    expect(directoryEntryIconClass(entries[5]!)).toBe('is-link');
    expect(directoryEntryKindLine(entries[0]!)).toBe('Folder');
    expect(directoryEntryKindLine(entries[4]!)).toBe('File');
    expect(directoryEntryKindLine(entries[5]!)).toBe('Bookmark');
  });

  it('skips self-referential malformed a tags without a valid coordinate', () => {
    expect(
      directoryExplorerEntries({
        tags: [['d', 'x'], ['a', 'not-a-coord'], ['client', 'Alexandria']]
      })
    ).toEqual([]);
  });
});

describe('directoryExplorerTitle', () => {
  it('prefers title, then renames known home folders', () => {
    expect(
      directoryExplorerTitle(
        ev({ tags: [['d', 'planning'], ['title', "Alice's Planning"]] })
      )
    ).toBe("Alice's Planning");
    expect(
      directoryExplorerTitle(ev({ tags: [['d', MY_BOOK_COLLECTION_D_TAG]] }))
    ).toBe('My bookshelf');
    expect(directoryExplorerTitle(ev({ tags: [['d', ROOT_DIRECTORY_D_TAG]] }))).toBe(
      'root'
    );
    expect(directoryExplorerTitle(ev({ tags: [['d', 'summer-reads']] }))).toBe(
      'summer-reads'
    );
  });
});

describe('directoryChildCounts + formatDirectoryGmt', () => {
  it('counts folders vs events', () => {
    const pk = 'a'.repeat(64);
    expect(
      directoryChildCounts({
        tags: [
          ['d', 'root'],
          ['a', `30045:${pk}:nested`],
          ['a', `30040:${pk}:book`],
          ['e', 'c'.repeat(64)]
        ]
      })
    ).toEqual({ folders: 1, events: 2 });
  });

  it('formats Mo dd.mm.yyyy hh:mm:ss GMT', () => {
    // 2024-01-15 14:05:09 UTC = Monday
    expect(formatDirectoryGmtParts(1705327509)).toEqual({
      date: 'Mo 15.01.2024',
      time: '14:05:09 GMT'
    });
    expect(formatDirectoryGmt(1705327509)).toBe('Mo 15.01.2024 14:05:09 GMT');
  });
});

describe('compareDirectoryListing', () => {
  it('orders by pubkey, then root before bookshelf before others', () => {
    const pkA = 'a'.repeat(64);
    const pkB = 'b'.repeat(64);
    const aOther = ev({
      id: '1'.repeat(64),
      pubkey: pkA,
      created_at: 100,
      tags: [['d', 'nested']]
    });
    const aRoot = ev({
      id: '2'.repeat(64),
      pubkey: pkA,
      created_at: 50,
      tags: [['d', ROOT_DIRECTORY_D_TAG]]
    });
    const aShelf = ev({
      id: '3'.repeat(64),
      pubkey: pkA,
      created_at: 200,
      tags: [['d', MY_BOOK_COLLECTION_D_TAG]]
    });
    const bRoot = ev({
      id: '4'.repeat(64),
      pubkey: pkB,
      created_at: 10,
      tags: [['d', ROOT_DIRECTORY_D_TAG]]
    });
    const sorted = [bRoot, aOther, aShelf, aRoot].sort(compareDirectoryListing);
    expect(sorted.map((e) => e.id)).toEqual([
      aRoot.id,
      aShelf.id,
      aOther.id,
      bRoot.id
    ]);
  });
});

describe('directory href helpers', () => {
  it('routes publications and wiki coordinates', () => {
    const pub = ev({
      kind: KIND.PUBLICATION,
      pubkey: pk,
      tags: [['d', 'monte-cristo'], ['title', 'Monte Cristo']]
    });
    expect(directoryChildHref(pub)).toContain('/publication/');
    expect(directoryChildHref(ev({ kind: KIND.DIRECTORY, tags: [['d', 'x']] }))).toBeNull();
    expect(
      directoryCoordinateHref(`30040:${pk}:monte-cristo`)
    ).toContain('/publication/');
    expect(directoryCoordinateHref(`30045:${pk}:nested`)).toBeNull();
  });
});
