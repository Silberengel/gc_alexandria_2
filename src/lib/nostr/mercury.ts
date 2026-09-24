import type { Filter, Event } from 'nostr-tools';
import { KIND, MERCURY_HTTP, MERCURY_WSS } from '../constants';
import { ingestEvent } from './verify';
import { cachePutMany } from './cache';
import { noteEventSource } from './event-sources';

/** Mercury indexes only these document kinds — never social / lists / profiles. */
const MERCURY_DOCUMENT_KINDS = new Set<number>([
  KIND.LONG_FORM,
  KIND.PUBLICATION,
  KIND.SECTION,
  KIND.WIKI,
  KIND.SPEC
]);

/** Drop social kinds from a Mercury filter; null means skip the request entirely. */
function documentOnlyFilter(filter: Filter): Filter | null {
  if (!filter.kinds?.length) return filter;
  const kinds = filter.kinds.filter((k) => MERCURY_DOCUMENT_KINDS.has(k));
  if (!kinds.length) return null;
  return kinds.length === filter.kinds.length ? filter : { ...filter, kinds };
}

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

/** Mercury /stream and /export are NDJSON rows: `{ pos, kind, d, id, event }` (or a bare event). */
export function parsePublicationStreamNdjson(text: string, source = MERCURY_WSS): Event[] {
  const out: Event[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const wrapped = row as { event?: unknown };
    const candidate = wrapped.event && typeof wrapped.event === 'object' ? wrapped.event : row;
    const e = ingestEvent(candidate);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    noteEventSource(e.id, source);
    out.push(e);
  }
  return out;
}

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

const SEARCH_FIELDS = ['q', 'title', 'author', 'language', 'subject', 'd', 'identifier', 's'] as const;

/** Hard cap so a hung Mercury TCP never blocks landing paint for minutes. */
const MERCURY_FETCH_TIMEOUT_MS = 4_000;
/** Stream page body — keep short so a dead proxy fails over to a-tag walk quickly. */
const MERCURY_STREAM_BODY_TIMEOUT_MS = 8_000;

function searchHasQuery(query: Record<string, unknown>): boolean {
  return SEARCH_FIELDS.some((key) => typeof query[key] === 'string' && String(query[key]).trim().length > 0);
}

/** After DNS/proxy failures, skip Mercury briefly so Vite and relays are not spammed. */
const COOLDOWN_MS = 60_000;
let unavailableUntil = 0;

/** naddrs whose /meta|/toc|/stream returned 404 — do not re-hit for this session. */
const missingPublicationTrees = new Set<string>();

function mercurySkipped(): boolean {
  return Date.now() < unavailableUntil;
}

function markMercuryDown(): void {
  unavailableUntil = Date.now() + COOLDOWN_MS;
}

function markPublicationTreeMissing(naddr: string): void {
  const key = naddr.trim();
  if (key) missingPublicationTrees.add(key);
}

function publicationTreeMissing(naddr: string): boolean {
  return missingPublicationTrees.has(naddr.trim());
}

/** True when Mercury /meta|/toc|/stream already 404'd this naddr this session. */
export function isMercuryPublicationMissing(naddr: string): boolean {
  return publicationTreeMissing(naddr);
}

/** Test helper — clear session cooldowns and 404 cache. */
export function resetMercuryClientState(): void {
  unavailableUntil = 0;
  missingPublicationTrees.clear();
}

async function mercuryRequest(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response | null> {
  if (mercurySkipped()) return null;
  const timeoutMs = init?.timeoutMs ?? MERCURY_FETCH_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const { timeoutMs: _omit, ...fetchInit } = init ?? {};
  const signal =
    fetchInit.signal != null ? AbortSignal.any([fetchInit.signal, timeout]) : timeout;
  try {
    const res = await fetch(`${trimSlash(MERCURY_HTTP)}${path}`, { ...fetchInit, signal });
    // Proxy DNS/outages often surface as 5xx rather than a thrown fetch error.
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      markMercuryDown();
      return null;
    }
    return res;
  } catch (err) {
    // Timeouts must not trip the 60s cooldown — AbortError is expected under load.
    const name = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') return null;
    markMercuryDown();
    return null;
  }
}

export function isMercuryUnavailable(): boolean {
  return mercurySkipped();
}

