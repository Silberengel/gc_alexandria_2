import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  enrichToc,
  ensureIndexHeadings,
  ensureMissingSectionPlaceholders,
  expandTocFromSections,
  copyPointerForEvent,
  humanizeHeading,
  isPlaceholderIndex,
  isPlaceholderSection,
  mergePublicationSections,
  orderPublicationSections,
  parseToc,
  placeholderIndexEvent,
  placeholderSectionEvent,
  sectionHeading,
  buildTocTree,
  activeTocEntry,
  tocPathKeys,
  tocEntryKey
} from './publication-load';
import { firstTag } from './nostr/verify';

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

  it('fills a missing leaf between loaded neighbors with a placeholder section', () => {
    const pk = 'e'.repeat(64);
    const root = ev({
      id: '1'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [
        ['d', 'book'],
        ['title', 'Book'],
        ['a', `30041:${pk}:v12`],
        ['a', `30041:${pk}:v13`],
        ['a', `30041:${pk}:v14`]
      ]
    });
    const v12 = ev({
      id: '2'.repeat(64),
      kind: 30041,
      pubkey: pk,
      tags: [['d', 'v12'], ['title', 'Verse 12']]
    });
    const v14 = ev({
      id: '4'.repeat(64),
      kind: 30041,
      pubkey: pk,
      tags: [['d', 'v14'], ['title', 'Verse 14']]
    });
    const toc = parseToc(null, root);
    const filled = ensureMissingSectionPlaceholders([root, v12, v14], toc);
    const ordered = orderPublicationSections(filled, { root, toc });
    const gap = ordered.find((e) => firstTag(e, 'd') === 'v13');
    expect(gap).toBeTruthy();
    expect(isPlaceholderSection(gap!)).toBe(true);
    expect(placeholderSectionEvent(toc.find((e) => e.address?.endsWith(':v13'))!)?.kind).toBe(30041);
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

describe('orderPublicationSections', () => {
  it('does not explode the ToC with every bible verse under nested chapters', () => {
    const pk = 'b'.repeat(64);
    const ot = ev({
      id: '1'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [
        ['d', 'ot'],
        ['title', 'Old Testament'],
        ['a', `30040:${pk}:genesis`]
      ]
    });
    const genesis = ev({
      id: '2'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [
        ['d', 'genesis'],
        ['title', 'Genesis'],
        ['a', `30040:${pk}:gen-ch-1`]
      ]
    });
    const ch1 = ev({
      id: '3'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [
        ['d', 'gen-ch-1'],
        ['title', 'Chapter 1'],
        ...Array.from({ length: 50 }, (_, i) => [
          'a',
          `30041:${pk}:gen-1-${i + 1}`
        ])
      ]
    });
    const root = ev({
      id: '4'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [
        ['d', 'bible'],
        ['title', 'Bible'],
        ['a', `30040:${pk}:ot`]
      ]
    });
    const toc = parseToc(
      [{ pos: 0, kind: 30040, d: 'ot', title: 'Old Testament', pubkey: pk }],
      root
    );
    const expanded = expandTocFromSections(toc, [root, ot, genesis, ch1]);
    // Nested indexes appear; chapter verses must not flood the ToC.
    expect(expanded.some((e) => e.address?.includes('genesis'))).toBe(true);
    expect(expanded.some((e) => e.address?.includes('gen-ch-1'))).toBe(true);
    expect(expanded.filter((e) => e.address?.includes('gen-1-')).length).toBe(0);
    expect(expanded.length).toBeLessThan(20);
  });

  it('orders nested indexes and verses by a-tag walk, not stream arrival', () => {
    const pk = 'b'.repeat(64);
    const v2 = ev({
      id: '2'.repeat(64),
      kind: 30041,
      pubkey: pk,
      tags: [
        ['d', 'ch1-v2'],
        ['type', 'bible'],
        ['title', '1:2'],
        ['c', '1'],
        ['s', '2']
      ],
      content: 'two'
    });
    const v1 = ev({
      id: '1'.repeat(64),
      kind: 30041,
      pubkey: pk,
      tags: [
        ['d', 'ch1-v1'],
        ['type', 'bible'],
        ['title', '1:1'],
        ['c', '1'],
        ['s', '1']
      ],
      content: 'one'
    });
    const ch1 = ev({
      id: '3'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [
        ['d', 'ch-1'],
        ['title', 'Chapter 1'],
        ['a', `30041:${pk}:ch1-v1`],
        ['a', `30041:${pk}:ch1-v2`]
      ]
    });
    const book = ev({
      id: '4'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [
        ['d', 'matthew'],
        ['title', 'Matthew'],
        ['a', `30040:${pk}:ch-1`]
      ]
    });
    const root = ev({
      id: '5'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [
        ['d', 'bible'],
        ['title', 'Bible'],
        ['a', `30040:${pk}:matthew`]
      ]
    });
    // Stream arrival: verses first, jumbled, root last.
    const streamed = [v2, v1, ch1, book, root];
    const ordered = orderPublicationSections(streamed, { root });
    expect(ordered.map((e) => e.id)).toEqual([root.id, book.id, ch1.id, v1.id, v2.id]);
  });

  it('sorts orphan bible verses by chapter then verse', () => {
    const pk = 'b'.repeat(64);
    const a = ev({
      id: 'a'.repeat(64),
      pubkey: pk,
      tags: [['d', 'a'], ['type', 'bible'], ['c', '2'], ['s', '1'], ['title', '2:1']]
    });
    const b = ev({
      id: 'b'.repeat(64),
      pubkey: pk,
      tags: [['d', 'b'], ['type', 'bible'], ['c', '1'], ['s', '2'], ['title', '1:2']]
    });
    const c = ev({
      id: 'c'.repeat(64),
      pubkey: pk,
      tags: [['d', 'c'], ['type', 'bible'], ['c', '1'], ['s', '1'], ['title', '1:1']]
    });
    const ordered = orderPublicationSections([a, b, c], { root: null });
    expect(ordered.map((e) => firstTag(e, 'title'))).toEqual(['1:1', '1:2', '2:1']);
  });
});

describe('humanizeHeading', () => {
  it('keeps numbered placeholders', () => {
    expect(humanizeHeading('Section 3')).toBe('Section 3');
    expect(humanizeHeading('preface')).toBe('Preface');
  });
});

describe('activeTocEntry', () => {
  it('prefers the exact section id, else the nearest preceding ToC row in the corpus', () => {
    const pk = 'b'.repeat(64);
    const chap = ev({
      id: '1'.repeat(64),
      kind: 30040,
      pubkey: pk,
      tags: [['d', 'ch1'], ['title', 'Chapter 1']]
    });
    const leaf = ev({
      id: '2'.repeat(64),
      kind: 30041,
      pubkey: pk,
      tags: [['d', 's1'], ['title', 'Section 1']]
    });
    const later = ev({
      id: '3'.repeat(64),
      kind: 30041,
      pubkey: pk,
      tags: [['d', 's2'], ['title', 'Section 2']]
    });
    const toc = [
      {
        pos: 0,
        title: 'Chapter 1',
        address: `30040:${pk}:ch1`,
        id: chap.id,
        depth: 0,
        index: true
      },
      {
        pos: 1,
        title: 'Section 1',
        address: `30041:${pk}:s1`,
        id: leaf.id,
        depth: 1
      }
    ];
    expect(activeTocEntry(toc, { pos: 1, sectionId: leaf.id })?.id).toBe(leaf.id);
    // Leaf not in ToC — walk corpus back to the nearest ToC row (Section 1).
    expect(
      activeTocEntry(
        [toc[0]!],
        { pos: 2, sectionId: later.id, corpus: [chap, leaf, later] }
      )?.id
    ).toBe(chap.id);
    expect(
      activeTocEntry(toc, { pos: 2, sectionId: later.id, corpus: [chap, leaf, later] })?.id
    ).toBe(leaf.id);
  });

  it('returns ancestor keys for the active path', () => {
    const toc = [
      { pos: 0, title: 'Book', address: 'a', depth: 0, root: true, index: true },
      { pos: 1, title: 'Part', address: 'b', depth: 1, index: true },
      { pos: 2, title: 'Leaf', address: 'c', depth: 2 }
    ];
    const tree = buildTocTree(toc);
    expect(tocPathKeys(tree, tocEntryKey(toc[2]!))).toEqual(['a', 'b', 'c']);
  });
});
