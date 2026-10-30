/**
 * Profile media gallery: authored picture / video / voice / music events.
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { isAllowedMediaUrl } from './markup';
import { mediaMatchKeys, uniqueMedia, type MediaItem } from './media';

export const PROFILE_MEDIA_SEGMENT = 'media';

/** Max tiles painted in the profile gallery. */
export const PROFILE_MEDIA_TILE_LIMIT = 96;

/** Dedicated media event kinds shown on `/p/:id/media`. */
export const PROFILE_MEDIA_KINDS: readonly number[] = [
  KIND.PICTURE,
  KIND.VIDEO,
  KIND.SHORT_VIDEO,
  KIND.VOICE,
  KIND.MUSIC
];

const PROFILE_MEDIA_KIND_SET = new Set<number>(PROFILE_MEDIA_KINDS);

export type ProfileMediaTile = {
  key: string;
  eventId: string;
  kind: number;
  createdAt: number;
  url: string;
  type: MediaItem['type'];
  alt?: string;
  poster?: string;
  width?: number;
  height?: number;
  /** CSS masonry weight — larger values read taller in the column layout. */
  weight: 1 | 2 | 3;
};

export function isProfileMediaSegment(raw: string | undefined | null): boolean {
  return (raw ?? '').trim().toLowerCase() === PROFILE_MEDIA_SEGMENT;
}

/** `/p/:id/media` — same id segment as other profile links (npub or NIP-05). */
export function profileMediaPath(id: string): string {
  return `/p/${id.trim()}/media`;
}

/**
 * Flatten authored media events into gallery tiles, newest first.
 * Duplicate files (same blossom hash / path) collapse across events.
 */
export function profileMediaTiles(
  events: Event[],
  limit = PROFILE_MEDIA_TILE_LIMIT
): ProfileMediaTile[] {
  const sorted = events
    .filter((event) => PROFILE_MEDIA_KIND_SET.has(event.kind))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));

  const out: ProfileMediaTile[] = [];
  const seen = new Set<string>();
  for (const event of sorted) {
    for (const item of uniqueMedia(event)) {
      if (!isAllowedMediaUrl(item.url)) continue;
      const keys = mediaMatchKeys(item.url);
      const matchKey =
        keys.find((key) => key.startsWith('sha256:')) ??
        keys.find((key) => !key.includes('?')) ??
        keys[0] ??
        item.url.toLowerCase();
      if (keys.length ? keys.some((key) => seen.has(key)) : seen.has(matchKey)) continue;
      if (keys.length) for (const key of keys) seen.add(key);
      else seen.add(matchKey);
      out.push({
        key: `${event.id}:${matchKey}`,
        eventId: event.id,
        kind: event.kind,
        createdAt: event.created_at,
        url: item.url,
        type: item.type,
        alt: item.alt?.trim() || undefined,
        poster: item.poster,
        width: item.width,
        height: item.height,
        weight: tileWeight(item, matchKey)
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Stable 1–3 weight so column masonry looks irregular without layout thrash. */
function tileWeight(item: MediaItem, matchKey: string): 1 | 2 | 3 {
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    const ratio = item.height / item.width;
    if (ratio >= 1.35) return 3;
    if (ratio >= 0.95) return 2;
    return 1;
  }
  let h = 0;
  for (let i = 0; i < matchKey.length; i++) h = (h * 31 + matchKey.charCodeAt(i)) >>> 0;
  const bucket = h % 5;
  if (bucket === 0) return 3;
  if (bucket <= 2) return 2;
  return 1;
}
