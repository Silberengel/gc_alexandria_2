import { describe, expect, it } from 'vitest';
import { preferLive, subjectsFromPublications, orderShelfCovers, titleForAddress, publisherForAddress, displayRefTitle, hrefForRef, topLevelPublicationAddress } from './landing';
import type { Event } from 'nostr-tools';

function ev(tags: string[][]): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: 30040,
    tags,
    content: '',
    sig: 'c'.repeat(128)
  };
}

describe('landing cache fallback', () => {
  it('keeps the snapshot when live results are empty', () => {
    const cached = [ev([['title', 'Cached']])];
    expect(preferLive([], cached)).toEqual(cached);
    expect(preferLive([ev([['title', 'Live']])], cached)[0]?.tags[0]?.[1]).toBe('Live');
  });

  it('ranks subjects from cached publications', () => {
    expect(
      subjectsFromPublications([
        ev([['t', 'fiction'], ['t', 'romance']]),
        ev([['t', 'fiction']])
      ])
    ).toEqual(['fiction', 'romance']);
  });
});

describe('orderShelfCovers', () => {
  function pub(created_at: number, nibble: string): Event {
    return {
      id: nibble.repeat(64).slice(0, 64),
      pubkey: 'b'.repeat(64),
      created_at,
      kind: 30040,
      tags: [['d', nibble]],
      content: '',
      sig: 'c'.repeat(128)
    };
  }

  it('shows every item newest-first when there are fewer than 10', () => {
    const items = [pub(1, '1'), pub(3, '3'), pub(2, '2')];
    expect(orderShelfCovers(items, 99).map((e) => e.created_at)).toEqual([3, 2, 1]);
  });

  it('pins the 3 newest and shuffles the rest from the unix seed', () => {
    const items = Array.from({ length: 10 }, (_, i) => pub(i + 1, i.toString(16)));
    const a = orderShelfCovers(items, 1_700_000_000);
    const b = orderShelfCovers(items, 1_700_000_001);
    const again = orderShelfCovers(items, 1_700_000_000);
    expect(a.slice(0, 3).map((e) => e.created_at)).toEqual([10, 9, 8]);
    expect(b.slice(0, 3).map((e) => e.created_at)).toEqual([10, 9, 8]);
    expect(a.map((e) => e.id)).toEqual(again.map((e) => e.id));
    expect(a.slice(3).map((e) => e.id)).not.toEqual(b.slice(3).map((e) => e.id));
    expect(new Set(a.map((e) => e.id)).size).toBe(10);
  });
});

describe('referenced work titles', () => {
  it('uses the resolved event title, else a humanized d-tag', () => {
    const pubkey = '1'.repeat(64);
    const coord = `30040:${pubkey}:jane-eyre`;
    const work = ev([['d', 'jane-eyre'], ['title', 'Jane Eyre']]);
    work.pubkey = pubkey;
    work.kind = 30040;
    expect(titleForAddress(coord, [work])).toBe('Jane Eyre');
    expect(titleForAddress(coord, [])).toBe('Jane Eyre');
    expect(publisherForAddress(coord, [work])).toBe(pubkey);
  });

  it('formats a section reference as Publication Title: Section Title', () => {
    const pubkey = '1'.repeat(64);
    const pubAddr = `30040:${pubkey}:jane-eyre`;
    const secAddr = `30041:${pubkey}:ch-1`;
    const publication = ev([
      ['d', 'jane-eyre'],
      ['title', 'Jane Eyre'],
      ['a', secAddr]
    ]);
    publication.pubkey = pubkey;
    publication.kind = 30040;
    const section = ev([['d', 'ch-1'], ['title', 'Chapter 1']]);
    section.id = 'd'.repeat(64);
    section.pubkey = pubkey;
    section.kind = 30041;
    const comment = {
      ...ev([]),
      kind: 1111,
      tags: [
        ['A', pubAddr],
        ['a', secAddr]
      ]
    };
    const referenced = [publication, section];
    expect(displayRefTitle(comment, referenced)).toBe('Jane Eyre: Chapter 1');
    expect(topLevelPublicationAddress(secAddr, referenced)).toBe(pubAddr);
    expect(hrefForRef(comment, referenced)).toContain('/publication/d/jane-eyre/');
  });
});
