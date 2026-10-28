import { decodePointer } from '@silberengel/kind-compose-catalog';
import { hexPubkey } from './metadata';
import { nip19 } from 'nostr-tools';

const POINTER_TAG_NAMES = new Set(['a', 'A', 'e', 'E', 'p', 'P', 'q', 'Q']);

export function isComposePointerTagName(name: string): boolean {
  return POINTER_TAG_NAMES.has(name.trim());
}

function stripNostr(raw: string): string {
  return raw.trim().replace(/^nostr:/i, '');
}

function nprofileRelay(raw: string): string | undefined {
  try {
    const decoded = nip19.decode(stripNostr(raw));
    if (decoded.type === 'nprofile') return decoded.data.relays?.[0];
  } catch {
    /* ignore */
  }
  return undefined;
}

function withOptionalSlot(parts: string[], index: number, value: string | undefined): string[] {
  if (!value) return parts;
  const next = [...parts];
  while (next.length <= index) next.push('');
  if (!(next[index] ?? '').trim()) next[index] = value;
  return next;
}

function addrCoordinate(ptr: Extract<ReturnType<typeof decodePointer>, { type: 'addr' }>): string {
  return `${ptr.kind}:${ptr.pubkey}:${ptr.identifier}`;
}

/**
 * Normalize freeform / catalog pointer tag rows:
 * - `a` / `A` + naddr → `kind:pubkey:d` (+ relay hint)
 * - `e` / `E` + note/nevent → hex id (+ relay / author)
 * - `p` / `P` + npub/nprofile → hex pubkey (+ relay from nprofile)
 * - `q` / `Q` → same as a/e/p depending on the bech32 type
 */
export function normalizeComposeTagRow(row: readonly string[]): string[] {
  if (!row.length) return [...row];
  const name = (row[0] ?? '').trim();
  if (!isComposePointerTagName(name)) return row.map((c) => c);
  const rawValue = (row[1] ?? '').trim();
  if (!rawValue) return row.map((c) => c);

  const lower = name.toLowerCase();
  const rest = row.slice(2).map((c) => c);
  let next: string[] = [name, rawValue, ...rest];

  if (lower === 'p') {
    const pk = hexPubkey(rawValue);
    if (!pk) return next;
    next = [name, pk, ...rest];
    return withOptionalSlot(next, 2, nprofileRelay(rawValue));
  }

  if (lower === 'a') {
    const ptr = decodePointer(rawValue);
    if (ptr?.type !== 'addr') return next;
    next = [name, addrCoordinate(ptr), ...rest];
    return withOptionalSlot(next, 2, ptr.relay);
  }

  if (lower === 'e') {
    const ptr = decodePointer(rawValue);
    if (ptr?.type !== 'event') return next;
    next = [name, ptr.id, ...rest];
    next = withOptionalSlot(next, 2, ptr.relay);
    return withOptionalSlot(next, 3, ptr.author);
  }

  // q / Q — event id, address, or pubkey depending on what was pasted
  const ptr = decodePointer(rawValue);
  if (ptr?.type === 'event') {
    next = [name, ptr.id, ...rest];
    next = withOptionalSlot(next, 2, ptr.relay);
    return withOptionalSlot(next, 3, ptr.author);
  }
  if (ptr?.type === 'addr') {
    next = [name, addrCoordinate(ptr), ...rest];
    return withOptionalSlot(next, 2, ptr.relay);
  }
  const pk = hexPubkey(rawValue);
  if (pk) {
    next = [name, pk, ...rest];
    return withOptionalSlot(next, 2, nprofileRelay(rawValue));
  }
  return next;
}

/** Normalize only the value cell for a known pointer tag name. */
export function normalizeComposeTagValue(tagName: string, value: string): string {
  const row = normalizeComposeTagRow([tagName, value]);
  return row[1] ?? value;
}

/** Apply pointer normalization across freeform tag rows. */
export function normalizeComposeTagRows(rows: readonly string[][]): string[][] {
  return rows.map((row) => normalizeComposeTagRow(row));
}
