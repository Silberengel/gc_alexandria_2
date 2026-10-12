import { afterEach, describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { feedFollowAuthors, feedRelayGroups, isOriginalPost, keepFeedPosts } from './feed';
import { memoryEventsByKind, memoryEventsReferencing, rememberEvents } from './nostr/event-memory';
import { setSelectorContext } from './nostr/selector';

function ev(partial: Partial<Event> & Pick<Event, 'kind'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    tags: [],
    content: 'hello',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('isOriginalPost', () => {
  it('keeps a kind 1 note that only mentions people', () => {
    expect(
      isOriginalPost(ev({ kind: KIND.TEXT_NOTE, tags: [['p', 'd'.repeat(64)]] }))
    ).toBe(true);
  });

  it('drops kind 1 replies and non-posts', () => {
    expect(isOriginalPost(ev({ kind: KIND.TEXT_NOTE, tags: [['e', 'e'.repeat(64)]] }))).toBe(false);
    expect(isOriginalPost(ev({ kind: KIND.COMMENT }))).toBe(false);
    expect(isOriginalPost(ev({ kind: KIND.REACTION, content: '+' }))).toBe(false);
  });

  it('keeps articles and drops ones marked as replies', () => {
    expect(isOriginalPost(ev({ kind: KIND.LONG_FORM, tags: [['d', 'essay'], ['title', 'Essay']] }))).toBe(
      true
    );
    expect(
      isOriginalPost(
        ev({
          kind: KIND.LONG_FORM,
          tags: [
            ['d', 'reply'],
            ['a', '30023:aa:root', '', 'reply']
          ]
        })
      )
    ).toBe(false);
  });
});

describe('feedFollowAuthors', () => {
  it('includes follow-list pubkeys and drops muted ones', () => {
    const followed = 'd'.repeat(64);
    const muted = 'e'.repeat(64);
    const contact = ev({
      kind: KIND.CONTACT_LIST,
      tags: [
        ['p', followed],
        ['p', muted],
        ['p', 'not-a-pubkey']
      ]
    });
    expect(
      feedFollowAuthors([contact], { pubkeys: new Set([muted]), eventIds: new Set() })
    ).toEqual([followed]);
  });
});

describe('keepFeedPosts', () => {
  it('keeps the posts on screen when a load comes back empty', () => {
    const shown = [ev({ id: '1'.repeat(64), kind: KIND.TEXT_NOTE })];
    expect(keepFeedPosts(shown, [])).toBe(shown);
    const incoming = [ev({ id: '2'.repeat(64), kind: KIND.TEXT_NOTE })];
    expect(keepFeedPosts(shown, incoming)).toBe(incoming);
  });
});

describe('feedRelayGroups', () => {
  afterEach(() => {
    setSelectorContext({
      signedIn: false,
      viewerPubkey: '',
      inbox: [],
      outbox: [],
      favorites: [],
      local: [],
      blocked: []
    });
  });

  it('uses only theforest when signed out', () => {
    const { personal, shipped } = feedRelayGroups();
    expect(personal).toEqual([]);
    expect(shipped).toEqual(['wss://theforest.nostr1.com']);
  });

  it('uses inboxes, and favorites when the viewer has some', () => {
    setSelectorContext({
      signedIn: true,
      viewerPubkey: 'b'.repeat(64),
      inbox: ['wss://read.example'],
      outbox: ['wss://write.example'],
      favorites: [],
      local: ['wss://local.example']
    });
    expect(feedRelayGroups()).toEqual({
      personal: ['wss://read.example'],
      shipped: []
    });

    setSelectorContext({ favorites: ['wss://fav.example'] });
    expect(feedRelayGroups()).toEqual({
      personal: ['wss://fav.example', 'wss://read.example'],
      shipped: []
    });
  });

  it('falls back to theforest when a signed-in viewer has no inboxes or favorites', () => {
    setSelectorContext({
      signedIn: true,
      viewerPubkey: 'b'.repeat(64),
      inbox: [],
      outbox: ['wss://write.example'],
      favorites: [],
      local: ['wss://local.example']
    });
    expect(feedRelayGroups()).toEqual({
      personal: [],
      shipped: ['wss://theforest.nostr1.com']
    });
  });
});

describe('social event memory', () => {
  it('keeps an original note, its kind 1 reply, and its reaction for recall', () => {
    const op = ev({ id: '1'.repeat(64), kind: KIND.TEXT_NOTE });
    const reply = ev({
      id: '2'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [['e', op.id]]
    });
    const reaction = ev({
      id: '3'.repeat(64),
      kind: KIND.REACTION,
      content: '+',
      tags: [['e', op.id]]
    });
    const comment = ev({
      id: '4'.repeat(64),
      kind: KIND.COMMENT,
      tags: [['e', op.id]]
    });
    rememberEvents([op, reply, reaction, comment]);
    expect(memoryEventsByKind(KIND.TEXT_NOTE).some((event) => event.id === op.id)).toBe(true);
    expect(memoryEventsByKind(KIND.COMMENT).some((event) => event.id === comment.id)).toBe(true);
    expect(memoryEventsReferencing(op.id).map((event) => event.id).sort()).toEqual(
      [reply.id, reaction.id, comment.id].sort()
    );
  });
});
