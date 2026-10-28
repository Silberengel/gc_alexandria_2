import { afterEach, describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  collectNewFeedEvents,
  DEFAULT_NOTIFICATION_LOOKBACK,
  FEED_FILTER_KINDS,
  encodeKindFeedTab,
  feedTabKinds,
  feedTabLabel,
  feedEventsWatermark,
  feedFollowAuthors,
  feedAuthorRepliesPath,
  feedListPath,
  feedRelayGroups,
  feedInteractionTargetPointer,
  feedThreadPath,
  feedThreadPathFromId,
  feedThreadRootPointer,
  isFeedInteractionEvent,
  isFeedReplyRow,
  isNotificationForViewer,
  isFeedRepost,
  isOriginalPost,
  isRepliesTimelineEvent,
  isTopLevelWebComment,
  keepFeedPosts,
  notificationLookbackSeconds,
  parseFeedAuthorParam,
  parseFeedTab,
  parseFeedThreadParam,
  parseNotificationLookback
} from './feed';
import { nip19 } from 'nostr-tools';
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

  it('keeps kind 6 / 16 reposts on author timelines', () => {
    const boost = ev({
      kind: KIND.REPOST,
      tags: [
        ['e', 'e'.repeat(64), 'wss://relay.example'],
        ['p', 'f'.repeat(64)]
      ]
    });
    const generic = ev({
      kind: KIND.GENERIC_REPOST,
      tags: [
        ['e', 'e'.repeat(64), 'wss://relay.example'],
        ['k', '30023'],
        ['p', 'f'.repeat(64)]
      ]
    });
    expect(isFeedRepost(boost)).toBe(true);
    expect(isFeedRepost(generic)).toBe(true);
    expect(isOriginalPost(boost)).toBe(true);
    expect(isOriginalPost(generic)).toBe(true);
    expect(isRepliesTimelineEvent(boost)).toBe(true);
    expect(isRepliesTimelineEvent(generic)).toBe(true);
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

  it('excludes publication indexes, sections, specs, and wikis (own hub pages)', () => {
    expect(
      isOriginalPost(ev({ kind: KIND.PUBLICATION, tags: [['d', 'book'], ['title', 'Book']] }))
    ).toBe(false);
    expect(
      isOriginalPost(ev({ kind: KIND.SECTION, tags: [['d', 'ch-1'], ['title', 'Chapter 1']] }))
    ).toBe(false);
    expect(
      isOriginalPost(ev({ kind: KIND.SPEC, tags: [['d', 'nkbip-01'], ['title', 'NKBIP-01']] }))
    ).toBe(false);
    expect(isOriginalPost(ev({ kind: KIND.WIKI, tags: [['d', 'topic'], ['title', 'Topic']] }))).toBe(
      false
    );
    expect(
      isRepliesTimelineEvent(
        ev({ kind: KIND.PUBLICATION, tags: [['d', 'book'], ['title', 'Book']] })
      )
    ).toBe(false);
    expect(
      isRepliesTimelineEvent(
        ev({ kind: KIND.SPEC, tags: [['d', 'nkbip-01'], ['title', 'NKBIP-01']] })
      )
    ).toBe(false);
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

describe('feed kind filter options', () => {
  it('lists feed kinds ascending without library catalog kinds', () => {
    expect(FEED_FILTER_KINDS).toEqual([...FEED_FILTER_KINDS].sort((a, b) => a - b));
    expect(FEED_FILTER_KINDS).toContain(KIND.TEXT_NOTE);
    expect(FEED_FILTER_KINDS).toContain(KIND.COMMENT);
    expect(FEED_FILTER_KINDS).toContain(KIND.LONG_FORM);
    expect(FEED_FILTER_KINDS).toContain(KIND.REACTION);
    expect(FEED_FILTER_KINDS).toContain(KIND.REPOST);
    expect(FEED_FILTER_KINDS).not.toContain(KIND.PUBLICATION);
    expect(FEED_FILTER_KINDS).not.toContain(KIND.SECTION);
    expect(FEED_FILTER_KINDS).not.toContain(KIND.WIKI);
    expect(FEED_FILTER_KINDS).not.toContain(KIND.SPEC);
  });
});

describe('notification lookback', () => {
  it('parses known ids and defaults unknown to 24 hours', () => {
    expect(DEFAULT_NOTIFICATION_LOOKBACK).toBe('24h');
    expect(parseNotificationLookback('24h')).toBe('24h');
    expect(parseNotificationLookback('all')).toBe('all');
    expect(parseNotificationLookback('nope')).toBe(DEFAULT_NOTIFICATION_LOOKBACK);
    expect(notificationLookbackSeconds('24h')).toBe(24 * 60 * 60);
    expect(notificationLookbackSeconds('1w')).toBe(7 * 24 * 60 * 60);
    expect(notificationLookbackSeconds('3m')).toBe(90 * 24 * 60 * 60);
    expect(notificationLookbackSeconds('all')).toBeNull();
    // Runtime fallback if an invalid id is cast past the type checker.
    expect(notificationLookbackSeconds('nope' as never)).toBe(24 * 60 * 60);
    expect(notificationLookbackSeconds()).toBe(24 * 60 * 60);
  });

  it('detects a wider lookback that needs a relay requery', async () => {
    const { feedLookbackIsWider } = await import('./feed');
    expect(feedLookbackIsWider('24h', null)).toBe(true);
    expect(feedLookbackIsWider('1w', '24h')).toBe(true);
    expect(feedLookbackIsWider('all', '1m')).toBe(true);
    expect(feedLookbackIsWider('24h', '1w')).toBe(false);
    expect(feedLookbackIsWider('1m', 'all')).toBe(false);
    expect(feedLookbackIsWider('24h', '24h')).toBe(false);
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

describe('kind feed tabs', () => {
  it('encodes single and multi-kind tabs sorted unique', () => {
    expect(encodeKindFeedTab([])).toBeNull();
    expect(encodeKindFeedTab([1])).toBe('kind:1');
    expect(encodeKindFeedTab([1111, 1, 7, 1])).toBe('kind:1+7+1111');
    expect(feedTabKinds('kind:1')).toEqual([1]);
    expect(feedTabKinds('kind:1+7+1111')).toEqual([1, 7, 1111]);
    expect(feedTabKinds('original')).toEqual([]);
    expect(feedTabLabel('kind:1')).toBe('Kind 1');
    expect(feedTabLabel('kind:1+7+1111')).toBe('Kinds 1+7+1111');
    expect(feedTabLabel('kind:1+7+1111+30023')).toBe('4 kinds');
    expect(feedTabLabel('kind:1+7', 'Social')).toBe('Social');
    expect(feedTabLabel('kind:1', '  Media hits  ')).toBe('Media hits');
    expect(feedTabLabel('kind:1', '   ')).toBe('Kind 1');
    expect(feedTabLabel('follows', 'Nope')).toBe('Follows');
  });
});

describe('parseFeedTab', () => {
  it('defaults to original and accepts follows/replies/notifications/kind tabs', () => {
    expect(parseFeedTab(null)).toBe('original');
    expect(parseFeedTab('follows')).toBe('follows');
    expect(parseFeedTab('replies')).toBe('replies');
    expect(parseFeedTab('notifications')).toBe('notifications');
    expect(parseFeedTab('kind:1')).toBe('kind:1');
    expect(parseFeedTab('kind:30023')).toBe('kind:30023');
    expect(parseFeedTab('kind:7+1')).toBe('kind:1+7');
    expect(parseFeedTab('kind:nope')).toBe('original');
    expect(parseFeedTab('nope')).toBe('original');
  });
});

describe('parseFeedAuthorParam', () => {
  it('accepts hex and npub, rejects junk', () => {
    const pk = 'a'.repeat(64);
    expect(parseFeedAuthorParam(pk)).toBe(pk);
    expect(parseFeedAuthorParam(nip19.npubEncode(pk))).toBe(pk);
    expect(parseFeedAuthorParam('not-a-key')).toBeNull();
    expect(parseFeedAuthorParam(null)).toBeNull();
  });
});

describe('feed URL contract', () => {
  it('list paths always write tab= so bare /feed stays “first strip tab”', () => {
    // Bare /feed is entry-only (Feed.svelte rewrites); original is explicit.
    expect(feedListPath('original')).toBe('/feed?tab=original');
    expect(feedListPath('follows')).toBe('/feed?tab=follows');
    expect(feedListPath('replies')).toBe('/feed?tab=replies');
    expect(feedListPath('kind:1')).toBe('/feed?tab=kind%3A1');
  });

  it('default thread omits tab; non-default keeps tab for close-back-to-list', () => {
    const note = ev({ id: '1'.repeat(64), kind: KIND.TEXT_NOTE, pubkey: 'a'.repeat(64) });
    const nevent = nip19.neventEncode({
      id: note.id,
      author: note.pubkey,
      kind: note.kind
    });
    expect(feedThreadPath(note)).toBe(`/feed?thread=${nevent}`);
    expect(feedThreadPath(note)).not.toContain('tab=');
    expect(parseFeedTab(null)).toBe('original');
    expect(feedThreadPath(note, 'follows')).toBe(`/feed?thread=${nevent}&tab=follows`);
    expect(feedThreadPath(note, 'replies')).toBe(`/feed?thread=${nevent}&tab=replies`);
    expect(feedThreadPathFromId(note.id)).toBe(`/feed?thread=${nip19.neventEncode({ id: note.id })}`);
    expect(feedThreadPathFromId(note.id)).not.toContain('tab=');
    expect(feedThreadPathFromId(note.id, 'follows')).toBe(
      `/feed?thread=${nip19.neventEncode({ id: note.id })}&tab=follows`
    );
  });
});

describe('feedAuthorRepliesPath', () => {
  it('builds a replies tab URL scoped to the author', () => {
    const pk = 'a'.repeat(64);
    expect(feedAuthorRepliesPath(pk)).toBe(`/feed?tab=replies&author=${pk}`);
    expect(feedListPath('replies', { author: pk })).toBe(`/feed?tab=replies&author=${pk}`);
    expect(feedListPath('original', { author: pk })).toBe(`/feed?tab=original&author=${pk}`);
    expect(feedListPath('follows')).toBe('/feed?tab=follows');
    expect(feedListPath('kind:1')).toBe('/feed?tab=kind%3A1');
    expect(feedListPath('original')).toBe('/feed?tab=original');
  });
});

describe('feedFollowAuthors', () => {
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
      feedFollowAuthors([contact], {
        pubkeys: new Set([muted]),
        eventIds: new Set(),
        hashtags: new Set(),
        words: new Set()
      })
    ).toEqual([followed]);
  });

  it('puts the signed-in viewer first so own notes are not left to the global flood', () => {
    const viewer = 'a'.repeat(64);
    const followed = 'd'.repeat(64);
    setSelectorContext({
      signedIn: true,
      viewerPubkey: viewer,
      inbox: [],
      outbox: [],
      favorites: [],
      local: [],
      blocked: []
    });
    const contact = ev({
      kind: KIND.CONTACT_LIST,
      tags: [['p', followed], ['p', viewer]]
    });
    expect(
      feedFollowAuthors([contact], {
        pubkeys: new Set(),
        eventIds: new Set(),
        hashtags: new Set(),
        words: new Set()
      })
    ).toEqual([viewer, followed]);
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

describe('collectNewFeedEvents', () => {
  it('keeps only unseen events newer than the watermark', () => {
    const shown = [ev({ id: '1'.repeat(64), kind: KIND.TEXT_NOTE, created_at: 100 })];
    const pending = collectNewFeedEvents(
      [
        ev({ id: '1'.repeat(64), kind: KIND.TEXT_NOTE, created_at: 100 }),
        ev({ id: '2'.repeat(64), kind: KIND.TEXT_NOTE, created_at: 90 }),
        ev({ id: '3'.repeat(64), kind: KIND.TEXT_NOTE, created_at: 120 })
      ],
      { shown, pending: [], watermark: 100 }
    );
    expect(pending.map((e) => e.id)).toEqual(['3'.repeat(64)]);
    expect(feedEventsWatermark(shown)).toBe(100);
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

describe('feed thread query paths', () => {
  it('keeps threads on /feed via ?thread=nevent1 so the list route does not remount', () => {
    const note = ev({ id: '1'.repeat(64), kind: KIND.TEXT_NOTE, pubkey: 'a'.repeat(64) });
    const nevent = nip19.neventEncode({
      id: note.id,
      author: note.pubkey,
      kind: note.kind
    });
    // Default tab omitted so thread bookmarks stay canonical (`parseFeedTab` → original).
    expect(feedThreadPath(note)).toBe(`/feed?thread=${nevent}`);
    expect(feedThreadPath(note, 'replies')).toBe(`/feed?thread=${nevent}&tab=replies`);
    expect(feedListPath('replies')).toBe('/feed?tab=replies');
    // List paths still always write tab= (bare /feed ≠ original).
    expect(feedListPath('original')).toBe('/feed?tab=original');
    expect(parseFeedThreadParam(`thread=${nevent}`)).toBe(note.id);
    expect(parseFeedThreadParam(`thread=${note.id}&tab=replies`)).toBe(note.id);
    // Legacy note1 bookmarks still resolve.
    expect(parseFeedThreadParam(`thread=${nip19.noteEncode(note.id)}`)).toBe(note.id);
    expect(parseFeedThreadParam('tab=replies')).toBeNull();
  });

  it('uses naddr1 for parameterized replaceables such as live events', () => {
    const live = ev({
      id: '2'.repeat(64),
      kind: KIND.LIVE_EVENT,
      pubkey: 'b'.repeat(64),
      tags: [['d', 'room-1']]
    });
    const naddr = nip19.naddrEncode({
      kind: live.kind,
      pubkey: live.pubkey,
      identifier: 'room-1'
    });
    expect(feedThreadPath(live)).toBe(`/feed?thread=${naddr}`);
    expect(parseFeedThreadParam(`thread=${naddr}`)).toBe(
      `${live.kind}:${live.pubkey}:room-1`
    );
  });

  it('opens a kind 1 reply at the NIP-10 root with comment focus', () => {
    const rootId = '3'.repeat(64);
    const reply = ev({
      id: '4'.repeat(64),
      kind: KIND.TEXT_NOTE,
      pubkey: 'a'.repeat(64),
      tags: [
        ['e', rootId, '', 'root'],
        ['e', '5'.repeat(64), '', 'reply']
      ]
    });
    const rootNevent = nip19.neventEncode({ id: rootId });
    expect(feedThreadRootPointer(reply)).toBe(rootNevent);
    expect(feedThreadPath(reply, 'replies')).toBe(
      `/feed?thread=${rootNevent}&comment=${reply.id}&tab=replies`
    );
  });

  it('opens a kind 1111 comment at the NIP-22 E root with comment focus', () => {
    const rootId = '6'.repeat(64);
    const comment = ev({
      id: '7'.repeat(64),
      kind: KIND.COMMENT,
      pubkey: 'a'.repeat(64),
      tags: [
        ['E', rootId],
        ['e', '8'.repeat(64)]
      ]
    });
    const rootNevent = nip19.neventEncode({ id: rootId });
    expect(feedThreadPath(comment, 'replies')).toBe(
      `/feed?thread=${rootNevent}&comment=${comment.id}&tab=replies`
    );
  });

  it('opens a reaction or zap at the target event thread, not itself', () => {
    const noteId = '9'.repeat(64);
    const noteNevent = nip19.neventEncode({ id: noteId });
    const reaction = ev({
      id: 'a1'.repeat(32),
      kind: KIND.REACTION,
      content: '+',
      tags: [
        ['e', noteId],
        ['p', 'b'.repeat(64)]
      ]
    });
    const zap = ev({
      id: 'a2'.repeat(32),
      kind: KIND.ZAP,
      content: '',
      tags: [
        ['e', noteId],
        ['p', 'b'.repeat(64)]
      ]
    });
    expect(isFeedInteractionEvent(reaction)).toBe(true);
    expect(isFeedInteractionEvent(zap)).toBe(true);
    expect(feedInteractionTargetPointer(reaction)).toBe(noteNevent);
    expect(feedThreadPath(reaction, 'notifications')).toBe(
      `/feed?thread=${noteNevent}&tab=notifications`
    );
    expect(feedThreadPath(zap, 'notifications')).toBe(
      `/feed?thread=${noteNevent}&tab=notifications`
    );
    expect(feedThreadPath(reaction)).not.toContain(reaction.id);
  });

  it('opens a reaction on a reply at the NIP-10 root with comment focus when warm', () => {
    const rootId = 'b1'.repeat(32);
    const replyId = 'b2'.repeat(32);
    const reply = ev({
      id: replyId,
      kind: KIND.TEXT_NOTE,
      pubkey: 'a'.repeat(64),
      tags: [
        ['e', rootId, '', 'root'],
        ['e', rootId, '', 'reply']
      ]
    });
    rememberEvents([reply]);
    const reaction = ev({
      id: 'b3'.repeat(32),
      kind: KIND.REACTION,
      content: '+',
      tags: [['e', replyId]]
    });
    const rootNevent = nip19.neventEncode({ id: rootId });
    expect(feedThreadPath(reaction, 'notifications')).toBe(
      `/feed?thread=${rootNevent}&comment=${replyId}&tab=notifications`
    );
  });

  it('does not recurse forever when a reaction targets another reaction', () => {
    const noteId = 'c1'.repeat(32);
    const inner = ev({
      id: 'c2'.repeat(32),
      kind: KIND.REACTION,
      content: '+',
      tags: [['e', noteId]]
    });
    rememberEvents([inner]);
    const outer = ev({
      id: 'c3'.repeat(32),
      kind: KIND.REACTION,
      content: '+',
      tags: [['e', inner.id]]
    });
    const innerNevent = nip19.neventEncode({ id: inner.id });
    expect(feedThreadPath(outer)).toBe(`/feed?thread=${innerNevent}`);
  });
});
