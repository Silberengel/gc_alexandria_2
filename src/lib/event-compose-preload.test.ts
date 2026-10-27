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
