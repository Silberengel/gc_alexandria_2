import { nip19 } from 'nostr-tools';
import { normalizeDTag } from './dtag';
import { parseEventCoordinate } from './library-scope';
import { normalizeWebSocketRelay } from './nostr/relay-filters';

const HEX64 = /^[0-9a-f]{64}$/i;
/** Hyphenated slug chars (letters/digits/hyphen); dots/underscores ok until normalized. */
const D_TAG_CHARS = /^[\p{L}\p{N}][\p{L}\p{N}._\s-]*$/u;

export type SearchPointer =
  | { type: 'coord'; kind: number; pubkey: string; d: string; relays?: string[] }
  | { type: 'id'; id: string; author?: string; relays?: string[] };

function stripNostr(s: string): string {
  return s.trim().replace(/^nostr:/i, '');
}

function hintRelays(raw: string[] | undefined): string[] | undefined {
  if (!raw?.length) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const n = normalizeWebSocketRelay(entry) ?? entry.trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.length ? out : undefined;
}

/** Derive editable parts from a bech32, hex id, or `kind:pubkey[:d]` query. */
export function parseSearchPointer(query: string): SearchPointer | null {
  const q = stripNostr(query);
  if (!q) return null;

  if (HEX64.test(q)) {
    return { type: 'id', id: q.toLowerCase() };
  }

  const coord = parseEventCoordinate(q);
  if (coord) {
    return { type: 'coord', kind: coord.kind, pubkey: coord.pubkey, d: coord.d };
  }

  try {
    const decoded = nip19.decode(q);
    if (decoded.type === 'note') {
      return { type: 'id', id: decoded.data.toLowerCase() };
    }
    if (decoded.type === 'nevent') {
      return {
        type: 'id',
        id: decoded.data.id.toLowerCase(),
        author: decoded.data.author?.toLowerCase(),
        relays: hintRelays(decoded.data.relays)
      };
    }
    if (decoded.type === 'naddr') {
      return {
        type: 'coord',
        kind: decoded.data.kind,
        pubkey: decoded.data.pubkey.toLowerCase(),
        d: decoded.data.identifier,
        relays: hintRelays(decoded.data.relays)
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function validateKindInput(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Kind must be an integer' };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) return { ok: false, error: 'Kind must be an integer' };
  return { ok: true, value: n };
}

export function validatePubkeyHex(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const s = raw.trim().toLowerCase();
  if (!HEX64.test(s)) return { ok: false, error: 'Pubkey must be 64 hex characters' };
  return { ok: true, value: s };
}

export function validateEventIdHex(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const s = raw.trim().toLowerCase();
  if (!HEX64.test(s)) return { ok: false, error: 'Event id must be 64 hex characters' };
  return { ok: true, value: s };
}

/**
 * d-tag: empty (replaceable) or a hyphen-friendly slug.
 * Letters, digits, hyphen, dot, underscore, spaces allowed; must normalize to a hyphenated slug.
 */
export function validateDTagInput(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return { ok: true, value: '' };
  if (!D_TAG_CHARS.test(s)) {
    return { ok: false, error: 'd-tag may only use letters, numbers, hyphens, dots, and underscores' };
  }
  const slug = normalizeDTag(s);
  if (!slug) return { ok: false, error: 'd-tag must include letters or numbers' };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) {
    return { ok: false, error: 'd-tag must form a hyphenated slug' };
  }
  return { ok: true, value: s };
}

/** One relay URL per line; blank lines ignored. */
export function validateRelaysInput(
  raw: string
): { ok: true; value: string[] } | { ok: false; error: string } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: true, value: [] };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const n = normalizeWebSocketRelay(line);
    if (!n) return { ok: false, error: 'Relay hints must be ws:// or wss:// URLs' };
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return { ok: true, value: out };
}

/** Rebuild a search `q` from edited parts (bech32 when relay hints remain). */
export function formatSearchPointerQuery(pointer: SearchPointer): string {
  const relays = pointer.relays?.length ? pointer.relays : undefined;
  if (pointer.type === 'id') {
    if (relays || pointer.author) {
      return nip19.neventEncode({
        id: pointer.id.toLowerCase(),
        author: pointer.author,
        relays
      });
    }
    return pointer.id.toLowerCase();
  }
  const kind = pointer.kind;
  const pk = pointer.pubkey.toLowerCase();
  if (relays) {
    return nip19.naddrEncode({
      kind,
      pubkey: pk,
      identifier: pointer.d,
      relays
    });
  }
  if (!pointer.d) return `${kind}:${pk}`;
  return `${kind}:${pk}:${pointer.d}`;
}

export function searchPointerLabel(pointer: SearchPointer): string {
  return pointer.type === 'coord' ? 'Address' : 'Event';
}
