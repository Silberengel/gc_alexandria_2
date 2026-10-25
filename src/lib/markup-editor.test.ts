import { describe, expect, it } from 'vitest';
import {
  editBold,
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

  it('puts one AsciiDoc document title at the top', () => {
    expect(editTitle('asciidoc', 'Hello', 0, 0).value).toBe('= Document Title\n\nHello');
    const again = editTitle('asciidoc', '= Document Title\n\nHello', 4, 4);
    expect(again.value).toBe('= Document Title\n\nHello');
    expect(again.value.slice(again.selectionStart, again.selectionEnd)).toBe('Document Title');
    expect(editTitle('djot', 'Chapter', 0, 0).value).toBe('# Chapter');
  });

  it('prefixes a heading for the active format', () => {
    expect(editHeading('djot', 'Chapter', 0, 0).value).toBe('## Chapter');
    expect(editHeading('asciidoc', 'Chapter', 0, 0).value).toBe('== Chapter');
    expect(editHeading('djot', '## Chapter', 3, 3).value).toBe('## Chapter');
  });

  it('prefixes list markers without doubling them', () => {
    expect(editList('djot', false, 'one\ntwo', 0, 7).value).toBe('- one\n- two');
    expect(editList('asciidoc', true, 'one', 0, 3).value).toBe('. one');
    expect(editList('djot', false, '- one', 0, 5).value).toBe('- one');
  });

  it('selects the URL when inserting a link around text', () => {
    const djot = editLink('djot', 'see docs', 4, 8);
    expect(djot.value).toBe('see [docs](https://)');
    expect(djot.value.slice(djot.selectionStart, djot.selectionEnd)).toBe('https://');
    const adoc = editLink('asciidoc', 'https://example.com', 0, 'https://example.com'.length);
    expect(adoc.value).toBe('link:https://example.com[link]');
    expect(adoc.value.slice(adoc.selectionStart, adoc.selectionEnd)).toBe('link');
  });

  it('inserts the major AsciiDoc constructs', () => {
    expect(editMarkup('admonition', 'asciidoc', '', 0, 0).value).toBe('NOTE: note');
    expect(editMarkup('sidebar', 'asciidoc', '', 0, 0).value).toBe('****\nsidebar\n****');
    expect(editMarkup('example', 'asciidoc', '', 0, 0).value).toBe('====\nexample\n====');
    expect(editMarkup('description', 'asciidoc', 'a meaning', 0, 9).value).toBe('term:: a meaning');
    expect(editMarkup('highlight', 'asciidoc', 'word', 0, 4).value).toBe('#word#');
    expect(editMarkup('kbd', 'asciidoc', '', 0, 0).value).toBe('kbd:[F11]');
    expect(editMarkup('xref', 'asciidoc', 'Intro', 0, 5).value).toBe('<<id,Intro>>');
    expect(editMarkup('checklist', 'asciidoc', 'pack', 0, 4).value).toBe('* [ ] pack');
    expect(editMarkup('pagebreak', 'asciidoc', '', 0, 0).value).toBe('<<<');
  });

  it('inserts a table, a code block, and the next footnote', () => {
    expect(editTable('djot', '', 0, 0).value).toContain('| --- | --- |');
    expect(editTable('asciidoc', '', 0, 0).value).toContain('|===');
    expect(editCodeBlock('djot', 'See', 3, 3).value).toBe('See\n\n```\ncode\n```');
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
