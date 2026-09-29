import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  celticEmblemUrl,
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
  it('embeds the resolved title and author on a dark tooled cover', () => {
    const svg = coverPlaceholderSvg(
      ev([
        ['title', 'Emma & Knightley'],
        ['author', 'Jane Austen']
      ])
    );
    expect(svg).toContain('Emma &amp;');
    expect(svg).toContain('Knightley');
    expect(svg).toContain('Jane Austen');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('#713b32'); // signature oxblood medallion
    expect(svg).toContain('rotate(90)'); // celtic quatrefoil lobes
    expect(svg).toContain('font-size="19"');
    expect(svg).toContain('font-weight="700"');
  });

  it('exports a standalone celtic emblem data URL', () => {
    const url = celticEmblemUrl();
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(url)).toContain('#713b32');
    expect(decodeURIComponent(url)).toContain('rotate(90)');
  });

  it('uses a parchment wiki placeholder with large title type', () => {
    const wiki = { ...ev([['title', 'Aristotle'], ['d', 'aristotle']]), kind: 30818 };
    const svg = coverPlaceholderSvg(wiki);
    expect(svg).toContain('WIKI');
    expect(svg).toContain('Aristotle');
    expect(svg).toContain('font-size="19"');
    expect(svg).toContain('font-weight="700"');
    expect(svg).not.toContain('#713b32'); // no oxblood medallion
    expect(svg).not.toContain('rotate(90)');
    expect(svg).toContain('width="180" height="280"'); // parchment inset
    expect(svg).toMatch(/y="274"[^>]*>WIKI</);
  });

  it('uses a slate blueprint plate for specs, distinct from wiki parchment', () => {
    const spec = { ...ev([['title', 'Nkbip 04'], ['d', 'nkbip-04']]), kind: 30817 };
    const svg = coverPlaceholderSvg(spec);
    expect(svg).toContain('>SPEC</text>');
    expect(svg).toContain('30817');
    expect(svg).toContain('ui-sans-serif');
    expect(svg).not.toContain('Georgia');
    expect(svg).not.toContain('#713b32');
    expect(svg).not.toContain('WIKI');
  });

  it('uses a magazine plate for long-form articles, distinct from wiki and spec', () => {
    const article = {
      ...ev([['title', 'Living Like God In France'], ['author', 'Silberengel'], ['d', 'living']]),
      kind: 30023
    };
    const svg = coverPlaceholderSvg(article);
    expect(svg).toContain('ARTICLE');
    expect(svg).toContain('30023');
    expect(svg).toContain('Living Like');
    expect(svg).toContain('Silberengel');
    expect(svg).toContain('Georgia');
    expect(svg).not.toContain('>WIKI</');
    expect(svg).not.toContain('>SPEC</');
    expect(svg).not.toContain('#713b32');
  });
});

describe('wrapWords', () => {
  it('limits lines and ellipsizes overflow', () => {
    const lines = wrapWords('One Two Three Four Five', 8, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.at(-1)).toMatch(/…$/);
  });
});
