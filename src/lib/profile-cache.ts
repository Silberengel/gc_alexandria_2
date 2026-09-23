/**
 * Fast pubkey → name/picture for badges. Survives remount/refresh via memory + localStorage
 * so avatars do not wait on kind-0 relays every time.
 */

import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { toNostrBuildThumbUrl } from './nostr-build';
import { firstTag } from './nostr/verify';
import { populateImageCache } from './image-cache';

export type ProfileThumb = { name: string; picture: string };

const LS_KEY = 'alexandria-profile-thumbs';
const MAX_LS = 200;

const memory = new Map<string, ProfileThumb>();

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

function readLs(): Record<string, ProfileThumb> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, ProfileThumb>;
  } catch {
    return {};
  }
}

function writeLs(all: Record<string, ProfileThumb>): void {
  try {
    const entries = Object.entries(all);
    const trimmed =
      entries.length > MAX_LS ? Object.fromEntries(entries.slice(-MAX_LS)) : all;
    localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota / private */
  }
}

/** Sync peek — memory, then localStorage. */
export function peekProfileThumb(pubkey: string): ProfileThumb | null {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return null;
  const mem = memory.get(pk);
  if (mem) return mem;
  const fromLs = readLs()[pk];
  if (fromLs && typeof fromLs.name === 'string') {
    const thumb: ProfileThumb = {
      name: fromLs.name,
      picture: typeof fromLs.picture === 'string' ? toNostrBuildThumbUrl(fromLs.picture) : ''
    };
    memory.set(pk, thumb);
    return thumb;
  }
  return null;
}

export function rememberProfileThumb(pubkey: string, thumb: ProfileThumb): void {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return;
  const next: ProfileThumb = {
    name: thumb.name || fallbackName(pk),
    picture: thumb.picture ? toNostrBuildThumbUrl(thumb.picture) : ''
  };
  memory.set(pk, next);
  const all = readLs();
  all[pk] = next;
  writeLs(all);
  if (next.picture) void populateImageCache(next.picture);
}

export function rememberProfileFromKind0(meta: Event): ProfileThumb {
  const thumb = profileThumbFromKind0(meta);
  rememberProfileThumb(meta.pubkey, thumb);
  return thumb;
}
