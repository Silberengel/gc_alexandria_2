import { afterEach, describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  collectNewFeedEvents,
  feedEventsWatermark,
  feedFollowAuthors,
  feedAuthorRepliesPath,
  feedListPath,
  feedRelayGroups,
  feedInteractionTargetPointer,
  feedThreadPath,
  feedThreadRootPointer,
  isFeedInteractionEvent,
  isFeedReplyRow,
  isNotificationForViewer,
  isFeedRepost,
  isOriginalPost,
  isRepliesTimelineEvent,
  isTopLevelWebComment,
  keepFeedPosts,
  parseFeedAuthorParam,
  parseFeedTab,
  parseFeedThreadParam
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
  it('defaults to original and accepts follows/replies/notifications/kind tabs', () => {
    expect(parseFeedTab(null)).toBe('original');
    expect(parseFeedTab('follows')).toBe('follows');
    expect(parseFeedTab('replies')).toBe('replies');
    expect(parseFeedTab('notifications')).toBe('notifications');
    expect(parseFeedTab('kind:1')).toBe('kind:1');
    expect(parseFeedTab('kind:30023')).toBe('kind:30023');
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
