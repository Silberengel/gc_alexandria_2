import type { Filter } from 'nostr-tools';
import { indexSlug } from '../dtag';

const MAX_RELAY_LIMIT = 100;
const MERCURY_HOST = 'mercury-relay.imwald.eu';

/** Read-only WebSocket relays — never used for publish. */
export const READ_ONLY_WSS = new Set([
  'wss://mercury-relay.imwald.eu',
  'wss://aggr.nostr.land'
]);

/** Normalize a WebSocket relay URL (Mercury `/relay` → origin). */
export function normalizeWebSocketRelay(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return null;
  let normalized = trimmed;
  if (!normalized.startsWith('ws://') && !normalized.startsWith('wss://')) return null;
  try {
    const u = new URL(normalized);
    const host = u.hostname.toLowerCase();
    // Clearnet browser clients cannot reach Tor or I2P without a local proxy.
    if (host.endsWith('.onion') || host.endsWith('.i2p')) return null;
    if (host === MERCURY_HOST) {
      const path = u.pathname.replace(/\/+$/, '') || '';
      if (path === '/relay') u.pathname = '';
    }
    u.pathname = u.pathname.replace(/\/+$/, '');
    normalized = u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
  return normalized;
}

/** True for Tor (.onion) or I2P (.i2p) relay hosts — always skipped. */
export function isTorOrI2pRelay(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return host.endsWith('.onion') || host.endsWith('.i2p');
  } catch {
    const lower = url.toLowerCase();
    return lower.includes('.onion') || lower.includes('.i2p');
  }
}

export function isWebSocketRelay(url: string): boolean {
  return normalizeWebSocketRelay(url) != null;
}

export function webSocketRelays(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const norm = normalizeWebSocketRelay(url);
    if (!norm) continue;
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

export function writeWebSocketRelays(urls: string[]): string[] {
  return webSocketRelays(urls).filter((u) => !READ_ONLY_WSS.has(u.toLowerCase()));
}

function cleanTagValues(values: string[] | undefined): string[] | undefined {
  if (!values?.length) return undefined;
  const out = [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];
  return out.length ? out : undefined;
}

/** Normalize filters for strict relays (nostr.wine caps limit at 100). */
export function normalizeRelayFilters(filters: Filter[]): Filter[] {
  const out: Filter[] = [];
  for (const raw of filters) {
    const f: Filter = {};
    if (raw.ids?.length) {
      f.ids = raw.ids.map((id) => id.toLowerCase()).filter((id) => /^[0-9a-f]{64}$/.test(id));
      if (!f.ids.length) continue;
    }
    if (raw.authors?.length) {
      f.authors = raw.authors.map((a) => a.toLowerCase()).filter((a) => /^[0-9a-f]{64}$/.test(a));
      if (!f.authors.length) continue;
    }
    if (raw.kinds?.length) {
      f.kinds = raw.kinds.filter((k) => Number.isInteger(k));
      if (!f.kinds.length) continue;
    }
    if (raw.since != null) f.since = raw.since;
    if (raw.until != null) f.until = raw.until;
    for (const key of Object.keys(raw)) {
      if (key.length === 2 && key.startsWith('#')) {
        const vals = cleanTagValues((raw as Record<string, string[]>)[key]);
        if (vals) (f as Record<string, string[]>)[key] = vals;
      }
    }
    const lim = raw.limit == null ? MAX_RELAY_LIMIT : Number(raw.limit);
    f.limit = Math.min(MAX_RELAY_LIMIT, Math.max(1, lim || MAX_RELAY_LIMIT));
    if (!f.ids && !f.authors && !f.kinds && !Object.keys(f).some((k) => k.startsWith('#'))) {
      continue;
    }
    out.push(f);
  }
  return out;
}

export function relayTagSlug(value: string): string {
  return indexSlug(value) || value.trim().toLowerCase();
}
