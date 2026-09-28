import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  assemblePublicationAsciidoc,
  exportCoverImageUrl,
  indexPublicationEvents,
  orderedPublicationRefsFromIndex
} from './publication-asciidoc-assembler';
import { coverPlaceholderUrl } from './cover-fallback';
import { gutenbergCoverUrl } from './cover';

const PK = 'a'.repeat(64);

function indexEvent(d: string, aTags: string[], extra: string[][] = []): Event {
  return {
    id: d.padEnd(64, '0').slice(0, 64),
    kind: KIND.PUBLICATION,
    pubkey: PK,
    created_at: 100,
    content: '',
    tags: [
      ['d', d],
      ['title', `Book ${d}`],
      ['author', 'Jane Author', 'writer'],
      ['image', 'https://example.com/cover.jpg'],
      ['version', '1.2'],
      ['summary', 'A short summary.'],
      ...aTags.map((a) => ['a', a] as [string, string]),
      ...extra
    ],
    sig: 'c'.repeat(128)
  };
}

function sectionEvent(d: string, title: string, content: string): Event {
  return {
    id: `${d}-id`.padEnd(64, '0').slice(0, 64),
    kind: KIND.SECTION,
    pubkey: PK,
    created_at: 50,
    content,
    tags: [
      ['d', d],
      ['title', title]
    ],
    sig: 'd'.repeat(128)
  };
}

describe('assemblePublicationAsciidoc', () => {
  it('builds document header with cover and nested sections', () => {
    const coord = `30041:${PK}:intro`;
    const root = indexEvent('my-book', [coord]);
    const intro = sectionEvent('intro', 'Introduction', 'Hello world.');
    const fetched = new Map<string, Event>();
    indexPublicationEvents(fetched, [root, intro]);
    const byAddress = new Map<string, Event>([
      [`30040:${PK}:my-book`, root],
      [coord, intro]
    ]);

    const assembled = assemblePublicationAsciidoc(root, fetched, byAddress);

    expect(assembled.title).toBe('Book my-book');
    expect(assembled.author).toBe('Jane Author (writer)');
    expect(assembled.image).toBe('https://example.com/cover.jpg');
    expect(assembled.content).toContain('= Book my-book');
    expect(assembled.content).toContain(':doctype: book');
    expect(assembled.content).toContain(':allow-uri-read:');
    expect(assembled.content).toContain(':front-cover-image: image:https://example.com/cover.jpg[]');
    expect(assembled.content).toContain('ifdef::backend-epub3[]');
    expect(assembled.content).toContain('image::https://example.com/cover.jpg[Cover,250]');
    expect(assembled.content).toContain('[abstract]');
    expect(assembled.content).toContain('== Introduction');
    expect(assembled.content).toContain('Hello world.');
  });

  it('embeds identifier metadata', () => {
    const coord = `30041:${PK}:about`;
    const root = indexEvent('opa-OL45883W', [coord], [
      ['source', 'https://openlibrary.org/works/OL45883W'],
      ['i', 'openlibrary:OL45883W'],
      ['i', 'isbn:0141441143'],
      ['i', 'wikidata:Q188371'],
      ['i', 'goodreads:211822142'],
      ['t', 'fiction'],
      ['l', 'en'],
      ['published_on', '1847']
    ]);
    // Override title/author for this case
    root.tags = root.tags.map((t) =>
      t[0] === 'title' ? ['title', 'Jane Eyre'] : t[0] === 'author' ? ['author', 'Charlotte Brontë', 'author'] : t
    );
    const about = sectionEvent('about', 'About', 'About this book.');
    const fetched = new Map<string, Event>();
    indexPublicationEvents(fetched, [root, about]);
    const byAddress = new Map<string, Event>([
      [`30040:${PK}:opa-OL45883W`, root],
      [coord, about]
    ]);

    const assembled = assemblePublicationAsciidoc(root, fetched, byAddress);

    expect(assembled.content).toContain(':isbn: 0141441143');
    expect(assembled.content).toContain(':openlibrary: OL45883W');
    expect(assembled.content).toContain(':wikidata: Q188371');
    expect(assembled.content).toContain(':goodreads: 211822142');
    expect(assembled.content).toContain(':keywords: fiction');
    expect(assembled.content).toContain(':lang: en');
  });
});

describe('orderedPublicationRefsFromIndex', () => {
  it('includes lowercase a/e and ignores uppercase A/E', () => {
    const event: Event = {
      id: '1'.repeat(64),
      kind: KIND.PUBLICATION,
      pubkey: PK,
      created_at: 100,
      content: '',
      tags: [
        ['d', 'book'],
        ['title', 'Book'],
        ['a', `30041:${PK}:chapter-1`],
        ['e', 'aa'.repeat(32)],
        ['A', `30040:${PK}:original-book`, 'wss://relay.example'],
        ['E', 'cc'.repeat(32), 'wss://relay.example', PK]
      ],
      sig: 'c'.repeat(128)
    };
    const refs = orderedPublicationRefsFromIndex(event);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.type)).toEqual(['a', 'e']);
  });
});

describe('exportCoverImageUrl', () => {
  it('prefers image tag, then Gutenberg, then generated placeholder', () => {
    const withImage = indexEvent('img', []);
    expect(exportCoverImageUrl(withImage)).toBe('https://example.com/cover.jpg');

    const gutenberg: Event = {
      id: '2'.repeat(64),
      kind: KIND.PUBLICATION,
      pubkey: PK,
      created_at: 1,
      content: '',
      tags: [
        ['d', 'pg141-mansfield-park'],
        ['title', 'Mansfield Park']
      ],
      sig: 'c'.repeat(128)
    };
    expect(exportCoverImageUrl(gutenberg)).toBe(gutenbergCoverUrl('141'));

    const bare: Event = {
      id: '3'.repeat(64),
      kind: KIND.PUBLICATION,
      pubkey: PK,
      created_at: 1,
      content: '',
      tags: [
        ['d', 'no-cover'],
        ['title', 'Untitled Work'],
        ['author', 'Anon']
      ],
      sig: 'c'.repeat(128)
    };
    expect(exportCoverImageUrl(bare)).toBe(coverPlaceholderUrl(bare));
    expect(exportCoverImageUrl(bare).startsWith('data:image/svg+xml')).toBe(true);
  });
});