export async function mercuryFilter(filter: Filter): Promise<Event[]> {
  const scoped = documentOnlyFilter(filter);
  if (!scoped) return [];
  try {
    const body: Record<string, unknown> = { limit: Math.min(100, scoped.limit ?? 100) };
    if (scoped.ids?.length) body.ids = scoped.ids.map((id) => id.toLowerCase());
    if (scoped.authors?.length) body.authors = scoped.authors.map((a) => a.toLowerCase());
    if (scoped.kinds?.length) body.kinds = scoped.kinds;
    if (scoped.since != null) body.since = scoped.since;
    if (scoped.until != null) body.until = scoped.until;
    for (const key of Object.keys(scoped)) {
      if (key.length === 2 && key.startsWith('#')) {
        const v = (scoped as Record<string, unknown>)[key];
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
  if (publicationTreeMissing(naddr)) return null;
  const encoded = encodeURIComponent(naddr);
  const res = await mercuryRequest(`/api/publications/${encoded}/meta`, { signal });
  if (res?.status === 404) {
    markPublicationTreeMissing(naddr);
    return null;
  }
  if (!res?.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function mercuryPublicationToc(naddr: string, signal?: AbortSignal): Promise<unknown[] | null> {
  if (publicationTreeMissing(naddr)) return null;
  const encoded = encodeURIComponent(naddr);
  const res = await mercuryRequest(`/api/publications/${encoded}/toc`, { signal });
  if (res?.status === 404) {
    markPublicationTreeMissing(naddr);
    return null;
  }
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
  signal?: AbortSignal,
  onPage?: (page: Event[]) => void,
  opts?: { maxEvents?: number }
): Promise<Event[]> {
  if (publicationTreeMissing(naddr)) return [];
  const encoded = encodeURIComponent(naddr);
  const pageSize = 200;
  const maxEvents = opts?.maxEvents ?? Infinity;
  let from = pos != null && Number.isFinite(pos) ? Math.max(0, Math.floor(pos)) : 0;
  const out: Event[] = [];
  const seen = new Set<string>();
  let pageFailures = 0;

  for (;;) {
    if (signal?.aborted) break;
    if (out.length >= maxEvents) break;
    const path = `/api/publications/${encoded}/stream?from=${from}&limit=${pageSize}`;
    const res = await mercuryRequest(path, { signal, timeoutMs: MERCURY_STREAM_BODY_TIMEOUT_MS });
    if (res?.status === 404) {
      markPublicationTreeMissing(naddr);
      break;
    }
    if (!res?.ok) {
      pageFailures += 1;
      // Dead/hung Mercury: fail over to a-tag walk immediately on the first page.
      // Later pages may retry once (partial Bible streams), but from=0 must not sit
      // through 2 × body timeouts before the reader walks relays.
      if (from === 0 || pageFailures >= 2) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 200 * pageFailures));
      continue;
    }
    let page: Event[] = [];
    try {
      // Body read can hang even after headers; race a timeout so one stuck page
      // cannot block the reader forever — but allow long Bible pages.
      const text = await Promise.race([
        res.text(),
        new Promise<string>((_, reject) => {
          const t = setTimeout(
            () => reject(new Error('mercury stream body timeout')),
            MERCURY_STREAM_BODY_TIMEOUT_MS
          );
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              reject(new Error('aborted'));
            },
            { once: true }
          );
        })
      ]);
      // Prefer NDJSON (current Mercury). Fall back to a JSON array of events/wrappers.
      page = parsePublicationStreamNdjson(text);
      if (!page.length) {
        try {
          const data = JSON.parse(text) as unknown;
          const rows = Array.isArray(data)
            ? data
            : data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)
              ? ((data as { data: unknown[] }).data)
              : [];
          for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            const wrapped = row as { event?: unknown };
            const candidate = wrapped.event && typeof wrapped.event === 'object' ? wrapped.event : row;
            const e = ingestEvent(candidate);
            if (e) page.push(e);
          }
        } catch {
          page = [];
        }
      }
    } catch {
      pageFailures += 1;
      if (from === 0 || pageFailures >= 2) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 200 * pageFailures));
      continue;
    }
    if (!page.length) break;
    pageFailures = 0;
    const fresh: Event[] = [];
    for (const e of page) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
      fresh.push(e);
      if (out.length >= maxEvents) break;
    }
    if (fresh.length) onPage?.(fresh);
    if (out.length >= maxEvents) break;
    if (page.length < pageSize) break;
    from += page.length;
    // Let the UI flush progressive adopts between Mercury pages (Bible-sized streams).
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  if (out.length) {
    // Chunk cache writes so a 30k-event Bible does not freeze the tab in one put.
    const CHUNK = 250;
    for (let i = 0; i < out.length; i += CHUNK) {
      void cachePutMany(out.slice(i, i + CHUNK)).catch(() => {});
      if (i + CHUNK < out.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  return out;
}
