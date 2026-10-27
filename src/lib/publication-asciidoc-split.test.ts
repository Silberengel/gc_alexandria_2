import { describe, expect, it } from 'vitest';
import { KIND } from './constants';
import {
  MAX_LEAF_BYTES,
  applyIdealPublicationSplit,
  flattenPublishOrder,
  foldDeepHeadingsToDiscrete,
  packParagraphsToLimit,
  parseAsciiDocHeading,
  parsePublicationAsciiDoc,
  previewIdealSplitGhosts,
  serializePublicationTree
} from './publication-asciidoc-split';

describe('parseAsciiDocHeading', () => {
  it('parses == through ====== and rejects =', () => {
    expect(parseAsciiDocHeading('== Chapter')).toEqual({ level: 2, title: 'Chapter' });
    expect(parseAsciiDocHeading('=== Sec')).toEqual({ level: 3, title: 'Sec' });
    expect(parseAsciiDocHeading('= Title')).toEqual({ level: 1, title: 'Title' });
    expect(parseAsciiDocHeading('not a heading')).toBeNull();
  });
});

describe('parsePublicationAsciiDoc', () => {
  it('builds flat == chapters as 30041 under root', () => {
    const src = `== One

Hello

== Two

World
`;
    const parsed = parsePublicationAsciiDoc(src, { rootTitle: 'Book', rootDTag: 'book' });
    expect(parsed.root.kind).toBe(KIND.PUBLICATION);
    expect(parsed.root.children).toHaveLength(2);
    expect(parsed.root.children[0]!.kind).toBe(KIND.SECTION);
    expect(parsed.root.children[0]!.dTag).toBe('book-one');
    expect(parsed.root.children[0]!.content).toContain('Hello');
    expect(parsed.sectionCount).toBe(2);
    expect(parsed.indexCount).toBe(0);
  });

  it('warns on document title and strips it', () => {
    const src = `= Forbidden

== Chapter

Body
`;
    const parsed = parsePublicationAsciiDoc(src, { rootTitle: 'Book' });
    expect(parsed.warnings.some((w) => w.code === 'document_title')).toBe(true);
    expect(parsed.root.children[0]!.title).toBe('Chapter');
    // sourceLine points at the original == Chapter line (line 3), not the folded buffer.
    expect(parsed.root.children[0]!.sourceLine).toBe(3);
  });

  it('folds deeper headings to discrete when depth is ==', () => {
    const src = `== Chapter

Intro

=== Hidden

More
`;
    const folded = foldDeepHeadingsToDiscrete(src, 2);
    expect(folded.text).toContain('[discrete]');
    expect(folded.text).toContain('=== Hidden');
    const parsed = parsePublicationAsciiDoc(src, { rootTitle: 'Book', maxIndexLevel: 2 });
    expect(parsed.root.children).toHaveLength(1);
    expect(parsed.root.children[0]!.kind).toBe(KIND.SECTION);
    expect(parsed.root.children[0]!.content).toContain('[discrete]');
    expect(parsed.root.children[0]!.content).toContain('=== Hidden');
  });

  it('nests === under == when depth is 3', () => {
    const src = `== Chapter

=== Section

Body
`;
    const parsed = parsePublicationAsciiDoc(src, { rootTitle: 'Book', rootDTag: 'book', maxIndexLevel: 3 });
    expect(parsed.root.children[0]!.kind).toBe(KIND.PUBLICATION);
    expect(parsed.root.children[0]!.children[0]!.kind).toBe(KIND.SECTION);
    expect(parsed.root.children[0]!.children[0]!.dTag).toBe('book-chapter-section');
  });

  it('moves orphan intro under a branch into a Preamble child', () => {
    const src = `== Chapter

This is the intro before subsections.

=== Later

Body
`;
    const parsed = parsePublicationAsciiDoc(src, {
      rootTitle: 'Book',
      rootDTag: 'book',
      maxIndexLevel: 3
    });
    const chapter = parsed.root.children[0]!;
    expect(chapter.kind).toBe(KIND.PUBLICATION);
    expect(chapter.content).toBe('');
    expect(chapter.children[0]!.title).toBe('Preamble');
    expect(chapter.children[0]!.kind).toBe(KIND.SECTION);
    expect(chapter.children[0]!.content).toContain('intro before subsections');
    expect(chapter.children[1]!.title).toBe('Later');
    expect(parsed.warnings.some((w) => w.code === 'preamble_inserted')).toBe(true);
  });

  it('moves root lead-in text into a Preamble section', () => {
    const src = `Lead-in blurb.

== Chapter

Body
`;
    const parsed = parsePublicationAsciiDoc(src, { rootTitle: 'Book', rootDTag: 'book' });
    expect(parsed.root.children[0]!.title).toBe('Preamble');
    expect(parsed.root.children[0]!.content).toContain('Lead-in blurb');
    expect(parsed.root.children[1]!.title).toBe('Chapter');
  });
});

