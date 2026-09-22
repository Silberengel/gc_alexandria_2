import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { enrichToc, humanizeHeading, parseToc, sectionHeading } from './publication-load';

function ev(over: Partial<Event> & { tags: string[][] }): Event {
  return {
    id: (over.id ?? 'a'.repeat(64)).toLowerCase(),
    pubkey: (over.pubkey ?? 'b'.repeat(64)).toLowerCase(),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? 30041,
    tags: over.tags,
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('sectionHeading', () => {
  it('uses title, else human T, else human d', () => {
    expect(sectionHeading(ev({ tags: [['title', 'Preface'], ['T', 'pref'], ['d', 'preface']] }))).toBe(
      'Preface'
    );
    expect(sectionHeading(ev({ tags: [['T', 'preface-to-the-fifth-edition']] }))).toBe(
      'Preface To The Fifth Edition'
    );
    expect(sectionHeading(ev({ tags: [['d', 'vii-the-charismatic-revival']] }))).toBe(
      'Vii The Charismatic Revival'
    );
  });
});

describe('parseToc', () => {
  it('humanizes a-tag d-tags when Mercury has no tree', () => {
    const pub = ev({
      kind: 30040,
      tags: [['d', 'book'], ['a', `30041:${'b'.repeat(64)}:preface-to-the-fifth-edition`]]
    });
    const toc = parseToc(null, pub);
    expect(toc[0]?.title).toBe('Preface To The Fifth Edition');
    expect(toc[0]?.address).toContain('preface-to-the-fifth-edition');
  });

  it('parses Mercury nested 30040 headings with depth from a-tag links', () => {
    const pk = 'b'.repeat(64);
    const partAddr = `30040:${pk}:part-i`;
    const chapAddr = `30040:${pk}:chapter-1`;
    const part = ev({
      id: '1'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'part-i'], ['title', 'Part I'], ['a', chapAddr], ['a', `30041:${pk}:sec-a`]]
    });
    const chap = ev({
      id: '2'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'chapter-1'], ['title', 'Chapter 1'], ['a', `30041:${pk}:sec-b`]]
    });
    const toc = parseToc(
      [
        { pos: 0, kind: 30040, d: 'part-i', id: part.id, title: 'Part I', event: part },
        { pos: 1, kind: 30040, d: 'chapter-1', id: chap.id, title: 'Chapter 1', event: chap }
      ],
      ev({ kind: 30040, tags: [['d', 'book'], ['a', partAddr]] })
    );
    expect(toc).toHaveLength(2);
    expect(toc[0]).toMatchObject({ title: 'Part I', address: partAddr, index: true, depth: 0 });
    expect(toc[1]).toMatchObject({ title: 'Chapter 1', address: chapAddr, index: true, depth: 1 });
  });

  it('marks nested 30040 a-tags as index entries in the fallback ToC', () => {
    const pk = 'b'.repeat(64);
    const toc = parseToc(null, ev({
      kind: 30040,
      tags: [
        ['d', 'book'],
        ['a', `30040:${pk}:volume-1`],
        ['a', `30041:${pk}:preface`]
      ]
    }));
    expect(toc[0]?.index).toBe(true);
    expect(toc[1]?.index).toBeFalsy();
  });
});

describe('enrichToc', () => {
  it('replaces slug ToC titles with section title-tags', () => {
    const pk = 'b'.repeat(64);
    const section = ev({
      id: 'd'.repeat(64),
      tags: [
        ['d', 'preface-to-the-fifth-edition'],
        ['title', 'Preface to the Fifth Edition']
      ]
    });
    const toc = parseToc(null, ev({
      kind: 30040,
      tags: [['a', `30041:${pk}:preface-to-the-fifth-edition`]]
    }));
    expect(enrichToc(toc, [section])[0]?.title).toBe('Preface to the Fifth Edition');
    expect(enrichToc(toc, [section])[0]?.id).toBe(section.id);
  });

  it('does not overwrite nested 30040 titles with section bodies by list index', () => {
    const pk = 'b'.repeat(64);
    const section = ev({
      id: 'd'.repeat(64),
      tags: [['d', 'preface'], ['title', 'Preface body']]
    });
    const toc = parseToc(
      [{ pos: 0, kind: 30040, d: 'volume-1', title: 'Volume I', pubkey: pk }],
      ev({ kind: 30040, tags: [['d', 'book']] })
    );
    expect(enrichToc(toc, [section])[0]?.title).toBe('Volume I');
    expect(enrichToc(toc, [section])[0]?.index).toBe(true);
  });

  it('builds a ToC from sections when none exists', () => {
    const section = ev({ tags: [['title', 'Chapter 1'], ['d', 'ch-1']] });
    expect(enrichToc([], [section])[0]?.title).toBe('Chapter 1');
  });
});

describe('humanizeHeading', () => {
  it('keeps numbered placeholders', () => {
    expect(humanizeHeading('Section 3')).toBe('Section 3');
    expect(humanizeHeading('preface')).toBe('Preface');
  });
});
