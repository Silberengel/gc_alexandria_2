import type { Filter, Event } from 'nostr-tools';
import { MERCURY_HTTP, MERCURY_WSS } from '../constants';
import { ingestEvent } from './verify';
import { cachePutMany } from './cache';
import { noteEventSource } from './event-sources';

function trimSlash(base: string): string {
  return base.replace(/\/+$/, '');
}

function parseEvents(data: unknown, source = MERCURY_WSS): Event[] {
  if (!data || typeof data !== 'object') return [];
  const rows = Array.isArray(data)
    ? data
    : 'data' in data && Array.isArray((data as { data: unknown }).data)
      ? (data as { data: unknown[] }).data
      : [];
  const out: Event[] = [];
  for (const row of rows) {
    const e = ingestEvent(row);
    if (e) {
      noteEventSource(e.id, source);
      out.push(e);
    }
  }
  return out;
}

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

const SEARCH_FIELDS = ['q', 'title', 'author', 'language', 'subject', 'd', 'identifier', 's'] as const;

function searchHasQuery(query: Record<string, unknown>): boolean {
  return SEARCH_FIELDS.some((key) => typeof query[key] === 'string' && String(query[key]).trim().length > 0);
}

/** After DNS/proxy failures, skip Mercury briefly so Vite and relays are not spammed. */
const COOLDOWN_MS = 60_000;
let unavailableUntil = 0;

function mercurySkipped(): boolean {
  return Date.now() < unavailableUntil;
}

function markMercuryDown(): void {
  unavailableUntil = Date.now() + COOLDOWN_MS;
}

async function mercuryRequest(path: string, init?: RequestInit): Promise<Response | null> {
  if (mercurySkipped()) return null;
  try {
    const res = await fetch(`${trimSlash(MERCURY_HTTP)}${path}`, init);
    // Proxy DNS/outages often surface as 5xx rather than a thrown fetch error.
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      markMercuryDown();
      return null;
    }
    return res;
  } catch {
    markMercuryDown();
    return null;
  }
}

export function isMercuryUnavailable(): boolean {
  return mercurySkipped();
}

export async function mercuryFilter(filter: Filter): Promise<Event[]> {
  try {
    const body: Record<string, unknown> = { limit: Math.min(100, filter.limit ?? 100) };
    if (filter.ids?.length) body.ids = filter.ids.map((id) => id.toLowerCase());
    if (filter.authors?.length) body.authors = filter.authors.map((a) => a.toLowerCase());
    if (filter.kinds?.length) body.kinds = filter.kinds;
    if (filter.since != null) body.since = filter.since;
    if (filter.until != null) body.until = filter.until;
    for (const key of Object.keys(filter)) {
      if (key.length === 2 && key.startsWith('#')) {
        const v = (filter as Record<string, unknown>)[key];
        if (Array.isArray(v) && v.length) body[key] = v;
      }
    }
    const res = await mercuryRequest('/api/events/filter', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body)
    });
    if (!res?.ok) return [];
    const events = parseEvents(await res.json());
    void cachePutMany(events).catch(() => {});
    return events;
  } catch {
    return [];
  }
}

export async function mercuryPublicationSearch(query: Record<string, unknown>): Promise<Event[]> {
  if (!searchHasQuery(query)) return [];
  const res = await mercuryRequest('/api/publications/search', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ limit: Math.min(100, Number(query.limit) || 100), ...query })
  });
  if (!res?.ok) return [];
  try {
    return parseEvents(await res.json());
  } catch {
    return [];
  }
}

export async function mercuryWikiSearch(query: Record<string, unknown>): Promise<Event[]> {
  const res = await mercuryRequest('/api/wiki/search', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ limit: 100, ...query })
  });
  if (!res?.ok) return [];
  try {
    return parseEvents(await res.json());
  } catch {
    return [];
  }
}

export async function mercurySectionSearch(query: Record<string, unknown>): Promise<Event[]> {
  const res = await mercuryRequest('/api/publications/sections/search', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ limit: 100, ...query })
  });
  if (!res?.ok) return [];
  try {
    return parseEvents(await res.json());
  } catch {
    return [];
  }
}

export async function mercurySuggest(q: string): Promise<string[]> {
  const res = await mercuryRequest('/api/suggest', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ q, limit: 10 })
  });
  if (!res?.ok) return [];
  try {
    const data = (await res.json()) as { suggestions?: string[] };
    return data.suggestions ?? [];
  } catch {
    return [];
  }
}

export async function mercuryPublicationMeta(
  naddr: string,
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  const encoded = encodeURIComponent(naddr);
  const res = await mercuryRequest(`/api/publications/${encoded}/meta`, { signal });
  if (!res?.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function mercuryPublicationToc(naddr: string, signal?: AbortSignal): Promise<unknown[] | null> {
  const encoded = encodeURIComponent(naddr);
  const res = await mercuryRequest(`/api/publications/${encoded}/toc`, { signal });
  if (!res?.ok) return null;
  try {
    const data = await res.json();
    return Array.isArray(data) ? data : (data as { toc?: unknown[] }).toc ?? null;
  } catch {
    return null;
  }
}

export async function mercuryPublicationStream(
  naddr: string,
  pos?: number,
  signal?: AbortSignal
): Promise<Event[]> {
  const encoded = encodeURIComponent(naddr);
  const path =
    pos != null
      ? `/api/publications/${encoded}/stream?pos=${pos}`
      : `/api/publications/${encoded}/stream`;
  const res = await mercuryRequest(path, { signal });
  if (!res?.ok) return [];
  try {
    return parseEvents(await res.json());
  } catch {
    return [];
  }
}

export async function mercuryPublish(event: Event): Promise<boolean> {
  const res = await mercuryRequest('/api/events', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(event)
  });
  return !!res?.ok;
}
