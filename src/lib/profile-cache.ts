/**
 * Name and picture for badges, derived from the kind 0 in the replaceable map.
 * Memory only — the event itself is the stored copy.
 */

import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import { toNostrBuildThumbUrl } from './nostr-build';
import { cachedIdentityEvent, rememberIdentityEvent } from './nostr/identity-cache';
import { firstTag } from './nostr/verify';
import { populateImageCache } from './image-cache';

export type ProfileThumb = { name: string; picture: string };

const LEGACY_THUMBS_KEY = 'alexandria-profile-thumbs';
const MAX_MEMORY = 400;

const memory = new Map<string, ProfileThumb>();

function touchMemory(pk: string, thumb: ProfileThumb): void {
  if (memory.has(pk)) memory.delete(pk);
  memory.set(pk, thumb);
  while (memory.size > MAX_MEMORY) {
    const oldest = memory.keys().next().value;
    if (oldest == null) break;
    memory.delete(oldest);
  }
}

function kind0Value(event: Event, tagName: string, jsonKeys: string[]): string {
  const tagged = firstTag(event, tagName)?.trim();
  if (tagged) return tagged;
  try {
    const data = JSON.parse(event.content) as Record<string, unknown>;
    for (const key of jsonKeys) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    /* ignore */
  }
  return '';
}

function fallbackName(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey).slice(0, 12) + '…';
  } catch {
    return pubkey.slice(0, 12) + '…';
  }
}

export function profileThumbFromKind0(meta: Event): ProfileThumb {
  const pk = meta.pubkey.toLowerCase();
  const name =
    kind0Value(meta, 'display_name', ['display_name']) ||
    kind0Value(meta, 'name', ['name', 'display_name']) ||
    fallbackName(pk);
  const picture = toNostrBuildThumbUrl(kind0Value(meta, 'picture', ['picture']));
  return { name, picture };
}

function legacyThumb(pk: string): ProfileThumb | null {
  try {
    const raw = localStorage.getItem(LEGACY_THUMBS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, ProfileThumb>;
    const fromLs = parsed?.[pk];
    if (!fromLs || typeof fromLs.name !== 'string') return null;
    return {
      name: fromLs.name,
      picture: typeof fromLs.picture === 'string' ? toNostrBuildThumbUrl(fromLs.picture) : ''
    };
  } catch {
    return null;
  }
}

function paintThumb(pk: string, thumb: ProfileThumb): ProfileThumb {
  const next: ProfileThumb = {
    name: thumb.name || fallbackName(pk),
    picture: thumb.picture ? toNostrBuildThumbUrl(thumb.picture) : ''
  };
  touchMemory(pk, next);
  if (next.picture) void populateImageCache(next.picture);
  return next;
}

/** Sync peek — memory, then the stored kind 0, then a name left by an older build. */
export function peekProfileThumb(pubkey: string): ProfileThumb | null {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return null;
  const mem = memory.get(pk);
  if (mem) {
    touchMemory(pk, mem);
    return mem;
  }
  const meta = cachedIdentityEvent(KIND.METADATA, pk);
  if (meta) return paintThumb(pk, profileThumbFromKind0(meta));
  const legacy = legacyThumb(pk);
  if (legacy) return paintThumb(pk, legacy);
  return null;
}

export function rememberProfileFromKind0(meta: Event): ProfileThumb {
  rememberIdentityEvent(meta);
  const pk = meta.pubkey.toLowerCase();
  return paintThumb(pk, profileThumbFromKind0(meta));
}
