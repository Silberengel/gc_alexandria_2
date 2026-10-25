import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { fieldSpecs, suiteKinds } from '@silberengel/kind-compose-catalog';
import {
  NIP53_KIND,
  NIP53_STALE_LIVE_SEC,
  NIP53_SUITE,
  effectiveActivityStatus,
  firstFieldValue,
  isNip53Kind,
  liveChatActivityAddress,
  liveStreamPlaybackUrl,
  nip53FieldOptions,
  nip53SuiteKinds,
  nip53TagName,
  parseLiveStream,
  parseMeetingRoom,
  parseMeetingSpace,
  parseRoomPresence,
  parseSpaceStatus
} from './nip53';

function ev(partial: Partial<Event> & Pick<Event, 'tags' | 'kind'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    content: '',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('nip53 catalog wiring', () => {
  it('exposes the five NIP-53 kinds from the catalog suite', () => {
    expect(nip53SuiteKinds().sort((a, b) => a - b)).toEqual(
      [...suiteKinds(NIP53_SUITE)].sort((a, b) => a - b)
    );
    expect(nip53SuiteKinds()).toEqual(
      expect.arrayContaining([
        NIP53_KIND.LIVE_CHAT,
        NIP53_KIND.ROOM_PRESENCE,
        NIP53_KIND.LIVE_EVENT,
        NIP53_KIND.MEETING_SPACE,
        NIP53_KIND.MEETING_ROOM
      ])
    );
    for (const kind of Object.values(NIP53_KIND)) {
      expect(isNip53Kind(kind)).toBe(true);
    }
  });

  it('reads tag names and status options from catalog fields', () => {
    expect(nip53TagName(NIP53_KIND.LIVE_EVENT, 'streaming')).toBe('streaming');
    expect(nip53TagName(NIP53_KIND.MEETING_SPACE, 'room')).toBe('room');
    expect(nip53FieldOptions(NIP53_KIND.LIVE_EVENT, 'status')).toEqual([
      'planned',
      'live',
      'ended'
    ]);
    expect(nip53FieldOptions(NIP53_KIND.MEETING_SPACE, 'status')).toEqual([
      'open',
      'private',
      'closed'
    ]);
    expect(fieldSpecs(NIP53_KIND.LIVE_EVENT).some((f) => f.id === 'pinned')).toBe(true);
  });
});

describe('parseLiveStream', () => {
  it('parses catalog fields including proof, pinned, and relays', () => {
    const host = 'f'.repeat(64);
    const guest = 'e'.repeat(64);
    const pinned = 'd'.repeat(64);
    const info = parseLiveStream(
      ev({
        kind: NIP53_KIND.LIVE_EVENT,
        content: 'Lamang Island raid',
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', '92f789a1-f387-439a-b18f-f247b7baf9e6'],
          ['title', 'Grayzone Lamang'],
          ['summary', 'Hitting Lamang Island with the boys'],
          ['status', 'live'],
          ['starts', '1700000000'],
          ['streaming', 'https://stream.example/live.m3u8'],
          ['image', 'https://cdn.example/cover.jpg'],
          ['current_participants', '42'],
          ['total_participants', '100'],
          ['pinned', pinned],
          ['relays', 'wss://one.example', 'wss://two.example'],
          ['t', 'gaming'],
          ['p', guest, '', 'Speaker'],
          ['p', host, 'wss://relay.example', 'Host', 'ab'.repeat(32)]
        ]
      })
    );
    expect(info.title).toBe('Grayzone Lamang');
    expect(info.status).toBe('live');
    expect(info.streamingUrl).toBe('https://stream.example/live.m3u8');
    expect(info.viewersLabel).toBe('42 watching · 100 total');
    expect(info.pinnedIds).toEqual([pinned]);
    expect(info.relays).toEqual(['wss://one.example', 'wss://two.example']);
    expect(info.hosts[0]?.pubkey).toBe(host);
    expect(info.hosts[0]?.agreed).toBe(true);
    expect(info.participants.find((p) => p.pubkey === guest)?.agreed).toBe(false);
    expect(liveStreamPlaybackUrl(info)).toBe('https://stream.example/live.m3u8');
  });

  it('coerces stale live status to ended after 1h without update', () => {
    const now = 1_700_010_000;
    const event = ev({
      kind: NIP53_KIND.LIVE_EVENT,
      created_at: now - NIP53_STALE_LIVE_SEC - 1,
      tags: [
        ['d', 'old'],
        ['title', 'Stale'],
        ['status', 'live']
      ]
    });
    const { status, stale } = effectiveActivityStatus(event, 'live', now);
    expect(status).toBe('ended');
    expect(stale).toBe(true);
    expect(parseLiveStream(event, now).status).toBe('ended');
    expect(parseLiveStream(event, now).stale).toBe(true);
  });

  it('prefers http HLS over moq:// streaming tags', () => {
    const hls =
      'https://streamstr.net/92f789a1-f387-439a-b18f-f247b7baf9e6/hls/live.m3u8';
    const info = parseLiveStream(
      ev({
        kind: NIP53_KIND.LIVE_EVENT,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'x'],
          ['status', 'live'],
          ['title', 'Pha Lang'],
          ['thumb', 'https://streamstr.net/thumb.webp'],
          ['streaming', hls],
          ['streaming', 'moq://streamstr.net:1443/']
        ]
      })
    );
    expect(info.streamingUrl).toBe(hls);
    expect(info.imageUrl).toBe('https://streamstr.net/thumb.webp');
  });
});

