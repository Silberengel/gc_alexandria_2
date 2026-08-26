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

const LANDING_SNAPSHOT_KEY = '/snapshot/landing';
const SEARCH_KEYS_META = 'alexandria-search-keys';
const MAX_SEARCH_SNAPSHOTS = 20;

export type LandingShelfSnap = { id: string; title: string; events: Event[] };

export type LandingSnapshot = {
  publications: Event[];
  highlights: Event[];
  comments: Event[];
  referenced: Event[];
  shelves?: LandingShelfSnap[];
  labels?: string[];
};

function ingestList(rows: unknown): Event[] {
  if (!Array.isArray(rows)) return [];
  const out: Event[] = [];
  for (const row of rows) {
    const e = ingestEvent(row);
    if (e) out.push(e);
  }
  return out;
}

export async function cacheGetLandingSnapshot(): Promise<LandingSnapshot | null> {
  const cache = await openCache();
  const res = await cache.match(LANDING_SNAPSHOT_KEY);
  if (!res) return null;
  try {
    const raw = (await res.json()) as LandingSnapshot;
    return {
      publications: ingestList(raw.publications),
      highlights: ingestList(raw.highlights),
      comments: ingestList(raw.comments),
      referenced: ingestList(raw.referenced),
      shelves: Array.isArray(raw.shelves)
        ? raw.shelves.map((s) => ({
            id: String(s.id),
            title: String(s.title),
            events: ingestList(s.events)
          }))
        : [],
      labels: Array.isArray(raw.labels) ? raw.labels.filter((l): l is string => typeof l === 'string') : []
    };
  } catch {
    return null;
  }
}

export async function cachePutLandingSnapshot(snap: LandingSnapshot): Promise<void> {
  const cache = await openCache();
  const body = JSON.stringify({
    publications: snap.publications.slice(0, 50),
    highlights: snap.highlights.slice(0, 10),
    comments: snap.comments.slice(0, 10),
    referenced: (snap.referenced ?? []).slice(0, 80),
    shelves: (snap.shelves ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      events: s.events.slice(0, 50)
    })),
    labels: (snap.labels ?? []).slice(0, 25)
  });
  await cache.put(
    LANDING_SNAPSHOT_KEY,
    new Response(body, { headers: { 'Content-Type': 'application/json' } })
  );
}

function searchSnapshotUrl(key: string): string {
  return `/snapshot/search/${encodeURIComponent(key)}`;
}

function searchKeyList(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_KEYS_META);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((k): k is string => typeof k === 'string');
    }
  } catch {
    /* ignore */
  }
  return [];
}

export async function cacheGetSearchSnapshot(key: string): Promise<Event[]> {
  const cache = await openCache();
  const res = await cache.match(searchSnapshotUrl(key));
  if (!res) return [];
  try {
    return ingestList(await res.json());
  } catch {
    return [];
  }
}

export async function cachePutSearchSnapshot(key: string, events: Event[]): Promise<void> {
  const cache = await openCache();
  const body = JSON.stringify(events.slice(0, 100));
  await cache.put(
    searchSnapshotUrl(key),
    new Response(body, { headers: { 'Content-Type': 'application/json' } })
  );
  const keys = [key, ...searchKeyList().filter((k) => k !== key)];
  const dropped = keys.slice(MAX_SEARCH_SNAPSHOTS);
  const kept = keys.slice(0, MAX_SEARCH_SNAPSHOTS);
  localStorage.setItem(SEARCH_KEYS_META, JSON.stringify(kept));
  await Promise.all(dropped.map((k) => cache.delete(searchSnapshotUrl(k))));
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

export async function cacheDeleteEvent(id: string): Promise<void> {
  const cache = await openCache();
  const key = `/event/${id.toLowerCase()}`;
  const res = await cache.match(key);
  if (!res) return;
  const bodyLen = (await res.clone().text()).length;
  await cache.delete(key);
  const m = meta();
  m.ids = m.ids.filter((x) => x !== id.toLowerCase());
  m.bytes = Math.max(0, m.bytes - bodyLen);
  saveMeta(m);
}

export async function cacheScanText(q: string, limit = 100): Promise<Event[]> {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const cache = await openCache();
  const m = meta();
  const out: Event[] = [];
  for (const id of [...m.ids].reverse()) {
    if (out.length >= limit) break;
    const res = await cache.match(`/event/${id}`);
    if (!res) continue;
    const e = ingestEvent(await res.json());
    if (!e) continue;
    const hay = `${e.content}\n${e.tags.flat().join('\n')}`.toLowerCase();
    if (hay.includes(needle)) out.push(e);
  }
  return out;
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
  localStorage.removeItem(SEARCH_KEYS_META);
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
