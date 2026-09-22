import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  enrichToc,
  ensureIndexHeadings,
  expandTocFromSections,
  copyPointerForEvent,
  humanizeHeading,
  isPlaceholderIndex,
  mergePublicationSections,
  parseToc,
  placeholderIndexEvent,
  sectionHeading,
  buildTocTree
} from './publication-load';

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

describe('copyPointerForEvent', () => {
  it('copies naddr for addressable kinds and nevent otherwise', () => {
    const pk = 'b'.repeat(64);
    const section = ev({
      kind: 30041,
      pubkey: pk,
      tags: [['d', 'ch-1'], ['title', 'Chapter 1']]
    });
    const note = ev({
      id: 'd'.repeat(64),
      kind: 1,
      pubkey: pk,
      tags: []
    });
    expect(copyPointerForEvent(section)).toMatchObject({ label: 'Copy naddr' });
    expect(copyPointerForEvent(section).text.startsWith('naddr1')).toBe(true);
    expect(copyPointerForEvent(note)).toMatchObject({ label: 'Copy nevent' });
    expect(copyPointerForEvent(note).text.startsWith('nevent1')).toBe(true);
  });
});

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
      tags: [['d', 'book'], ['title', 'My Book'], ['a', `30041:${'b'.repeat(64)}:preface-to-the-fifth-edition`]]
    });
    const toc = parseToc(null, pub);
    expect(toc[0]).toMatchObject({ title: 'My Book', root: true, index: true });
    expect(toc[1]?.title).toBe('Preface To The Fifth Edition');
    expect(toc[1]?.address).toContain('preface-to-the-fifth-edition');
  });

  it('parses Mercury nested 30040 headings with depth from a-tag links', () => {
    const pk = 'b'.repeat(64);
    const partAddr = `30040:${pk}:part-i`;
    const chapAddr = `30040:${pk}:chapter-1`;
    const secAddr = `30041:${pk}:sec-a`;
    const part = ev({
      id: '1'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'part-i'], ['title', 'Part I'], ['a', chapAddr], ['a', secAddr]]
    });
    const chap = ev({
      id: '2'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'chapter-1'], ['title', 'Chapter 1'], ['a', `30041:${pk}:sec-b`]]
    });
    const book = ev({
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'book'], ['title', 'The Book'], ['a', partAddr]]
    });
    const toc = parseToc(
      [
        { pos: 0, kind: 30040, d: 'part-i', id: part.id, title: 'Part I', event: part },
        { pos: 1, kind: 30040, d: 'chapter-1', id: chap.id, title: 'Chapter 1', event: chap }
      ],
      book
    );
    expect(toc.find((e) => e.root)).toMatchObject({ title: 'The Book', depth: 0 });
    expect(toc.find((e) => e.address === partAddr)).toMatchObject({
      title: 'Part I',
      index: true,
      depth: 1
    });
    expect(toc.find((e) => e.address === chapAddr)).toMatchObject({
      title: 'Chapter 1',
      index: true,
      depth: 2
    });
    expect(toc.find((e) => e.address === secAddr)).toMatchObject({
      index: false,
      depth: 2
    });
    const tree = buildTocTree(toc);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.entry.title).toBe('The Book');
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.entry.title).toBe('Part I');
    // Sections before nested 30040s under the same parent.
    expect(tree[0]?.children[0]?.children.map((c) => c.entry.address)).toEqual([secAddr, chapAddr]);
  });

  it('keeps every nested 30040 in the ToC tree when expanding leaf sections', () => {
    const pk = 'b'.repeat(64);
    const partAddr = `30040:${pk}:part-i`;
    const chapAddr = `30040:${pk}:chapter-1`;
    const part = ev({
      id: '1'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [
        ['d', 'part-i'],
        ['title', 'Part I'],
        ['a', `30041:${pk}:sec-a`],
        ['a', chapAddr],
        ['a', `30041:${pk}:sec-c`]
      ]
    });
    const chap = ev({
      id: '2'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'chapter-1'], ['title', 'Chapter 1'], ['a', `30041:${pk}:sec-b`]]
    });
    const book = ev({
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'book'], ['title', 'The Book'], ['a', partAddr]]
    });
    const toc = parseToc(
      [
        { pos: 0, kind: 30040, d: 'part-i', id: part.id, title: 'Part I', event: part },
        { pos: 1, kind: 30040, d: 'chapter-1', id: chap.id, title: 'Chapter 1', event: chap }
      ],
      book
    );
    const indexes = toc.filter((e) => e.index);
    expect(indexes.map((e) => e.title)).toEqual(['The Book', 'Part I', 'Chapter 1']);
    const tree = buildTocTree(toc);
    const flatTitles: string[] = [];
    const walk = (nodes: ReturnType<typeof buildTocTree>) => {
      for (const n of nodes) {
        if (n.entry.index) flatTitles.push(n.entry.title);
        walk(n.children);
      }
    };
    walk(tree);
    expect(flatTitles).toEqual(['The Book', 'Part I', 'Chapter 1']);
  });

  it('injects nested 30040 events into the reading list when the stream omitted them', () => {
    const pk = 'b'.repeat(64);
    const part = ev({
      id: '1'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'part-i'], ['title', 'Part I'], ['a', `30041:${pk}:sec-a`]]
    });
    const leaf = ev({
      id: 'd'.repeat(64),
      kind: 30041,
      pubkey: pk,
      tags: [['d', 'sec-a'], ['title', 'Section A']]
    });
    const book = ev({
      id: '9'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'book'], ['title', 'The Book'], ['a', `30040:${pk}:part-i`]]
    });
    const toc = parseToc(
      [{ pos: 0, kind: 30040, d: 'part-i', id: part.id, title: 'Part I', event: part }],
      book
    );
    const merged = ensureIndexHeadings([leaf], toc);
    expect(merged.some((e) => e.id === book.id)).toBe(true);
    expect(merged.some((e) => e.id === part.id)).toBe(true);
    expect(merged.some((e) => e.id === leaf.id)).toBe(true);
  });

  it('lists edition-level sections before Mercury nested indexes', () => {
    const pk = 'b'.repeat(64);
    const headline = `30023:${pk}:curated-headline`;
    const politics = `30040:${pk}:politics`;
    const pub = ev({
      kind: 30040,
      pubkey: pk,
      tags: [
        ['d', 'magazine'],
        ['title', 'Newsroom'],
        ['a', politics],
        ['a', headline],
        ['a', `30040:${pk}:economy`]
      ]
    });
    const pol = ev({
      id: '1'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'politics'], ['title', 'Politics'], ['a', `30023:${pk}:op-ed`]]
    });
    const toc = parseToc(
      [{ pos: 0, kind: 30040, d: 'politics', id: pol.id, title: 'Politics', event: pol }],
      pub
    );
    expect(toc[0]).toMatchObject({ title: 'Newsroom', root: true });
    expect(toc.find((e) => e.address === headline)?.index).toBeFalsy();
    expect(toc.find((e) => e.address === politics)?.index).toBe(true);
    const tree = buildTocTree(toc);
    expect(tree[0]?.entry.title).toBe('Newsroom');
    expect(tree[0]?.children[0]?.entry.address).toBe(headline);
    expect(tree[0]?.children.some((n) => n.entry.address === politics)).toBe(true);
  });

  it('synthesizes a Politics heading when Mercury lists a ghost index row', () => {
    const pk = 'd'.repeat(64);
    const d = 'newsroom-magazine-on-imwald-by-laeserin-category-politics';
    const toc = parseToc(
      [{ pos: 0, kind: 30040, d, title: null }],
      ev({
        kind: 30040,
        pubkey: pk,
        tags: [['d', 'magazine'], ['title', 'Newsroom'], ['a', `30040:${pk}:${d}`]]
      })
    );
    const politics = toc.find((e) => e.address?.endsWith(`:${d}`));
    expect(politics?.title).toBe('Politics');
    expect(politics?.index).toBe(true);
    const placeholder = placeholderIndexEvent(politics!);
    expect(placeholder?.tags).toContainEqual(['title', 'Politics']);
    expect(isPlaceholderIndex(placeholder!)).toBe(true);
  });

  it('replaces a placeholder Politics index when the real relay event arrives', () => {
    const pk = 'd'.repeat(64);
    const d = 'newsroom-magazine-on-imwald-by-laeserin-category-politics';
    const addr = `30040:${pk}:${d}`;
    const toc = parseToc(
      [{ pos: 0, kind: 30040, d, title: null }],
      ev({
        id: '9'.repeat(64),
        kind: 30040,
        pubkey: pk,
        tags: [['d', 'magazine'], ['title', 'Newsroom'], ['a', addr]]
      })
    );
    const politics = toc.find((e) => e.address === addr)!;
    const placeholder = placeholderIndexEvent(politics)!;
    const real = ev({
      id: '24d8a13f9e9fe5f8ed0f9e67fd3943f9007009097b5147796fc16e79ad2b76f3',
      kind: 30040,
      pubkey: pk,
      created_at: 1776957234,
      tags: [
        ['d', d],
        ['title', 'Politics'],
        ['a', `30023:${pk}:living-like-god-in-france`]
      ],
      sig: 'b'.repeat(128)
    });
    const merged = mergePublicationSections([placeholder], [real]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(real.id);
    expect(isPlaceholderIndex(merged[0]!)).toBe(false);
    const expanded = expandTocFromSections(toc, merged);
    expect(expanded.some((e) => e.address?.includes('living-like-god-in-france'))).toBe(true);
  });

  it('lists leaf sections before nested 30040s in the fallback ToC', () => {
    const pk = 'b'.repeat(64);
    const toc = parseToc(null, ev({
      kind: 30040,
      tags: [
        ['d', 'book'],
        ['title', 'My Book'],
        ['a', `30040:${pk}:volume-1`],
        ['a', `30041:${pk}:preface`]
      ]
    }));
    expect(toc[0]?.root).toBe(true);
    expect(toc[1]?.index).toBeFalsy();
    expect(toc[1]?.address).toContain('preface');
    expect(toc[2]?.index).toBe(true);
    expect(toc[2]?.address).toContain('volume-1');
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
      tags: [['d', 'book'], ['title', 'My Book'], ['a', `30041:${pk}:preface-to-the-fifth-edition`]]
    }));
    const enriched = enrichToc(toc, [section]);
    const preface = enriched.find((e) => e.address?.includes('preface-to-the-fifth-edition'));
    expect(preface?.title).toBe('Preface to the Fifth Edition');
    expect(preface?.id).toBe(section.id);
    expect(enriched[0]?.root).toBe(true);
  });

  it('does not overwrite nested 30040 titles with section bodies by list index', () => {
    const pk = 'b'.repeat(64);
    const section = ev({
      id: 'd'.repeat(64),
      tags: [['d', 'preface'], ['title', 'Preface body']]
    });
    const toc = parseToc(
      [{ pos: 0, kind: 30040, d: 'volume-1', title: 'Volume I', pubkey: pk }],
      ev({ kind: 30040, pubkey: pk, tags: [['d', 'book'], ['title', 'The Book']] })
    );
    const vol = enrichToc(toc, [section]).find((e) => e.title === 'Volume I' || e.address?.includes('volume-1'));
    expect(vol?.title).toBe('Volume I');
    expect(vol?.index).toBe(true);
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
