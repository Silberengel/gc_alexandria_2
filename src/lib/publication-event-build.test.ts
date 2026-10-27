import { describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  buildNestedIndexPartial,
  buildRootPartial,
  buildSectionPartial,
  ensureTitleD,
  membershipATag,
  stripSectionTags
} from './publication-event-build';
import type { PublicationSplitNode } from './publication-asciidoc-split';

vi.mock('./sign', () => ({
  withClientTag: (tags: string[][]) => [...tags, ['client', 'test']]
}));

function leaf(over: Partial<PublicationSplitNode> = {}): PublicationSplitNode {
  return {
    level: 2,
    title: 'Chapter',
    dTag: 'book-chapter',
    kind: KIND.SECTION,
    content: 'Body text',
    children: [],
    sourceLine: 1,
    contentBytes: 9,
    ...over
  };
}

function fakeChild(id: string, d: string, kind = KIND.SECTION): Event {
  return {
    id,
    pubkey: 'ab'.repeat(32),
    created_at: 1,
    kind,
    tags: [
      ['d', d],
      ['title', 'T']
    ],
    content: 'x',
    sig: '00'
  };
}

describe('publication-event-build', () => {
  it('builds membership a-tags with kind:pubkey:d and event id', () => {
    const child = fakeChild('ff'.repeat(32), 'sec-1');
    expect(membershipATag(child)).toEqual([
      'a',
      `30041:${'ab'.repeat(32)}:sec-1`,
      '',
      'ff'.repeat(32)
    ]);
  });

  it('strips link-mode a/e tags and forces title + d', () => {
    const tags = stripSectionTags([
      ['title', 'Old'],
      ['d', 'old'],
      ['a', '30041:pk:x'],
      ['e', 'dead'],
      ['summary', 'Hi']
    ]);
    expect(tags).toEqual([
      ['title', 'Old'],
      ['d', 'old'],
      ['summary', 'Hi']
    ]);
    expect(ensureTitleD(tags, 'New', 'new-d')).toEqual([
      ['title', 'New'],
      ['d', 'new-d'],
      ['summary', 'Hi']
    ]);
  });

  it('builds a 30041 section partial with asciidoc markup', () => {
    const partial = buildSectionPartial(leaf({ title: 'I', dTag: 'book-i', content: 'Hello' }));
    expect(partial.kind).toBe(KIND.SECTION);
    expect(partial.content).toBe('Hello');
    expect(partial.tags).toEqual(
      expect.arrayContaining([
        ['title', 'I'],
        ['d', 'book-i'],
        ['m', 'text/asciidoc'],
        ['client', 'test']
      ])
    );
  });

  it('builds a nested 30040 with child a-tags', () => {
    const node = leaf({
      level: 2,
      kind: KIND.PUBLICATION,
      title: 'Mansions',
      dTag: 'book-mansions',
      content: ''
    });
    const child = fakeChild('11'.repeat(32), 'book-mansions-ch');
    const partial = buildNestedIndexPartial(node, [child]);
    expect(partial.kind).toBe(KIND.PUBLICATION);
    expect(partial.content).toBe('');
    expect(partial.tags).toEqual(
      expect.arrayContaining([
        ['title', 'Mansions'],
        ['d', 'book-mansions'],
        ['a', `30041:${'ab'.repeat(32)}:book-mansions-ch`, '', '11'.repeat(32)]
      ])
    );
  });

  it('builds a root 30040 from compose form metadata plus children', () => {
    const root = leaf({
      level: 0,
      kind: KIND.PUBLICATION,
      title: 'Interior Castle',
      dTag: 'interior-castle',
      content: ''
    });
    const child = fakeChild('22'.repeat(32), 'interior-castle-ch', KIND.PUBLICATION);
    const partial = buildRootPartial(
      {
        kind: KIND.PUBLICATION,
        content: '',
        values: {
          title: 'Interior Castle',
          d: 'interior-castle',
          summary: 'Mansions of the soul',
          sections: 'should-be-stripped'
        }
      },
      root,
      [child]
    );
    expect(partial.kind).toBe(KIND.PUBLICATION);
    expect(partial.tags.find((t) => t[0] === 'title')).toEqual(['title', 'Interior Castle']);
    expect(partial.tags.find((t) => t[0] === 'd')).toEqual(['d', 'interior-castle']);
    expect(partial.tags.some((t) => t[0] === 'a' && t[1]?.includes('interior-castle-ch'))).toBe(
      true
    );
    expect(partial.tags.some((t) => t[0] === 'a' && t[1] === 'should-be-stripped')).toBe(false);
  });
});
