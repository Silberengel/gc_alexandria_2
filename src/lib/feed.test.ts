import { afterEach, describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { feedFollowAuthors, feedRelayGroups, isOriginalPost } from './feed';
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
