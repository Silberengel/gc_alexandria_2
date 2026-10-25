import { afterEach, describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  feedFollowAuthors,
  feedRelayGroups,
  isFeedReplyRow,
  isNotificationForViewer,
  isOriginalPost,
  isRepliesTimelineEvent,
  isTopLevelWebComment,
  keepFeedPosts,
  parseFeedTab
} from './feed';
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

  it('keeps highlights, bookmarks, media, music, and publication ratings', () => {
    expect(isOriginalPost(ev({ kind: KIND.HIGHLIGHT, tags: [['e', 'e'.repeat(64)]] }))).toBe(true);
    expect(isOriginalPost(ev({ kind: KIND.WEB_BOOKMARK, tags: [['d', 'https://example.com']] }))).toBe(
      true
    );
    expect(isOriginalPost(ev({ kind: KIND.SHORT_VIDEO }))).toBe(true);
    expect(isOriginalPost(ev({ kind: KIND.VOICE }))).toBe(true);
    expect(isOriginalPost(ev({ kind: KIND.MUSIC }))).toBe(true);
    expect(
      isOriginalPost(
        ev({
          kind: KIND.RATING,
          tags: [
            ['d', `30040:${'a'.repeat(64)}:book`],
            ['a', `30040:${'a'.repeat(64)}:book`],
            ['rating', '1']
          ]
        })
      )
    ).toBe(true);
  });

  it('keeps top-level web comments and drops note-thread comments', () => {
    const web = ev({
      kind: KIND.COMMENT,
      tags: [
        ['I', 'https://example.com/article'],
        ['K', 'web']
      ]
    });
    expect(isTopLevelWebComment(web)).toBe(true);
    expect(isOriginalPost(web)).toBe(true);
    expect(
      isOriginalPost(
        ev({
          kind: KIND.COMMENT,
          tags: [
            ['e', 'e'.repeat(64)],
            ['E', 'e'.repeat(64)],
            ['K', '1']
          ]
        })
      )
    ).toBe(false);
  });
});

describe('replies timeline', () => {
  it('treats kind 1 replies and comments as reply rows', () => {
    expect(isFeedReplyRow(ev({ kind: KIND.TEXT_NOTE, tags: [['e', 'e'.repeat(64)]] }))).toBe(true);
    expect(isFeedReplyRow(ev({ kind: KIND.COMMENT, tags: [['e', 'e'.repeat(64)]] }))).toBe(true);
    expect(isFeedReplyRow(ev({ kind: KIND.TEXT_NOTE, tags: [] }))).toBe(false);
  });

  it('keeps OPs and replies on the Replies tab, not reactions', () => {
    expect(isRepliesTimelineEvent(ev({ kind: KIND.TEXT_NOTE, tags: [] }))).toBe(true);
    expect(
      isRepliesTimelineEvent(ev({ kind: KIND.TEXT_NOTE, tags: [['e', 'e'.repeat(64)]] }))
    ).toBe(true);
    expect(isRepliesTimelineEvent(ev({ kind: KIND.COMMENT }))).toBe(true);
    expect(isRepliesTimelineEvent(ev({ kind: KIND.REACTION, content: '+' }))).toBe(false);
  });
});

describe('notifications', () => {
  const viewer = 'a'.repeat(64);
  const other = 'b'.repeat(64);

  it('keeps another pubkey’s #p-tagged response', () => {
    expect(
      isNotificationForViewer(
        ev({
          pubkey: other,
          kind: KIND.REACTION,
          content: '+',
          tags: [
            ['e', 'c'.repeat(64)],
            ['p', viewer]
          ]
        }),
        viewer
      )
    ).toBe(true);
  });

  it('keeps kind 6 and 16 boosts that #p-tag the viewer', () => {
    expect(
      isNotificationForViewer(
        ev({
          pubkey: other,
          kind: KIND.REPOST,
          tags: [
            ['e', 'c'.repeat(64)],
            ['p', viewer]
          ]
        }),
        viewer
      )
    ).toBe(true);
    expect(
      isNotificationForViewer(
        ev({
          pubkey: other,
          kind: KIND.GENERIC_REPOST,
          tags: [
            ['e', 'c'.repeat(64)],
            ['p', viewer],
            ['k', '1111']
          ]
        }),
        viewer
      )
    ).toBe(true);
  });

  it('drops the viewer’s own events and untagged noise', () => {
    expect(
      isNotificationForViewer(
        ev({ pubkey: viewer, kind: KIND.TEXT_NOTE, tags: [['p', viewer]] }),
        viewer
      )
    ).toBe(false);
    expect(
      isNotificationForViewer(ev({ pubkey: other, kind: KIND.TEXT_NOTE, tags: [] }), viewer)
    ).toBe(false);
  });
});

describe('parseFeedTab', () => {
  it('defaults to original and accepts replies/notifications', () => {
    expect(parseFeedTab(null)).toBe('original');
    expect(parseFeedTab('replies')).toBe('replies');
    expect(parseFeedTab('notifications')).toBe('notifications');
    expect(parseFeedTab('nope')).toBe('original');
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
