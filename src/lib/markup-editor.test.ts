import { describe, expect, it } from 'vitest';
import {
  editBold,
  editCitation,
  editCodeBlock,
  editFootnote,
  editHeading,
  editTitle,
  editLink,
  editList,
  editMarkup,
  editMedia,
  editTable,
  mediaMarkup
} from './markup-editor';

describe('markup editor insertions', () => {
  it('wraps a selection in bold and offers a placeholder when empty', () => {
    expect(editBold('Say hello', 4, 9)).toMatchObject({
      value: 'Say *hello*',
      selectionStart: 5,
      selectionEnd: 10
    });
    expect(editBold('Say ', 4, 4).value).toBe('Say *bold*');
  });

  it('inserts a document title sample for each format', () => {
    expect(editTitle('asciidoc', 'Hello', 0, 0).value).toBe('= Title of the document\n\nHello');
    const again = editTitle('asciidoc', '= Title of the document\n\nHello', 4, 4);
    expect(again.value).toBe('= Title of the document\n\nHello');
    expect(again.value.slice(again.selectionStart, again.selectionEnd)).toBe('Title of the document');
    expect(editTitle('djot', '', 0, 0).value).toBe('# Title of the document');
    expect(editTitle('djot', 'Chapter', 0, 7).value).toBe('# Chapter');
  });

  it('inserts a second-level header sample for each format', () => {
    expect(editHeading('djot', '', 0, 0).value).toBe('## A second-level header');
    expect(editHeading('asciidoc', '', 0, 0).value).toBe('== A second-level header');
    expect(editHeading('djot', 'Chapter', 0, 0).value).toBe('## Chapter');
    expect(editHeading('djot', '## Chapter', 3, 3).value).toBe('## Chapter');
  });

  it('inserts nested list samples, or prefixes a selection', () => {
    expect(editList('djot', false, '', 0, 0).value).toContain('* a bullet');
    expect(editList('djot', false, '', 0, 0).value).toContain(
      '1. numbered list within a bulleted list'
    );
    expect(editList('djot', true, '', 0, 0).value).toContain('1. first item');
    expect(editList('djot', true, '', 0, 0).value).toContain('* bullet under numbered list');
    expect(editList('asciidoc', false, '', 0, 0).value).toContain('** indented bullet');
    expect(editList('asciidoc', false, '', 0, 0).value).toContain('. no blank lines between the rows');
    expect(editList('asciidoc', true, '', 0, 0).value).toContain('.. first indented item');
    expect(editList('asciidoc', true, '', 0, 0).value).toContain('... a deeper indent');
    expect(editList('djot', false, 'one\ntwo', 0, 7).value).toBe('* one\n* two');
    expect(editList('asciidoc', true, 'one', 0, 3).value).toBe('. one');
    expect(editList('djot', false, '* one', 0, 5).value).toBe('* one');
  });

  it('inserts a link sample with display text and example.com', () => {
    expect(editLink('djot', '', 0, 0).value).toBe('[display text](https://example.com)');
    const djot = editLink('djot', 'see docs', 4, 8);
    expect(djot.value).toBe('see [docs](https://example.com)');
    expect(djot.value.slice(djot.selectionStart, djot.selectionEnd)).toBe('docs');
    const adoc = editLink('asciidoc', 'https://example.com', 0, 'https://example.com'.length);
    expect(adoc.value).toBe('link:https://example.com[display text]');
    expect(adoc.value.slice(adoc.selectionStart, adoc.selectionEnd)).toBe('display text');
  });

  it('inserts the major AsciiDoc constructs', () => {
    expect(editMarkup('admonition', 'asciidoc', '', 0, 0).value).toContain(
      "This is a callout block. Use it to catch the reader's attention"
    );
    expect(editMarkup('admonition', 'djot', '', 0, 0).value).toBe(
      "::: note\nThis is a callout block. Use it to catch the reader's attention, to focus on certain information.\n:::"
    );
    expect(editMarkup('sidebar', 'asciidoc', '', 0, 0).value).toContain(
      '****\nThis is a sidebar. It is a way to divide up the flow of the text.'
    );
    expect(editMarkup('sidebar', 'djot', '', 0, 0).value).toContain('::: sidebar\nThis is a sidebar.');
    expect(editMarkup('example', 'asciidoc', '', 0, 0).value).toBe('====\nexample\n====');
    expect(editMarkup('description', 'asciidoc', 'a meaning', 0, 9).value).toBe('term:: a meaning');
    expect(editMarkup('description', 'djot', 'a meaning', 0, 9).value).toBe(': term\n\n  a meaning');
    expect(editMarkup('description', 'djot', '', 0, 0).value).toContain(': term\n\n  description');
    expect(editMarkup('description', 'djot', '', 0, 0).value).toContain(': another term');
    expect(editMarkup('description', 'asciidoc', '', 0, 0).value).toContain('another term:: another description');
    expect(editMarkup('highlight', 'asciidoc', 'word', 0, 4).value).toBe('#word#');
    expect(editMarkup('kbd', 'asciidoc', '', 0, 0).value).toBe('kbd:[F11]');
    expect(editMarkup('xref', 'asciidoc', 'Intro', 0, 5).value).toBe('<<id,Intro>>');
    expect(editMarkup('checklist', 'asciidoc', 'pack', 0, 4).value).toBe('* [ ] pack');
    expect(editMarkup('checklist', 'djot', '', 0, 0).value).toBe(
      '- [ ] this is an unchecked box\n- [x] this is a checked one'
    );
    expect(editMarkup('checklist', 'asciidoc', '', 0, 0).value).toContain('* [x] this is a checked one');
    expect(editMarkup('literal', 'asciidoc', '', 0, 0).value).toContain('....\nThe autumn wind');
    expect(editMarkup('codeblock', 'asciidoc', '', 0, 0).value).toContain('[source,json]\n----\n{');
    expect(editMarkup('quote', 'asciidoc', '', 0, 0).value).toContain(
      '[quote, Emily Dickinson, Hope Is The Thing With Feathers]'
    );
    expect(editMarkup('menu', 'asciidoc', '', 0, 0).value).toBe('menu:File[Save]');
    expect(editMarkup('menu', 'asciidoc', 'Export', 0, 6).value).toBe('menu:Menu[Export]');
  });

  it('inserts sample code, literal, and attributed quote for both formats', () => {
    expect(editMarkup('code', 'djot', '', 0, 0).value).toBe('`inline code`');
    expect(editCodeBlock('djot', 'See', 3, 3).value).toContain('See\n\n```json\n{');
    expect(editMarkup('literal', 'djot', '', 0, 0).value).toContain('```\nThe autumn wind');
    expect(editMarkup('literal', 'djot', '', 0, 0).value).not.toContain('```json');
    expect(editMarkup('quote', 'djot', '', 0, 0).value).toContain(
      '{source="Hope Is The Thing With Feathers, by Emily Dickinson"}'
    );
    expect(editMarkup('quote', 'djot', '', 0, 0).value).toContain('> ‘Hope’ is the thing with feathers');
  });

  it('inserts an NKBIP-03 citation macro', () => {
    expect(editCitation('Hello', 5, 5, 'inline', 'nevent1abc').value).toBe(
      'Hello[[citation::inline::nevent1abc]]'
    );
    expect(editCitation('x', 0, 1, 'end', 'nostr:nevent1xyz').value).toBe(
      '[[citation::end::nevent1xyz]]'
    );
  });

  it('wraps a selection in a quote with a generic attribution placeholder', () => {
    const adoc = editMarkup('quote', 'asciidoc', 'selected body', 0, 'selected body'.length);
    expect(adoc.value).toContain('[quote, attribution]');
    expect(adoc.value).toContain('____\nselected body\n____');
    expect(adoc.value).not.toContain('Emily Dickinson');
    expect(adoc.value.slice(adoc.selectionStart, adoc.selectionEnd)).toBe('attribution');

    const djot = editMarkup('quote', 'djot', 'line one\nline two', 0, 'line one\nline two'.length);
    expect(djot.value).toContain('{source="attribution"}');
    expect(djot.value).toContain('> line one\n> line two');
    expect(djot.value).not.toContain('Emily Dickinson');
    expect(djot.value.slice(djot.selectionStart, djot.selectionEnd)).toBe('attribution');
  });

  it('inserts inline and display TeX examples', () => {
    const inline = editMarkup('tex-inline', 'djot', '', 0, 0);
    expect(inline.value).toBe('$E = mc^2$');
    expect(inline.value.slice(inline.selectionStart, inline.selectionEnd)).toBe('E = mc^2');

    const display = editMarkup('tex-display', 'asciidoc', 'Hello', 5, 5);
    expect(display.value).toContain('$$\n');
    expect(display.value).toContain('\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}');
    expect(display.value.slice(display.selectionStart, display.selectionEnd)).toContain('\\frac{-b');

    const wrapped = editMarkup('tex-inline', 'djot', 'see a+b here', 4, 7);
    expect(wrapped.value).toBe('see $a+b$ here');
  });

  it('inserts a table and the next footnote', () => {
    expect(editTable('djot', '', 0, 0).value).toContain('|----|----|');
    expect(editTable('asciidoc', '', 0, 0).value).toContain('[cols="5,2,>3", options="footer"]');
    expect(editTable('asciidoc', '', 0, 0).value).toContain(
      '.A table with a title, header and footer, horizontal alignment, and column width'
    );
    const note = editFootnote('djot', 'Hello[^1]', 9, 9);
    expect(note.value.startsWith('Hello[^1][^2]')).toBe(true);
    expect(note.value).toContain('[^2]: note');
    expect(editFootnote('asciidoc', 'Hello', 5, 5).value).toBe('Hellofootnote:[note]');
  });

  it('inserts Blossom URLs as image, video, or audio markup', () => {
    const image = { url: 'https://blossom.example/a.png', mime: 'image/png', name: 'plate.png' };
    expect(mediaMarkup('djot', image)).toBe('![plate](https://blossom.example/a.png)');
    expect(mediaMarkup('asciidoc', image)).toBe('image::https://blossom.example/a.png[plate]');

    const video = { url: 'https://blossom.example/a.mp4', mime: 'video/mp4', name: 'clip.mp4' };
    expect(mediaMarkup('djot', video)).toContain('<video src="https://blossom.example/a.mp4" controls>');
    expect(mediaMarkup('asciidoc', video)).toBe('video::https://blossom.example/a.mp4[]');

    const audio = { url: 'https://blossom.example/a.mp3', mime: 'audio/mpeg', name: 'take.mp3' };
    expect(mediaMarkup('djot', audio)).toContain('<audio src="https://blossom.example/a.mp3" controls>');
    expect(mediaMarkup('asciidoc', audio)).toBe('audio::https://blossom.example/a.mp3[]');

    const placed = editMedia('djot', 'Hello', 5, 5, image);
    expect(placed.value).toBe('Hello\n\n![plate](https://blossom.example/a.png)');
  });
});
