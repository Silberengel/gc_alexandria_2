import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { emptyWorkResponses } from './comments';
import { collectLivePresence, LIVE_PRESENCE_WINDOW_SEC } from './live-chat';

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
});