describe('meeting space / room / presence', () => {
  it('parses kind 30312 space fields from the catalog', () => {
    const host = 'f'.repeat(64);
    const info = parseMeetingSpace(
      ev({
        kind: NIP53_KIND.MEETING_SPACE,
        tags: [
          ['d', 'main-conference-room'],
          ['room', 'Main Conference Hall'],
          ['summary', 'Our primary conference space'],
          ['status', 'open'],
          ['service', 'https://meet.example.com/room'],
          ['endpoint', 'https://api.example.com/room'],
          ['p', host, 'wss://nostr.example.com/', 'Host']
        ]
      })
    );
    expect(info.room).toBe('Main Conference Hall');
    expect(info.status).toBe('open');
    expect(info.serviceUrl).toBe('https://meet.example.com/room');
    expect(info.providers[0]?.role).toBe('Host');
    expect(parseSpaceStatus('PRIVATE')).toBe('private');
  });

  it('parses kind 30313 meeting and presence', () => {
    const space =
      '30312:f7234bd4c1394dda46d09f35bd384dd30cc552ad5541990f98844fb06676e9ca:main-conference-room';
    const meeting = parseMeetingRoom(
      ev({
        kind: NIP53_KIND.MEETING_ROOM,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'annual-meeting-2025'],
          ['a', space, 'wss://nostr.example.com'],
          ['title', 'Annual Company Meeting 2025'],
          ['starts', '1676262123'],
          ['status', 'live'],
          ['current_participants', '175']
        ]
      })
    );
    expect(meeting.title).toBe('Annual Company Meeting 2025');
    expect(meeting.spaceAddress).toBe(space);
    expect(meeting.status).toBe('live');
    expect(meeting.viewersLabel).toBe('175 watching');

    const presence = parseRoomPresence(
      ev({
        kind: NIP53_KIND.ROOM_PRESENCE,
        tags: [
          ['a', space, 'wss://nostr.example.com', 'root'],
          ['hand', '1']
        ]
      })
    );
    expect(presence.spaceAddress).toBe(space);
    expect(presence.handRaised).toBe(true);
  });

  it('reads live chat activity address via catalog kind', () => {
    const addr = `30311:${'a'.repeat(64)}:demo`;
    expect(
      liveChatActivityAddress(
        ev({
          kind: NIP53_KIND.LIVE_CHAT,
          content: 'hi',
          tags: [['a', addr, '', 'root']]
        })
      )
    ).toBe(addr);
    expect(firstFieldValue(ev({ kind: NIP53_KIND.LIVE_CHAT, tags: [['a', addr]] }), 'activity')).toBe(
      addr
    );
  });
});
