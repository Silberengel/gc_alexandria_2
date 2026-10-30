import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  PROFILE_MEDIA_KINDS,
  isProfileMediaSegment,
  profileMediaPath,
  profileMediaTiles
} from './profile-media';

const pk = 'b'.repeat(64);

function ev(over: Partial<Event> & { tags?: string[][] }): Event {
  return {
    id: (over.id ?? 'a'.repeat(64)).toLowerCase(),
    pubkey: (over.pubkey ?? pk).toLowerCase(),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? KIND.PICTURE,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('profile media path', () => {
  it('accepts the media segment and keeps a NIP-05 id', () => {
    expect(isProfileMediaSegment('media')).toBe(true);
    expect(isProfileMediaSegment('Media')).toBe(true);
    expect(isProfileMediaSegment('bookmarks')).toBe(false);
    expect(isProfileMediaSegment('20')).toBe(false);
    expect(profileMediaPath('roland@pareto.space')).toBe('/p/roland@pareto.space/media');
  });

  it('lists the dedicated media kinds', () => {
    expect(PROFILE_MEDIA_KINDS).toEqual([
      KIND.PICTURE,
      KIND.VIDEO,
      KIND.SHORT_VIDEO,
      KIND.VOICE,
      KIND.MUSIC
    ]);
  });
});

describe('profileMediaTiles', () => {
  it('flattens imeta and content URLs newest-first and dedupes the same file', () => {
    const older = ev({
      id: '1'.repeat(64),
      created_at: 10,
      kind: KIND.PICTURE,
      tags: [['imeta', 'url https://cdn.example/a.jpg', 'dim 800x1200', 'alt Tall shot']]
    });
    const newer = ev({
      id: '2'.repeat(64),
      created_at: 20,
      kind: KIND.VIDEO,
      tags: [
        [
          'imeta',
          'url https://cdn.example/clip.mp4',
          'm video/mp4',
          'image https://cdn.example/clip.jpg'
        ]
      ]
    });
    const dup = ev({
      id: '3'.repeat(64),
      created_at: 30,
      kind: KIND.PICTURE,
      content: 'https://cdn.example/a.jpg?w=400'
    });
    const note = ev({
      id: '4'.repeat(64),
      created_at: 40,
      kind: KIND.TEXT_NOTE,
      content: 'https://cdn.example/skip.jpg'
    });

    const tiles = profileMediaTiles([older, newer, dup, note]);
    // Newest wins for a duplicate file; query variants collapse via mediaMatchKeys.
    expect(tiles.map((t) => t.url)).toEqual([
      'https://cdn.example/a.jpg?w=400',
      'https://cdn.example/clip.mp4'
    ]);
    expect(tiles[0]).toMatchObject({ type: 'image', kind: KIND.PICTURE });
    expect(tiles[1]).toMatchObject({
      type: 'video',
      poster: 'https://cdn.example/clip.jpg',
      kind: KIND.VIDEO
    });
  });

  it('caps the gallery length', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      ev({
        id: i.toString(16).padStart(64, '0'),
        created_at: i + 1,
        kind: KIND.PICTURE,
        content: `https://cdn.example/pic-${i}.png`
      })
    );
    expect(profileMediaTiles(events, 3)).toHaveLength(3);
  });
});
