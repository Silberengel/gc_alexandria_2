import type { Filter } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { getKind } from '@silberengel/kind-compose-catalog';
import { KIND } from './constants';
import { parseEventCoordinate } from './library-scope';
import { hexPubkey } from './metadata';
import { MERCURY_DOCUMENT_KINDS } from './nostr/mercury';
import { normalizeWebSocketRelay } from './nostr/relay-filters';
import { documentStack, socialStack } from './nostr/selector';
import { kindDescription } from './kind-label';

export type MercurySearchFields = Partial<
  Record<'q' | 'title' | 'author' | 'language' | 'subject' | 'd' | 'identifier' | 's', string>
>;

export type AdvancedSearchRequest = {
  filter?: Filter;
  mercury?: MercurySearchFields;
  /** Relays queried on the relay leg (always filled on submit / after parse). */
  relays: string[];
};

export const ADVANCED_SEARCH_MAX_RELAYS = 20;
export const ADVANCED_SEARCH_MAX_LIMIT = 100;

const HEX64 = /^[0-9a-f]{64}$/i;

const KIND_NAME_ALIASES: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  const add = (name: string, kind: number) => {
    const key = name.trim().toLowerCase().replace(/[\s_]+/g, ' ');
    if (key && map[key] == null) map[key] = kind;
  };
  for (const [key, value] of Object.entries(KIND)) {
    if (typeof value !== 'number') continue;
    add(key, value);
    add(key.replace(/_/g, ' '), value);
    add(kindDescription(value), value);
    const catalog = getKind(value)?.label;
    if (catalog) add(catalog, value);
  }
  add('note', KIND.TEXT_NOTE);
  add('text note', KIND.TEXT_NOTE);
  add('article', KIND.LONG_FORM);
  add('wiki', KIND.WIKI);
  add('spec', KIND.SPEC);
  add('publication', KIND.PUBLICATION);
  add('section', KIND.SECTION);
  return map;
})();

export function clampAdvancedLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(ADVANCED_SEARCH_MAX_LIMIT, Math.floor(n));
}

/** Resolve a kind token (integer or known name) to a kind number. */
export function parseKindToken(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return KIND_NAME_ALIASES[t.toLowerCase().replace(/[_-]+/g, ' ')] ?? null;
}

