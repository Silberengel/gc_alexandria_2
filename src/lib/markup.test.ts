import { describe, expect, it } from 'vitest';
import { KIND } from './constants';
import {
  markupFromTags,
  resolveMarkup,
  renderWithFallback,
  looksLikeNativeAsciidoc,
  looksLikeDjot
} from './markup';

describe('markupFromTags', () => {
  it('reads m, then markup, then format', () => {
    expect(markupFromTags([['m', 'text/asciidoc']])).toBe('asciidoc');
    expect(markupFromTags([['m', 'text/djot; charset=utf-8']])).toBe('djot');
    expect(markupFromTags([['markup', 'djot']])).toBe('djot');
    expect(markupFromTags([['format', 'markdown']])).toBe('markdown');
    expect(markupFromTags([['m', 'image/jpeg']])).toBeNull();
  });
});

describe('resolveMarkup', () => {
  it('uses AsciiDoc for kind 30041 even without tags', () => {
    expect(resolveMarkup(KIND.SECTION, '= Chapter\n\nHello.', [])).toBe('asciidoc');
    expect(resolveMarkup(KIND.SECTION, 'plain', [['m', 'text/markdown']])).toBe('asciidoc');
  });

  it('uses wiki tags to choose Djot vs deprecated AsciiDoc', () => {
    expect(resolveMarkup(KIND.WIKI, 'A short wiki paragraph.')).toBe('djot');
    expect(resolveMarkup(KIND.WIKI, 'A short wiki paragraph.', [['m', 'text/djot']])).toBe('djot');
    expect(resolveMarkup(KIND.WIKI, 'A short wiki paragraph.', [['m', 'text/asciidoc']])).toBe(
      'asciidoc'
    );
  });

  it('falls back to AsciiDoc for untagged wiki bodies with native AD signals', () => {
    const adoc = '= Title\n\n== Section\n\nSome body.\n';
    expect(looksLikeNativeAsciidoc(adoc)).toBe(true);
    expect(resolveMarkup(KIND.WIKI, adoc)).toBe('asciidoc');
    expect(resolveMarkup(KIND.WIKI, adoc, [['m', 'text/djot']])).toBe('djot');
  });

  it('keeps Djot when a wiki has NIP-54 reference wikilinks', () => {
    const djot = 'See [Constantinople][] for the later name.\n';
    expect(looksLikeDjot(djot)).toBe(true);
    expect(resolveMarkup(KIND.WIKI, djot)).toBe('djot');
  });

  it('uses Djot for kind 11 unless tags or CommonMark say otherwise', () => {
    expect(resolveMarkup(KIND.DJOT, 'Hello world')).toBe('djot');
    expect(resolveMarkup(KIND.DJOT, 'Hello **world**\n\nA markdown discussion.')).toBe('markdown');
    expect(resolveMarkup(KIND.DJOT, '# Title\n\nBody.', [['m', 'text/djot']])).toBe('djot');
    expect(resolveMarkup(KIND.DJOT, 'Hello world', [['m', 'text/markdown']])).toBe('markdown');
  });

  it('uses CommonMark for everything else', () => {
    expect(resolveMarkup(KIND.SPEC, '= Looks like AsciiDoc')).toBe('markdown');
    expect(resolveMarkup(KIND.LONG_FORM, '# Chapter')).toBe('markdown');
    expect(resolveMarkup(KIND.COMMENT, 'A comment')).toBe('markdown');
    expect(resolveMarkup(1, 'Hello **note**.')).toBe('markdown');
  });
});

describe('renderWithFallback', () => {
  it('renders wiki Djot and AsciiDoc distinctly', async () => {
    const djot = await renderWithFallback(KIND.WIKI, 'Hello {+added+} world', [['m', 'text/djot']]);
    expect(djot).toContain('<ins>');
    const adoc = await renderWithFallback(KIND.WIKI, '== Chapter Title\n\nHello.', [
      ['m', 'text/asciidoc']
    ]);
    expect(adoc).toMatch(/<h[12]/i);
    expect(adoc.toLowerCase()).toContain('chapter title');
  });

  it('renders kind 11 as Djot by default', async () => {
    const html = await renderWithFallback(KIND.DJOT, 'See [Label][] here.');
    expect(html).toContain('Label');
  });
});
