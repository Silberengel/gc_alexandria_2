import type { Event } from 'nostr-tools';
import { CACHE_KINDS } from '../constants';
import { ingestEvent } from './verify';

const CACHE_NAME = 'alexandria-events-v1';
const META_KEY = 'alexandria-cache-meta';

type CacheMeta = {
  ids: string[];
  bytes: number;
};

function meta(): CacheMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return JSON.parse(raw) as CacheMeta;
  } catch {
    /* ignore */
  }
  return { ids: [], bytes: 0 };
}

function saveMeta(m: CacheMeta): void {
  localStorage.setItem(META_KEY, JSON.stringify(m));
}

async function openCache(): Promise<Cache> {
  return caches.open(CACHE_NAME);
}

export async function cacheGetEvent(id: string): Promise<Event | null> {
  const cache = await openCache();
  const res = await cache.match(`/event/${id.toLowerCase()}`);
  if (!res) return null;
  try {
    return ingestEvent(await res.json());
  } catch {
    return null;
  }
}

export async function cachePutEvent(event: Event): Promise<void> {
  if (!CACHE_KINDS.includes(event.kind as (typeof CACHE_KINDS)[number])) return;
  const verified = ingestEvent(event);
  if (!verified) return;
  const cache = await openCache();
  const body = JSON.stringify(verified);
  await cache.put(
    `/event/${verified.id}`,
    new Response(body, { headers: { 'Content-Type': 'application/json' } })
  );
  const m = meta();
  if (!m.ids.includes(verified.id)) {
    m.ids.push(verified.id);
    m.bytes += body.length;
    saveMeta(m);
  }
}

export async function cachePutMany(events: Event[]): Promise<void> {
  await Promise.all(events.map((e) => cachePutEvent(e)));
}

export async function cacheScanByKind(kind: number, limit = 100): Promise<Event[]> {
  const cache = await openCache();
  const m = meta();
  const out: Event[] = [];
  for (const id of [...m.ids].reverse()) {
    if (out.length >= limit) break;
    const res = await cache.match(`/event/${id}`);
    if (!res) continue;
    const e = ingestEvent(await res.json());
    if (e && e.kind === kind) out.push(e);
  }
  return out;
}

export function cacheSizeHuman(): string {
  const m = meta();
  if (m.bytes < 1024) return `${m.bytes} B`;
  if (m.bytes < 1024 * 1024) return `${(m.bytes / 1024).toFixed(1)} KB`;
  return `${(m.bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function clearEventCache(): Promise<void> {
  await caches.delete(CACHE_NAME);
  localStorage.removeItem(META_KEY);
}

export async function cacheCover(url: string, blob: Blob): Promise<void> {
  const cache = await openCache();
  await cache.put(`/cover/${encodeURIComponent(url)}`, new Response(blob));
}

export async function getCachedCover(url: string): Promise<string | null> {
  const cache = await openCache();
  const res = await cache.match(`/cover/${encodeURIComponent(url)}`);
  if (!res) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