export function parseKindsInput(raw: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of raw.split(/[,;\s]+/)) {
    const k = parseKindToken(part);
    if (k == null || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** Hex event id from hex / note1 / nevent1. */
export function parseEventIdToken(raw: string): string | null {
  const t = raw.trim().replace(/^nostr:/i, '');
  if (!t) return null;
  if (HEX64.test(t)) return t.toLowerCase();
  try {
    const decoded = nip19.decode(t);
    if (decoded.type === 'note') return decoded.data;
    if (decoded.type === 'nevent') return decoded.data.id;
  } catch {
    /* ignore */
  }
  return null;
}

export function normalizeRelayList(raw: string[] | undefined | null): string[] {
  if (!raw?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const n = normalizeWebSocketRelay(String(entry ?? ''));
    if (!n) continue;
    const key = n.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
    if (out.length >= ADVANCED_SEARCH_MAX_RELAYS) break;
  }
  return out;
}

/**
 * Default relays for the advanced search relay leg — union of document and/or
 * social stacks from kinds (same dual-stack rule as catalog `run*`).
 */
export function defaultAdvancedSearchRelays(filter?: Filter | null): string[] {
  const kinds = filter?.kinds;
  const urls: string[] = [];
  if (!kinds?.length) {
    urls.push(...documentStack(), ...socialStack());
  } else {
    const useDoc = kinds.some((k) => MERCURY_DOCUMENT_KINDS.has(k));
    const useSocial = kinds.some((k) => !MERCURY_DOCUMENT_KINDS.has(k));
    if (useDoc) urls.push(...documentStack());
    if (useSocial) urls.push(...socialStack());
    if (!useDoc && !useSocial) urls.push(...documentStack(), ...socialStack());
  }
  return normalizeRelayList(urls);
}

export function filterHasQueryKeys(filter: Filter | undefined): boolean {
  if (!filter) return false;
  if (filter.ids?.length) return true;
  if (filter.authors?.length) return true;
  if (filter.kinds?.length) return true;
  if (filter.search?.trim()) return true;
  if (filter.since != null || filter.until != null) return true;
  for (const key of Object.keys(filter)) {
    if (key.startsWith('#') && Array.isArray((filter as Record<string, unknown>)[key])) {
      const v = (filter as Record<string, unknown>)[key] as unknown[];
      if (v.length) return true;
    }
  }
  return false;
}

export function mercuryHasQuery(mercury: MercurySearchFields | undefined): boolean {
  if (!mercury) return false;
  return Object.values(mercury).some((v) => typeof v === 'string' && v.trim().length > 0);
}

export function advancedSearchHasQuery(req: Partial<AdvancedSearchRequest>): boolean {
  return filterHasQueryKeys(req.filter) || mercuryHasQuery(req.mercury);
}

/** Which UI/leg a request came from — mercury typed search vs relay NIP-01 filter. */
export type AdvancedSearchMode = 'mercury' | 'relays';

export function inferAdvancedSearchMode(req: Partial<AdvancedSearchRequest>): AdvancedSearchMode {
  if (mercuryHasQuery(req.mercury) && !filterHasQueryKeys(req.filter)) return 'mercury';
  return 'relays';
}

function appendTag(filter: Filter, name: string, value: string): void {
  const key = name.startsWith('#') ? name : `#${name}`;
  const list = ((filter as Record<string, string[]>)[key] ??= []);
  if (!list.includes(value)) list.push(value);
}

/**
 * Normalize a draft filter: authors vs #a, bech32 ids/e/p, clamp limit.
 */
export function normalizeAdvancedFilter(raw: Filter | undefined): Filter {
  const filter: Filter = { ...(raw ?? {}) };
  const authorsIn = [...(filter.authors ?? [])];
  filter.authors = [];
  for (const entry of authorsIn) {
    const s = String(entry).trim().replace(/^nostr:/i, '');
    if (!s) continue;
    const coord = parseEventCoordinate(s);
    if (coord) {
      appendTag(filter, 'a', `${coord.kind}:${coord.pubkey}:${coord.d}`);
      continue;
    }
    try {
      const decoded = nip19.decode(s);
      if (decoded.type === 'naddr') {
        const { kind, pubkey, identifier } = decoded.data;
        appendTag(filter, 'a', `${kind}:${pubkey}:${identifier}`);
        continue;
      }
    } catch {
      /* fall through */
    }
    const hex = hexPubkey(s);
    if (hex) filter.authors!.push(hex);
  }
  if (!filter.authors?.length) delete filter.authors;

  if (filter.ids?.length) {
    const ids: string[] = [];
    for (const id of filter.ids) {
      const hex = parseEventIdToken(String(id));
      if (hex) ids.push(hex);
    }
    if (ids.length) filter.ids = ids;
    else delete filter.ids;
  }

  for (const tag of ['e', 'p'] as const) {
    const key = `#${tag}`;
    const values = (filter as Record<string, string[] | undefined>)[key];
    if (!values?.length) continue;
    const next: string[] = [];
    for (const v of values) {
      if (tag === 'e') {
        const id = parseEventIdToken(v);
        if (id) next.push(id);
      } else {
        const hex = hexPubkey(v) ?? (HEX64.test(v.trim()) ? v.trim().toLowerCase() : null);
        if (hex) next.push(hex);
      }
    }
    if (next.length) (filter as Record<string, string[]>)[key] = next;
    else delete (filter as Record<string, unknown>)[key];
  }

  if (filter.kinds?.length) {
    filter.kinds = filter.kinds.filter((k) => Number.isFinite(k) && k >= 0);
    if (!filter.kinds.length) delete filter.kinds;
  }

  if (typeof filter.search === 'string') {
    filter.search = filter.search.trim();
    if (!filter.search) delete filter.search;
  }

  filter.limit = clampAdvancedLimit(filter.limit ?? ADVANCED_SEARCH_MAX_LIMIT);
  return filter;
}

function normalizeMercury(raw: MercurySearchFields | undefined): MercurySearchFields | undefined {
  if (!raw) return undefined;
  const out: MercurySearchFields = {};
  for (const key of ['q', 'title', 'author', 'language', 'subject', 'd', 'identifier', 's'] as const) {
    const v = raw[key]?.trim();
    if (v) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Build a shareable `adv` query value. */
export function encodeAdvancedSearch(req: AdvancedSearchRequest): string {
  const filter = normalizeAdvancedFilter(req.filter);
  const mercury = normalizeMercury(req.mercury);
  let relays = normalizeRelayList(req.relays);
  if (!relays.length) relays = defaultAdvancedSearchRelays(filter);
  const payload: AdvancedSearchRequest = { relays };
  if (filterHasQueryKeys(filter) || filter.limit != null) payload.filter = filter;
  if (mercury) payload.mercury = mercury;
  // Always stamp limit on filter when we have any filter keys
  if (payload.filter) payload.filter.limit = clampAdvancedLimit(payload.filter.limit);
  return encodeURIComponent(JSON.stringify(payload));
}

/** Parse `adv` from URLSearchParams or a raw encoded string. */
export function parseAdvancedSearch(
  paramsOrAdv: URLSearchParams | string | null | undefined
): AdvancedSearchRequest | null {
  let raw = '';
  if (typeof paramsOrAdv === 'string') raw = paramsOrAdv;
  else if (paramsOrAdv) raw = paramsOrAdv.get('adv') ?? '';
  raw = raw.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const filterRaw =
    obj.filter && typeof obj.filter === 'object' ? (obj.filter as Filter) : undefined;
  const mercuryRaw =
    obj.mercury && typeof obj.mercury === 'object'
      ? (obj.mercury as MercurySearchFields)
      : undefined;
  const filter = normalizeAdvancedFilter(filterRaw);
  const mercury = normalizeMercury(mercuryRaw);
  let relays = normalizeRelayList(Array.isArray(obj.relays) ? (obj.relays as string[]) : []);
  if (!relays.length) relays = defaultAdvancedSearchRelays(filter);
  const req: AdvancedSearchRequest = { relays, filter, mercury };
  if (!advancedSearchHasQuery(req)) return null;
  if (req.filter) req.filter.limit = clampAdvancedLimit(req.filter.limit);
  return req;
}

/** Stable cache key fragment for an advanced request. */
export function advancedSearchCacheKey(req: AdvancedSearchRequest): string {
  const normalized: AdvancedSearchRequest = {
    relays: normalizeRelayList(req.relays).length
      ? normalizeRelayList(req.relays)
      : defaultAdvancedSearchRelays(req.filter),
    filter: normalizeAdvancedFilter(req.filter),
    mercury: normalizeMercury(req.mercury)
  };
  if (normalized.filter) normalized.filter.limit = clampAdvancedLimit(normalized.filter.limit);
  return `adv:${JSON.stringify(normalized)}`;
}

export function datetimeLocalToUnix(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

export function unixToDatetimeLocal(unix: number | undefined | null): string {
  if (unix == null || !Number.isFinite(unix)) return '';
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
