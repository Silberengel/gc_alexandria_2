import type { Filter, Event } from 'nostr-tools';
import { MERCURY_HTTP } from '../constants';
import { ingestEvent } from './verify';
import { cachePutMany } from './cache';

function trimSlash(base: string): string {
  return base.replace(/\/+$/, '');
}

function parseEvents(data: unknown): Event[] {
  if (!data || typeof data !== 'object') return [];
  const rows = Array.isArray(data)
    ? data
    : 'data' in data && Array.isArray((data as { data: unknown }).data)
      ? (data as { data: unknown[] }).data
      : [];
  const out: Event[] = [];
  for (const row of rows) {
    const e = ingestEvent(row);
    if (e) out.push(e);
  }
  return out;
}

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

const SEARCH_FIELDS = ['q', 'title', 'author', 'language', 'subject', 'd', 'identifier'] as const;

function searchHasQuery(query: Record<string, unknown>): boolean {
  return SEARCH_FIELDS.some((key) => typeof query[key] === 'string' && String(query[key]).trim().length > 0);
}

export async function mercuryFilter(filter: Filter): Promise<Event[]> {
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
  const res = await fetch(`${trimSlash(MERCURY_HTTP)}/api/events/filter`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  });
  if (!res.ok) return [];
  const events = parseEvents(await res.json());
  void cachePutMany(events);
  return events;
}

export async function mercuryPublicationSearch(query: Record<string, unknown>): Promise<Event[]> {
  if (!searchHasQuery(query)) return [];
  const res = await fetch(`${trimSlash(MERCURY_HTTP)}/api/publications/search`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ limit: Math.min(100, Number(query.limit) || 100), ...query })
  });
  if (!res.ok) return [];
  return parseEvents(await res.json());
}

export async function mercuryWikiSearch(query: Record<string, unknown>): Promise<Event[]> {
  const res = await fetch(`${trimSlash(MERCURY_HTTP)}/api/wiki/search`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ limit: 100, ...query })
  });
  if (!res.ok) return [];
  return parseEvents(await res.json());
}

export async function mercurySectionSearch(query: Record<string, unknown>): Promise<Event[]> {
  const res = await fetch(`${trimSlash(MERCURY_HTTP)}/api/publications/sections/search`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ limit: 100, ...query })
  });
  if (!res.ok) return [];
  return parseEvents(await res.json());
}

export async function mercurySuggest(q: string): Promise<string[]> {
  const res = await fetch(`${trimSlash(MERCURY_HTTP)}/api/suggest`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ q, limit: 10 })
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { suggestions?: string[] };
  return data.suggestions ?? [];
}

export async function mercuryPublicationMeta(naddr: string): Promise<Record<string, unknown> | null> {
  const encoded = encodeURIComponent(naddr);
  const res = await fetch(`${trimSlash(MERCURY_HTTP)}/api/publications/${encoded}/meta`);
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function mercuryPublicationToc(naddr: string): Promise<unknown[] | null> {
  const encoded = encodeURIComponent(naddr);
  const res = await fetch(`${trimSlash(MERCURY_HTTP)}/api/publications/${encoded}/toc`);
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? data : (data as { toc?: unknown[] }).toc ?? null;
}

export async function mercuryPublicationStream(naddr: string, pos?: number): Promise<Event[]> {
  const encoded = encodeURIComponent(naddr);
  const url = pos != null
    ? `${trimSlash(MERCURY_HTTP)}/api/publications/${encoded}/stream?pos=${pos}`
    : `${trimSlash(MERCURY_HTTP)}/api/publications/${encoded}/stream`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return parseEvents(await res.json());
}

export async function mercuryPublish(event: Event): Promise<boolean> {
  const res = await fetch(`${trimSlash(MERCURY_HTTP)}/api/events`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(event)
  });
  return res.ok;
}
