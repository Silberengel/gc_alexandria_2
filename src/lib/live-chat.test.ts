import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { emptyWorkResponses } from './comments';
import {
  collectLiveChatRows,
  collectLivePresence,
  filterLiveChatForShield,
  LIVE_PRESENCE_WINDOW_SEC,
  liveChatShieldText,
  localRoomPresence,
  roomPresenceDraft
} from './live-chat';
import { assertReadyToSign } from './kind-compose';
import type { MuteState } from './mute';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey' | 'tags'>): Event {
  return {
    id: (partial.id ?? partial.pubkey.slice(0, 32) + 'a'.repeat(32)).slice(0, 64),
    created_at: partial.created_at ?? 1_700_000_000,
    content: '',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('collectLivePresence', () => {
  it('dedupes by pubkey and drops stale presence', () => {
    const host = 'f'.repeat(64);
    const a = '1'.repeat(64);
    const b = '2'.repeat(64);
    const activity = ev({
      kind: KIND.LIVE_EVENT,
      pubkey: host,
      id: '9'.repeat(64),
      tags: [['d', 'room-1']]
    });
    const addr = `30311:${host}:room-1`;
    const now = 1_700_100_000;
    const responses = emptyWorkResponses();
    responses.other = [
      ev({
        kind: KIND.ROOM_PRESENCE,
        pubkey: a,
        created_at: now - 10,
        tags: [['a', addr, '', 'root']]
      }),
      ev({
        kind: KIND.ROOM_PRESENCE,
        pubkey: a,
        created_at: now - 5,
        tags: [
          ['a', addr, '', 'root'],
          ['hand', '1']
        ]
      }),
      ev({
        kind: KIND.ROOM_PRESENCE,
        pubkey: b,
        created_at: now - LIVE_PRESENCE_WINDOW_SEC - 10,
        tags: [['a', addr, '', 'root']]
      })
    ];
    const people = collectLivePresence(activity, responses, now);
    expect(people.map((p) => p.pubkey)).toEqual([a]);
    expect(people[0]?.handRaised).toBe(true);
  });

  it('lists live chat newest first by created_at', () => {
    const host = 'f'.repeat(64);
    const activity = ev({
      kind: KIND.LIVE_EVENT,
      pubkey: host,
      id: '9'.repeat(64),
      tags: [['d', 'room-1']]
    });
    const addr = `30311:${host}:room-1`;
    const older = ev({
      id: 'a'.repeat(64),
      kind: KIND.LIVE_CHAT,
      pubkey: '1'.repeat(64),
      created_at: 100,
      content: 'first',
      tags: [['a', addr, '', 'root']]
    });
    const newer = ev({
      id: 'b'.repeat(64),
      kind: KIND.LIVE_CHAT,
      pubkey: '2'.repeat(64),
      created_at: 200,
      content: 'second',
      tags: [['a', addr, '', 'root']]
    });
    const responses = emptyWorkResponses();
    responses.thread = [older, newer];
    const rows = collectLiveChatRows(activity, responses).filter((r) => r.type === 'message');
    expect(rows.map((r) => r.event.content)).toEqual(['second', 'first']);
  });

  it('drafts kind 10312 presence rooted on the live activity', () => {
    const host = 'f'.repeat(64);
    const activity = ev({
      kind: KIND.LIVE_EVENT,
      pubkey: host,
      id: '9'.repeat(64),
      tags: [['d', 'room-1'], ['relays', 'wss://relay.example']]
    });
    const draft = roomPresenceDraft(activity, { relayHint: 'wss://relay.example' });
    expect(draft.kind).toBe(KIND.ROOM_PRESENCE);
    expect(draft.content).toBe('');
    expect(draft.tags[0]).toEqual(['a', `30311:${host}:room-1`, 'wss://relay.example', 'root']);
    expect(assertReadyToSign(draft).ok).toBe(true);
    expect(roomPresenceDraft(activity, { handRaised: true }).tags).toContainEqual(['hand', '1']);
  });

  it('optimistic local presence counts in the room strip', () => {
    const host = 'f'.repeat(64);
    const viewer = 'd'.repeat(64);
    const activity = ev({
      kind: KIND.LIVE_EVENT,
      pubkey: host,
      id: '9'.repeat(64),
      tags: [['d', 'room-1']]
    });
    const local = localRoomPresence(activity, viewer);
    const responses = emptyWorkResponses();
    responses.other = [local];
    const people = collectLivePresence(activity, responses);
    expect(people.map((p) => p.pubkey)).toEqual([viewer]);
  });
});

describe('live chat shield filters', () => {
  it('keeps muted authors when shield filtering is not applied by the caller', () => {
    const mutedPk = '1'.repeat(64);
    const ok = ev({
      kind: KIND.LIVE_CHAT,
      pubkey: '2'.repeat(64),
      id: 'a'.repeat(64),
      content: 'hi',
      tags: [['a', '30311:f'.padEnd(70, '0') + ':r', '', 'root']]
    });
    const muted = ev({
      kind: KIND.LIVE_CHAT,
      pubkey: mutedPk,
      id: 'b'.repeat(64),
      content: 'spam',
      tags: [['a', '30311:f'.padEnd(70, '0') + ':r', '', 'root']]
    });
    // Open mode: callers pass the raw list — both stay.
    expect([ok, muted].map((e) => e.pubkey)).toEqual([ok.pubkey, muted.pubkey]);
  });

  it('drops muted authors when shield filtering runs', () => {
    const mutedPk = '1'.repeat(64);
    const ok = ev({
      kind: KIND.LIVE_CHAT,
      pubkey: '2'.repeat(64),
      id: 'a'.repeat(64),
      content: 'hi',
      tags: []
    });
    const mutedEv = ev({
      kind: KIND.LIVE_CHAT,
      pubkey: mutedPk,
      id: 'b'.repeat(64),
      content: 'spam',
      tags: []
    });
    const muted: MuteState = { pubkeys: new Set([mutedPk]), eventIds: new Set() };
    expect(filterLiveChatForShield([ok, mutedEv], muted, null).map((e) => e.id)).toEqual([ok.id]);
  });

  it('marks media-only chat lines for shield collapse', () => {
    const url = 'https://cdn.example/pic.jpg';
    const mediaOnly = ev({
      kind: KIND.LIVE_CHAT,
      pubkey: '1'.repeat(64),
      id: 'c'.repeat(64),
      content: url,
      tags: [['imeta', `url ${url}`, 'm image/jpeg']]
    });
    expect(liveChatShieldText(mediaOnly)).toEqual({ mediaOnly: true, text: '' });
    const mixed = ev({
      kind: KIND.LIVE_CHAT,
      pubkey: '1'.repeat(64),
      id: 'd'.repeat(64),
      content: `hello\n${url}`,
      tags: [['imeta', `url ${url}`, 'm image/jpeg']]
    });
    expect(liveChatShieldText(mixed).mediaOnly).toBe(false);
    expect(liveChatShieldText(mixed).text).toContain('hello');
  });
});
