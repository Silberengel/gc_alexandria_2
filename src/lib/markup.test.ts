import { describe, expect, it } from 'vitest';
import { KIND } from './constants';
import {
  markupFromTags,
  withMarkupTag, 
  resolveMarkup,
  renderDjotHtml,
  renderWithFallback, 
  linkifyTopicHashtags,
  looksLikeNativeAsciidoc,
  looksLikeDjot, 
  normalizeMarkdownEmphasis
} from './markup';

describe('withMarkupTag', () => {
  it('records the body format and leaves unrelated m tags', () => {
    expect(withMarkupTag([['m', 'book'], ['t', 'wiki']], 'djot')).toEqual([
      ['m', 'book'],
      ['t', 'wiki'],
      ['m', 'text/djot']
    ]);
    expect(withMarkupTag([['m', 'text/markdown'], ['markup', 'djot']], 'asciidoc')).toEqual([
      ['m', 'text/asciidoc']
    ]);
  });
});

describe('asciidoc document header', () => {
  it('shows the title, author, and revision', async () => {
    const html = await renderWithFallback(
      KIND.WIKI,
      ['= Document Title', 'Author Name <author@email.org>', 'v2.0, 2019-03-22', '', '== Section'].join(
        '\n'
      ),
      [['m', 'text/asciidoc']]
    );
    expect(html).toContain('>Document Title</h1>');
    expect(html).toContain('Author Name');
    expect(html).toContain('mailto:author@email.org');
    expect(html).toContain('version 2.0, 2019-03-22');
    expect(html).toContain('>Section</h2>');
  });
});

describe('asciidoc ui macros', () => {
  it('renders the sidebar, menu, button, and keyboard control', async () => {
    const html = await renderWithFallback(
      KIND.WIKI,
      ['****', 'sidebar', '****', '', 'menu:File[Save]', 'btn:[OK]', 'kbd:[F11]'].join('\n'),
      [['m', 'text/asciidoc']]
    );
    expect(html).toContain('class="sidebarblock"');
    expect(html).toContain('class="menuseq"');
    expect(html).toContain('class="button">OK');
    expect(html).toContain('<kbd>F11</kbd>');
  });
});

describe('markupFromTags', () => {
  it('reads m, then markup, then format', () => {
    expect(markupFromTags([['m', 'text/asciidoc']])).toBe('asciidoc');
    expect(markupFromTags([['m', 'text/djot; charset=utf-8']])).toBe('djot');
    expect(markupFromTags([['markup', 'djot']])).toBe('djot');
    expect(markupFromTags([['format', 'markdown']])).toBe('djot');
    expect(markupFromTags([['m', 'image/jpeg']])).toBeNull();
  });
});

describe('normalizeMarkdownEmphasis', () => {
  it('collapses CommonMark doubles to Djot singles', () => {
    expect(normalizeMarkdownEmphasis('Hello **world** and __there__')).toBe(
      'Hello *world* and _there_'
    );
    expect(normalizeMarkdownEmphasis('strike ~~me~~')).toBe('strike {-me-}');
  });

  it('skips fenced and inline code', () => {
    expect(normalizeMarkdownEmphasis('`**keep**`')).toBe('`**keep**`');
    expect(normalizeMarkdownEmphasis('```\n**keep**\n```')).toBe('```\n**keep**\n```');
  });
});

