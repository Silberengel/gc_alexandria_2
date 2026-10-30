import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  canDownloadEventSource,
  sourceDownloadFilename,
  sourceFileExtension
} from './download-source';

function ev(partial: Partial<Event> & Pick<Event, 'kind'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('sourceFileExtension', () => {
  it('maps markup to .adoc / .md / .txt', () => {
    expect(sourceFileExtension('asciidoc')).toBe('adoc');
    expect(sourceFileExtension('djot')).toBe('md');
    expect(sourceFileExtension('plaintext')).toBe('txt');
  });
});

describe('sourceDownloadFilename', () => {
  it('uses .adoc for AsciiDoc sections', () => {
    const event = ev({
      kind: KIND.SECTION,
      content: '== Chapter\n\nBody.',
      tags: [
        ['title', 'Judges Chapter 1'],
        ['m', 'text/asciidoc']
      ]
    });
    expect(sourceDownloadFilename(event)).toBe('Judges_Chapter_1.adoc');
  });

  it('uses .md for djot wiki / articles', () => {
    const wiki = ev({
      kind: KIND.WIKI,
      content: '# Hello\n\nWorld',
      tags: [
        ['title', 'Hello Wiki'],
        ['d', 'hello-wiki'],
        ['m', 'text/djot']
      ]
    });
    expect(sourceDownloadFilename(wiki)).toBe('Hello_Wiki.md');

    const article = ev({
      kind: KIND.LONG_FORM,
      content: 'A note',
      tags: [
        ['title', 'My Article'],
        ['d', 'my-article'],
        ['m', 'text/markdown']
      ]
    });
    expect(sourceDownloadFilename(article)).toBe('My_Article.md');
  });
});

describe('canDownloadEventSource', () => {
  it('requires non-empty body for wiki/spec/article/section', () => {
    expect(canDownloadEventSource(ev({ kind: KIND.WIKI, content: '' }))).toBe(false);
    expect(canDownloadEventSource(ev({ kind: KIND.WIKI, content: ' hi ' }))).toBe(true);
    expect(canDownloadEventSource(ev({ kind: KIND.SPEC, content: 'spec' }))).toBe(true);
    expect(canDownloadEventSource(ev({ kind: KIND.LONG_FORM, content: 'a' }))).toBe(true);
    expect(canDownloadEventSource(ev({ kind: KIND.SECTION, content: '== A' }))).toBe(true);
    expect(canDownloadEventSource(ev({ kind: KIND.PUBLICATION, content: '' }))).toBe(false);
    expect(canDownloadEventSource(ev({ kind: KIND.PUBLICATION, content: 'intro' }))).toBe(true);
  });
});