describe('packParagraphsToLimit / ideal split', () => {
  it('packs paragraphs under the byte ceiling', () => {
    const para = 'x'.repeat(20_000);
    const body = `${para}\n\n${para}\n\n${para}`;
    const parts = packParagraphsToLimit(body, 45_000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(45_000);
    }
  });

  it('inserts Section N under an oversized == chapter and raises depth', () => {
    const big = `${'word '.repeat(12_000)}\n\n${'more '.repeat(12_000)}`;
    expect(new TextEncoder().encode(big).length).toBeGreaterThan(MAX_LEAF_BYTES);
    const src = `== Huge\n\n${big}\n`;
    const applied = applyIdealPublicationSplit(src, {
      rootTitle: 'Book',
      rootDTag: 'book',
      maxIndexLevel: 2
    });
    expect(applied.maxIndexLevel).toBeGreaterThanOrEqual(3);
    expect(applied.source).toContain('=== Section 1');
    expect(applied.report.sectionsAdded).toBeGreaterThanOrEqual(2);
    const parsed = parsePublicationAsciiDoc(applied.source, {
      rootTitle: 'Book',
      rootDTag: 'book',
      maxIndexLevel: applied.maxIndexLevel
    });
    expect(parsed.oversizeLeaves).toHaveLength(0);
    expect(parsed.root.children[0]!.kind).toBe(KIND.PUBLICATION);
  });

  it('previews ghosts before apply', () => {
    const big = `${'aaa '.repeat(15_000)}\n\n${'bbb '.repeat(15_000)}`;
    const src = `== Huge\n\n${big}\n`;
    const parsed = parsePublicationAsciiDoc(src, { rootTitle: 'Book', maxIndexLevel: 2 });
    const ghosts = previewIdealSplitGhosts(parsed);
    expect(ghosts.length).toBe(1);
    expect(ghosts[0]!.sections.length).toBeGreaterThan(1);
  });
});

describe('flattenPublishOrder', () => {
  it('emits sections before nested indexes before root', () => {
    const src = `== Ch

=== A

a

=== B

b
`;
    const parsed = parsePublicationAsciiDoc(src, {
      rootTitle: 'Book',
      rootDTag: 'book',
      maxIndexLevel: 3
    });
    const order = flattenPublishOrder(parsed.root);
    const kinds = order.map((n) => n.kind);
    const firstIndex = kinds.indexOf(KIND.PUBLICATION);
    const lastSection = kinds.lastIndexOf(KIND.SECTION);
    expect(lastSection).toBeLessThan(firstIndex);
    expect(order[order.length - 1]).toBe(parsed.root);
  });
});

describe('serializePublicationTree', () => {
  it('round-trips a simple tree', () => {
    const src = `== One

Hello

== Two

World
`;
    const parsed = parsePublicationAsciiDoc(src, { rootTitle: 'Book', rootDTag: 'book' });
    const again = serializePublicationTree(parsed.root);
    expect(again).toContain('== One');
    expect(again).toContain('Hello');
  });
});