describe('resolveMarkup', () => {
  it('uses AsciiDoc for kind 30041 even without tags', () => {
    expect(resolveMarkup(KIND.SECTION, '= Chapter\n\nHello.', [])).toBe('asciidoc');
    expect(resolveMarkup(KIND.SECTION, 'plain', [['m', 'text/markdown']])).toBe('asciidoc');
    expect(resolveMarkup(KIND.SECTION, 'Hello *world*', [['m', 'text/djot']])).toBe('djot');
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

  it('prefers AsciiDoc over Djot when a wiki has AD signals and wikilinks', () => {
    const mixed = '== Chapter\n\nSee [[NKBIP-01]] for details.\n\n[source, json]\n----\n{}\n----\n';
    expect(looksLikeNativeAsciidoc(mixed)).toBe(true);
    expect(resolveMarkup(KIND.WIKI, mixed)).toBe('asciidoc');
  });

  it('keeps Djot when a wiki has NIP-54 reference wikilinks', () => {
    const djot = 'See [Constantinople][] for the later name.\n';
    expect(looksLikeDjot(djot)).toBe(true);
    expect(resolveMarkup(KIND.WIKI, djot)).toBe('djot');
  });

  it('uses Djot for kind 11 and long-form', () => {
    expect(resolveMarkup(KIND.DJOT, 'Hello world')).toBe('djot');
    expect(resolveMarkup(KIND.DJOT, 'Hello **world**\n\nA markdown discussion.')).toBe('djot');
    expect(resolveMarkup(KIND.LONG_FORM, '# Chapter')).toBe('djot');
    expect(resolveMarkup(KIND.SPEC, '= Looks like AsciiDoc')).toBe('djot');
  });

  it('uses plaintext for notes and comments', () => {
    expect(resolveMarkup(KIND.COMMENT, 'A comment')).toBe('plaintext');
    expect(resolveMarkup(1, 'Hello **note**.')).toBe('plaintext');
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

  it('renders kind 11 as Djot and cleans **strong**', async () => {
    const html = await renderWithFallback(KIND.DJOT, 'Hello **world**');
    expect(html).toContain('<strong>');
    expect(html).toContain('world');
  });

  it('renders kind 11 reference links', async () => {
    const html = await renderWithFallback(KIND.DJOT, 'See [Label][] here.');
    expect(html).toContain('Label');
  });

  it('syntax-highlights AsciiDoc source blocks with highlight.js', async () => {
    const src = '[source,json]\n----\n{"title":"NKBIP-01","n":1}\n----\n';
    const html = await renderWithFallback(KIND.WIKI, src, [['m', 'text/asciidoc']]);
    expect(html).toContain('language-json');
    expect(html).toContain('hljs-attr');
    expect(html).toContain('hljs-string');
    expect(html).toContain('hljs-number');
  });

  it('syntax-highlights Djot fenced code blocks like AsciiDoc', async () => {
    const src = 'Example:\n\n```json\n{"title":"NKBIP-01","n":1}\n```\n';
    const html = await renderWithFallback(KIND.SPEC, src);
    expect(html).toContain('language-json');
    expect(html).toContain('highlight');
    expect(html).toContain('hljs-attr');
    expect(html).toContain('hljs-string');
    expect(html).toContain('hljs-number');
  });

  it('renders AsciiDoc latexmath with KaTeX', async () => {
    const src = ':stem: latexmath\n\nInline latexmath:[\\frac{a}{b}].\n\n[latexmath]\n++++\nE = mc^2\n++++\n';
    const html = await renderWithFallback(KIND.WIKI, src, [['m', 'text/asciidoc']]);
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('\\(');
    expect(html).not.toContain('\\[');
  });
});

describe('djot block attributes', () => {
  it('keeps the id and classes and shows a quote source', () => {
    const html = renderDjotHtml(`{#water}
{.important .large}
Don't forget to turn off the water!

{source="Iliad"}
> Sing, muse, of the wrath of Achilles
`);
    expect(html).toContain('<p id="water" class="important large">');
    expect(html).toContain('<footer class="djot-source">Iliad</footer>');
  });
});

describe('topic hashtags', () => {
  it('links #topics to subject search and leaves urls and code alone', async () => {
    const html = await renderWithFallback(
      KIND.TEXT_NOTE,
      'relays 5/21\nhttps://nonfungible.cash/p/abc?nft=1\n#archjourney #940911'
    );
    expect(html).toContain('href="#/search?subject=archjourney"');
    expect(html).toContain('>#archjourney</a>');
    expect(html).toContain('href="#/search?subject=940911"');
    expect(linkifyTopicHashtags('<a href="https://ex.test/#keep">https://ex.test/#keep</a>')).not.toContain(
      'subject='
    );
    expect(linkifyTopicHashtags('<code>#archjourney</code>')).toBe('<code>#archjourney</code>');
  });
});
