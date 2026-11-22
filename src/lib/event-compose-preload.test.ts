import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  canCopyEventToCompose,
  canReplaceOwnDirectoryEvent,
  canEditAsShortNote,
  canForkWikiEvent,
  canReplaceOwnWikiEvent,
  eventToComposeDraft
} from './event-compose-preload';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey'>): Event {
  return {
    id: (partial.id ?? 'a'.repeat(64)).slice(0, 64),
    created_at: partial.created_at ?? 1_700_000_000,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('eventToComposeDraft', () => {
  it('copies kind-1 content and hashtags, strips client and thread tags', () => {
    const note = ev({
      kind: KIND.TEXT_NOTE,
      pubkey: 'f'.repeat(64),
      content: 'hello world',
      tags: [
        ['t', 'nostr'],
        ['client', 'other-app'],
        ['e', 'b'.repeat(64), '', 'root'],
        ['p', 'c'.repeat(64)],
        ['custom', 'keep-me']
      ]
    });
    const draft = eventToComposeDraft(note);
    expect(draft.kind).toBe(1);
    expect(draft.content).toBe('hello world');
    expect(draft.hashtags).toEqual(['nostr']);
    expect(draft.freeformTags).toEqual([['custom', 'keep-me']]);
    expect(draft.freeformTags.some((t) => t[0] === 'client')).toBe(false);
    expect(draft.freeformTags.some((t) => t[0] === 'e')).toBe(false);
    expect(draft.contentWarningEnabled).toBe(false);
  });

  it('preloads NIP-36 content warnings outside freeform tags', () => {
    const note = ev({
      kind: KIND.TEXT_NOTE,
      pubkey: 'f'.repeat(64),
      content: 'Sensitive',
      tags: [
        ['content-warning', 'Spoilers'],
        ['custom', 'keep']
      ]
    });
    const draft = eventToComposeDraft(note);
    expect(draft.contentWarningEnabled).toBe(true);
    expect(draft.contentWarningLabel).toBe('Spoilers');
    expect(draft.freeformTags).toEqual([['custom', 'keep']]);
  });

  it('preloads NIP-88 poll options outside freeform tags', () => {
    const poll = ev({
      kind: KIND.POLL,
      pubkey: 'f'.repeat(64),
      content: 'Favorite color?',
      tags: [
        ['option', 'a1', 'Red'],
        ['option', 'a2', 'Blue'],
        ['polltype', 'multiplechoice'],
        ['endsAt', String(Math.floor(Date.now() / 1000) + 7200)],
        ['relay', 'wss://relay.example'],
        ['custom', 'keep']
      ]
    });
    const draft = eventToComposeDraft(poll);
    expect(draft.pollOptions).toEqual(['Red', 'Blue']);
    expect(draft.pollMultipleChoice).toBe(true);
    expect(draft.pollEndsHours).toBe('2');
    expect(draft.freeformTags).toEqual([['custom', 'keep']]);
  });

  it('maps publication title and authors', () => {
    const pub = ev({
      kind: KIND.PUBLICATION,
      pubkey: 'f'.repeat(64),
      content: 'body',
      tags: [
        ['d', 'my-book'],
        ['title', 'My Book'],
        ['author', 'Alice', 'translator'],
        ['client', 'x']
      ]
    });
    const draft = eventToComposeDraft(pub);
    expect(draft.values.title).toBe('My Book');
    expect(draft.values.d).toBe('my-book');
    expect(draft.values.publication_author).toContain('Alice|translator');
  });

  it('maps directory members from a/e tags', () => {
    const pk = 'f'.repeat(64);
    const coord = `30040:${pk}:aesop`;
    const id = 'b'.repeat(64);
    const dir = ev({
      kind: KIND.DIRECTORY,
      pubkey: pk,
      content: '',
      tags: [
        ['d', 'ancient-classics'],
        ['title', 'Ancient classics'],
        ['a', coord, '', id]
      ]
    });
    const draft = eventToComposeDraft(dir);
    expect(draft.values.d).toBe('ancient-classics');
    expect(draft.values.title).toBe('Ancient classics');
    expect(draft.values.members).toContain(coord);
    expect(draft.values.members).toContain(id);
    expect(draft.freeformTags.some((t) => t[0] === 'a')).toBe(false);
  });

  it('maps spec title, summary, d, hashtags, k; peels m into markup', () => {
    const pk = 'f'.repeat(64);
    const forkId = 'b'.repeat(64);
    const draft = eventToComposeDraft(
      ev({
        kind: 30817,
        pubkey: pk,
        content: '# Animated Media',
        tags: [
          ['d', 'animated-media-reaction-clips'],
          ['title', 'Animated Media (Reaction Clips)'],
          ['summary', 'Defines a content-addressed event'],
          ['t', 'gifs'],
          ['t', 'storage'],
          ['m', 'text/djot'],
          ['k', '1111', 'comment'],
          ['k', '7'],
          ['a', `30817:${pk}:prior`, '', 'fork'],
          ['e', forkId, '', 'fork'],
          ['client', 'Alexandria'],
          ['custom', 'keep-me']
        ]
      })
    );
    expect(draft.values.d).toBe('animated-media-reaction-clips');
    expect(draft.values.title).toBe('Animated Media (Reaction Clips)');
    expect(draft.values.summary).toBe('Defines a content-addressed event');
    expect(draft.hashtags).toEqual(['gifs', 'storage']);
    expect(draft.markup).toBe('djot');
    expect(draft.values.spec_kinds).toContain('1111 comment');
    expect(draft.values.spec_kinds).toContain('7');
    expect(draft.values.fork_a).toBe(`30817:${pk}:prior`);
    expect(draft.values.fork_e).toBe(forkId);
    expect(draft.freeformTags).toEqual([['custom', 'keep-me']]);
    expect(draft.freeformTags.some((t) => t[0] === 'm')).toBe(false);
    expect(draft.freeformTags.some((t) => t[0] === 'k')).toBe(false);
  });

  it('maps relay lists with read/write markers', () => {
    const draft = eventToComposeDraft(
      ev({
        kind: 10002,
        pubkey: 'f'.repeat(64),
        tags: [
          ['r', 'wss://relay.example'],
          ['r', 'wss://read.example', 'read']
        ]
      })
    );
    expect(draft.values.relays).toContain('wss://relay.example');
    expect(draft.values.relays).toContain('wss://read.example read');
  });

  it('maps favorite / search / blocked relay tags into relays', () => {
    for (const kind of [10006, 10007, 10012] as const) {
      const draft = eventToComposeDraft(
        ev({
          kind,
          pubkey: 'f'.repeat(64),
          tags: [['relay', 'wss://list.example']]
        })
      );
      expect(draft.values.relays).toBe('wss://list.example');
    }
  });

  it('maps HTTP relay r-tags and payto rows', () => {
    const relays = eventToComposeDraft(
      ev({
        kind: 10243,
        pubkey: 'f'.repeat(64),
        tags: [['r', 'https://http.example']]
      })
    );
    expect(relays.values.relays).toBe('https://http.example');

    const payto = eventToComposeDraft(
      ev({
        kind: 10133,
        pubkey: 'f'.repeat(64),
        tags: [
          ['payto', 'lightning', 'a@b.com'],
          ['payto', 'monero', '4abc']
        ]
      })
    );
    expect(payto.values.payto).toBe('lightning a@b.com\nmonero 4abc');
  });

  it('maps bookmark and e-list curation sets', () => {
    const pk = 'f'.repeat(64);
    const eid = 'b'.repeat(64);
    const coord = `30023:${pk}:article`;
    const bookmarks = eventToComposeDraft(
      ev({
        kind: 30003,
        pubkey: pk,
        tags: [
          ['d', 'reading'],
          ['title', 'Reading'],
          ['e', eid, 'wss://hint.example'],
          ['a', coord]
        ]
      })
    );
    expect(bookmarks.values.d).toBe('reading');
    expect(bookmarks.values.title).toBe('Reading');
    expect(bookmarks.values.bookmarks).toContain(`${eid}|wss://hint.example`);
    expect(bookmarks.values.bookmarks).toContain(coord);

    const videos = eventToComposeDraft(
      ev({
        kind: 30005,
        pubkey: pk,
        tags: [
          ['d', 'clips'],
          ['e', eid]
        ]
      })
    );
    expect(videos.values.items).toBe(eid);
  });

  it('maps highlight source and web comment URL', () => {
    const eid = 'c'.repeat(64);
    const highlight = eventToComposeDraft(
      ev({
        kind: 9802,
        pubkey: 'f'.repeat(64),
        content: 'quoted',
        tags: [
          ['e', eid],
          ['context', 'surrounding']
        ]
      })
    );
    expect(highlight.values.highlight_source).toBe(eid);
    expect(highlight.values.highlight_context).toBe('surrounding');

    const web = eventToComposeDraft(
      ev({
        kind: 1111,
        pubkey: 'f'.repeat(64),
        content: 'nice page',
        tags: [
          ['I', 'https://example.com/page'],
          ['i', 'https://example.com/page'],
          ['K', 'web'],
          ['k', 'web']
        ]
      })
    );
    expect(web.values.web_url).toBe('https://example.com/page');
  });

  it('maps long-form and citation tag fields', () => {
    const article = eventToComposeDraft(
      ev({
        kind: KIND.LONG_FORM,
        pubkey: 'f'.repeat(64),
        content: 'body',
        tags: [
          ['d', 'post'],
          ['title', 'Hello'],
          ['summary', 'blurb'],
          ['image', 'https://img.example/a.png'],
          ['t', 'essays']
        ]
      })
    );
    expect(article.values).toMatchObject({
      d: 'post',
      title: 'Hello',
      summary: 'blurb',
      image: 'https://img.example/a.png'
    });
    expect(article.hashtags).toEqual(['essays']);

    const cite = eventToComposeDraft(
      ev({
        kind: 31,
        pubkey: 'f'.repeat(64),
        content: 'notes',
        tags: [
          ['u', 'https://docs.example'],
          ['title', 'Docs'],
          ['author', 'Ada'],
          ['accessed_on', '01.01.2024']
        ]
      })
    );
    expect(cite.values.u).toBe('https://docs.example');
    expect(cite.values.title).toBe('Docs');
    expect(cite.values.author).toBe('Ada');
    expect(cite.values.accessed_on).toBe('01.01.2024');
  });
});

describe('canCopy / canEdit / canFork gates', () => {
  it('allows copy for notes, blocks likes and wiki', () => {
    expect(canCopyEventToCompose(1)).toBe(true);
    expect(canCopyEventToCompose(7)).toBe(false);
    expect(canCopyEventToCompose(30818)).toBe(false);
    expect(canCopyEventToCompose(30817)).toBe(false);
  });

  it('offers fork for wiki and spec only', () => {
    expect(canForkWikiEvent(30818)).toBe(true);
    expect(canForkWikiEvent(30817)).toBe(true);
    expect(canForkWikiEvent(1)).toBe(false);
  });

  it('offers replace for own wiki/spec, not for others', () => {
    const me = 'a'.repeat(64);
    const own = ev({ kind: 30818, pubkey: me, tags: [['d', 'bitcoin']] });
    const other = ev({ kind: 30818, pubkey: 'b'.repeat(64), tags: [['d', 'bitcoin']] });
    expect(canReplaceOwnWikiEvent(own, me)).toBe(true);
    expect(canReplaceOwnWikiEvent(other, me)).toBe(false);
    expect(canReplaceOwnWikiEvent(own, null)).toBe(false);
    expect(canReplaceOwnWikiEvent(ev({ kind: 1, pubkey: me }), me)).toBe(false);
  });

  it('offers replace for own directories, not via generic copy', () => {
    const me = 'a'.repeat(64);
    const own = ev({ kind: 30045, pubkey: me, tags: [['d', 'my-book-collection']] });
    const other = ev({ kind: 30045, pubkey: 'b'.repeat(64), tags: [['d', 'root']] });
    expect(canCopyEventToCompose(30045)).toBe(false);
    expect(canReplaceOwnDirectoryEvent(own, me)).toBe(true);
    expect(canReplaceOwnDirectoryEvent(other, me)).toBe(false);
    expect(canReplaceOwnDirectoryEvent(own, null)).toBe(false);
  });

  it('allows edit only for own kind 1', () => {
    const me = 'a'.repeat(64);
    const own = ev({ kind: 1, pubkey: me });
    const other = ev({ kind: 1, pubkey: 'b'.repeat(64) });
    expect(canEditAsShortNote(own, me)).toBe(true);
    expect(canEditAsShortNote(other, me)).toBe(false);
    expect(canEditAsShortNote(own, null)).toBe(false);
  });
});
