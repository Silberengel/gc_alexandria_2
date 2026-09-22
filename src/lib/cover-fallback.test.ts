import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  coverAuthor,
  coverPlaceholderSvg,
  coverTitle,
  humanizeTag,
  wrapWords
} from './cover-fallback';

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

describe('humanizeTag', () => {
  it('title-cases slug separators and strips Gutenberg pg prefixes', () => {
    expect(humanizeTag('mansfield-park')).toBe('Mansfield Park');
    expect(humanizeTag('pg141-mansfield-park')).toBe('Mansfield Park');
    expect(humanizeTag('jane_austen')).toBe('Jane Austen');
  });

  it('keeps already-human names', () => {
    expect(humanizeTag('Jane Austen')).toBe('Jane Austen');
    expect(humanizeTag('McDonald')).toBe('McDonald');
  });
});

describe('coverTitle / coverAuthor', () => {
  it('prefers title and author tags', () => {
    const event = ev([
      ['title', 'Mansfield Park'],
      ['T', 'other-title'],
      ['author', 'Jane Austen'],
      ['N', 'someone-else']
    ]);
    expect(coverTitle(event)).toBe('Mansfield Park');
    expect(coverAuthor(event)).toBe('Jane Austen');
  });

  it('falls back to human T then human d, and human N', () => {
    expect(coverTitle(ev([['T', 'pride-and-prejudice']]))).toBe('Pride And Prejudice');
    expect(coverTitle(ev([['d', 'pg141-mansfield-park']]))).toBe('Mansfield Park');
    expect(coverAuthor(ev([['N', 'jane-austen']]))).toBe('Jane Austen');
    expect(coverTitle(ev([]))).toBe('Untitled');
    expect(coverAuthor(ev([]))).toBe('');
  });
});

describe('coverPlaceholderSvg', () => {
  it('embeds the resolved title and author', () => {
    const svg = coverPlaceholderSvg(
      ev([
        ['title', 'Emma & Knightley'],
        ['author', 'Jane Austen']
      ])
    );
    expect(svg).toContain('Emma &amp; Knightley');
    expect(svg).toContain('Jane Austen');
    expect(svg.startsWith('<svg ')).toBe(true);
  });

  it('uses a parchment-style wiki placeholder with a Wiki label', () => {
    const wiki = { ...ev([['title', 'Aristotle'], ['d', 'aristotle']]), kind: 30818 };
    const svg = coverPlaceholderSvg(wiki);
    expect(svg).toContain('Wiki');
    expect(svg).toContain('Aristotle');
    expect(svg).not.toContain('fill-opacity="0.28"'); // book spine shadow
    expect(svg).toContain('width="180" height="280"'); // tight parchment inset
    expect(svg).toMatch(/y="274"[^>]*>Wiki</);
  });

  it('keeps Spec inside the parchment panel', () => {
    const spec = { ...ev([['title', 'Nkbip 04'], ['d', 'nkbip-04']]), kind: 30817 };
    const svg = coverPlaceholderSvg(spec);
    expect(svg).toContain('>Spec</text>');
    expect(svg).toContain('y="274"');
    expect(svg).not.toContain('y="286"');
  });
});

describe('wrapWords', () => {
  it('limits lines and ellipsizes overflow', () => {
    const lines = wrapWords('One Two Three Four Five', 8, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.at(-1)).toMatch(/…$/);
  });
});
