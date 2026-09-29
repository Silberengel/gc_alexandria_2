import { pubkeyFromCoordinateSegment } from './library-scope';

/** Split `kind:pubkey:d…` — pubkey may be 64-hex or `npub1…` (d may contain `:`). */
export function splitPublicationCoordinate(coordinate: string): {
  kind: number;
  pubkey: string;
  d: string;
} | null {
  const trimmed = coordinate.trim();
  const i0 = trimmed.indexOf(':');
  const i1 = trimmed.indexOf(':', i0 + 1);
  if (i0 < 1 || i1 <= i0 + 1) return null;
  const kind = Number.parseInt(trimmed.slice(0, i0), 10);
  if (Number.isNaN(kind)) return null;
  const pubkey = pubkeyFromCoordinateSegment(trimmed.slice(i0 + 1, i1));
  if (!pubkey) return null;
  const d = trimmed.slice(i1 + 1);
  if (!d) return null;
  return { kind, pubkey, d };
}

/**
 * Coordinate strings to try when matching index `a` tags (NFC/NFD on `d` only).
 * Relays filter `#d` on exact bytes; clients still need flexible matching after REQ.
 * Always emits hex-pubkey forms so they match on-wire `a` tags.
 */
export function publicationCoordinateLookupKeys(coordinate: string): string[] {
  const p = splitPublicationCoordinate(coordinate);
  if (!p) return [coordinate.trim()];
  const ds = [...new Set([p.d, p.d.normalize('NFC'), p.d.normalize('NFD')])];
  const keys = ds.map((dt) => `${p.kind}:${p.pubkey}:${dt}`);
  // Also keep the raw (possibly npub) form for direct string compares.
  return [...new Set([coordinate.trim(), ...keys])];
}

export function coordinatesOverlap(left: string, right: string): boolean {
  const rightKeys = new Set(publicationCoordinateLookupKeys(right));
  return publicationCoordinateLookupKeys(left).some((key) => rightKeys.has(key));
}
