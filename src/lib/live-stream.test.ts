import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  isDirectPlayableMediaUrl,
  liveStreamPlaybackUrl,
  parseLiveStream,
  parseLiveStreamStatus
} from './live-stream';

function ev(partial: Partial<Event> & Pick<Event, 'tags'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: 30311,
    content: '',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('parseLiveStreamStatus', () => {
  it('maps NIP-53 status tags', () => {
    expect(parseLiveStreamStatus('live')).toBe('live');
    expect(parseLiveStreamStatus('PLANNED')).toBe('planned');
    expect(parseLiveStreamStatus('ended')).toBe('ended');
    expect(parseLiveStreamStatus('')).toBe('unknown');
  });
});

describe('parseLiveStream', () => {
  it('reads title, status, stream URLs, hosts, and viewers', () => {
    const host = 'f'.repeat(64);
    const guest = 'e'.repeat(64);
    const info = parseLiveStream(
      ev({
        content: 'Lamang Island raid',
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
          ['t', 'gaming'],
          ['t', 'streaming'],
          ['p', guest, '', 'speaker'],
          ['p', host, '', 'host']
        ]
      })
    );
    expect(info.title).toBe('Grayzone Lamang');
    expect(info.summary).toBe('Hitting Lamang Island with the boys');
    expect(info.status).toBe('live');
    expect(info.statusLabel).toBe('Live');
    expect(info.whenLabel).toMatch(/^Started /);
    expect(info.viewersLabel).toBe('42 watching · 100 total');
    expect(info.streamingUrl).toBe('https://stream.example/live.m3u8');
    expect(info.imageUrl).toBe('https://cdn.example/cover.jpg');
    expect(info.tags).toEqual(['gaming', 'streaming']);
    expect(info.hosts.map((h) => h.pubkey)).toEqual([host, guest]);
    expect(info.hosts[0]?.role).toBe('host');
    expect(liveStreamPlaybackUrl(info)).toBe('https://stream.example/live.m3u8');
  });

  it('falls back to content for summary and prefers recording when no stream', () => {
    const info = parseLiveStream(
      ev({
        content: 'Replay of last night',
        tags: [
          ['title', 'Archive'],
          ['status', 'ended'],
          ['recording', 'https://cdn.example/vod.mp4']
        ]
      })
    );
    expect(info.summary).toBe('Replay of last night');
    expect(info.statusLabel).toBe('Ended');
    expect(liveStreamPlaybackUrl(info)).toBe('https://cdn.example/vod.mp4');
    expect(isDirectPlayableMediaUrl(info.recordingUrl!)).toBe(true);
  });

  it('prefers http HLS over moq:// streaming tags and falls back to thumb', () => {
    const hls =
      'https://streamstr.net/92f789a1-f387-439a-b18f-f247b7baf9e6/hls/live.m3u8';
    const info = parseLiveStream(
      ev({
        tags: [
          ['d', '92f789a1-f387-439a-b18f-f247b7baf9e6'],
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
    expect(liveStreamPlaybackUrl(info)).toBe(hls);
  });
});
