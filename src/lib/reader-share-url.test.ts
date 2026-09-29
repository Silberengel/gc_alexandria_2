import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { readerShareLocation, readerShareUrl } from './reader-share-url';

const PK = '3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690';

function ev(over: Partial<Event> & { tags: string[][] }): Event {
  return {
    id: (over.id ?? 'a'.repeat(64)).toLowerCase(),
    pubkey: (over.pubkey ?? PK).toLowerCase(),
    created_at: 1,
    kind: over.kind ?? 30041,
    tags: over.tags,
    content: over.content ?? '',
    sig: 'c'.repeat(128)
  };
}

describe('readerShareUrl', () => {
  const edition = ev({
    kind: 30040,
    tags: [
      ['d', 'bible-the-bible-douay-rheims-version'],
      ['title', 'Douay-Rheims Bible']
    ]
  });

  it('uses Biblestr-shaped paths for Douay verses', () => {
    const verse = ev({
      tags: [
        ['d', 'luke-9-46'],
        ['type', 'bible'],
        ['T', 'luke'],
        ['c', '9'],
        ['s', '46']
      ]
    });
    expect(readerShareUrl(edition, verse)).toMatch(/\/luke\/9\?verse=46$/);
  });

  it('uses Biblestr-shaped paths for Douay chapter indexes', () => {
    const chapter = ev({
      kind: 30040,
      tags: [
        ['d', 'bible-nt-luke-ch-9'],
        ['title', 'Luke Chapter 9'],
        ['T', 'luke'],
        ['c', '9']
      ]
    });
    expect(readerShareUrl(edition, chapter)).toMatch(/\/luke\/9$/);
  });

  it('uses publication section deep links for prefaces', () => {
    const preface = ev({
      tags: [
        ['d', 'genesis-preface'],
        ['type', 'bible'],
        ['title', 'Preface'],
        ['T', 'genesis']
      ]
    });
    const url = readerShareUrl(edition, preface);
    expect(url).toContain('/#/publication/d/bible-the-bible-douay-rheims-version/');
    expect(url).toContain('read=1');
    expect(url).toContain('section=30041%3Anpub1');
    const loc = readerShareLocation(edition, preface);
    expect(loc.startsWith('/publication/d/bible-the-bible-douay-rheims-version/')).toBe(true);
    expect(loc).toContain('read=1');
    expect(loc).toContain('section=30041%3Anpub1');
  });
});
