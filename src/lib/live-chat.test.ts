import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { emptyWorkResponses } from './comments';
import {
  collectLiveChatRows,
  collectLivePresence,
  LIVE_PRESENCE_WINDOW_SEC,
  localRoomPresence,
  roomPresenceDraft
} from './live-chat';
import { assertReadyToSign } from './kind-compose';

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
