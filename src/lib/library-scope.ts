import { nip19, type Event } from 'nostr-tools';
import { KIND } from './constants';
import { isNewerReplaceable } from './nostr/replaceable';

const LIBRARY_KINDS = new Set<number>([
  KIND.PUBLICATION,
  KIND.SECTION,
  KIND.WIKI,
  KIND.SPEC,
  KIND.LONG_FORM
]);

export const LIBRARY_KIND_TAGS = [...LIBRARY_KINDS].map(String);

export function isLibraryKind(kind: number): boolean {
  return LIBRARY_KINDS.has(kind);
}

/** Hex pubkey from a coordinate segment (64-hex or `npub1…`). */
export function pubkeyFromCoordinateSegment(segment: string): string | null {
  const raw = segment.trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return raw.toLowerCase();
  if (!raw.toLowerCase().startsWith('npub1')) return null;
  try {
    const decoded = nip19.decode(raw);
    if (decoded.type !== 'npub') return null;
    return typeof decoded.data === 'string' ? decoded.data.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * NIP-01 coordinate: `kind:pubkey:d` (addressable) or `kind:pubkey` (replaceable).
 * Pubkey segment may be 64-hex or `npub1…`. Accepts an optional `nostr:` prefix.
 */
export function parseEventCoordinate(
  coord: string
): { kind: number; pubkey: string; d: string } | null {
  const raw = coord.trim().replace(/^nostr:/i, '');
  if (!raw.includes(':')) return null;
  const parts = raw.split(':');
  if (parts.length < 2) return null;
  const kind = Number(parts[0]);
  if (!Number.isInteger(kind) || kind < 0) return null;
  const pubkey = pubkeyFromCoordinateSegment(parts[1] ?? '');
  if (!pubkey) return null;
  const d = parts.length === 2 ? '' : parts.slice(2).join(':');
  return { kind, pubkey, d };
}

/** Addressable `kind:pubkey:d` with a non-empty d (library a-tags, naddr). */
export function parseAddress(coord: string): { kind: number; pubkey: string; d: string } | null {
  const parsed = parseEventCoordinate(coord);
  if (!parsed || !parsed.d) return null;
  return parsed;
}

/**
 * Share-friendly `kind:npub:d` (Alexandria {@link parseAddress} still accepts hex).
 */
export function readableAddress(kind: number, pubkeyHex: string, d: string): string | null {
  const pk = pubkeyHex.trim().toLowerCase();
  const identifier = d.trim();
  if (!/^[0-9a-f]{64}$/.test(pk) || !identifier) return null;
  try {
    return `${kind}:${nip19.npubEncode(pk)}:${identifier}`;
  } catch {
    return null;
  }
}

export function readableEventAddress(event: Event): string | null {
  const d = event.tags.find((t) => t[0] === 'd')?.[1]?.trim() ?? '';
  return readableAddress(event.kind, event.pubkey, d);
}

export function libraryAddress(event: Event): string | null {
  return libraryAddresses(event)[0] ?? null;
}

export function libraryAddresses(event: Event): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of ['A', 'a'] as const) {
    for (const tag of event.tags) {
      if (tag[0] !== name || !tag[1]) continue;
      const parsed = parseAddress(tag[1]);
      if (!parsed || !isLibraryKind(parsed.kind) || seen.has(tag[1])) continue;
      seen.add(tag[1]);
      out.push(tag[1]);
    }
  }
  return out;
}

export function referencedSectionAddress(event: Event): string | null {
  for (const addr of libraryAddresses(event)) {
    if (parseAddress(addr)?.kind === KIND.SECTION) return addr;
  }
  return null;
}

/** Prefer edition/wiki/spec over a section so landing rows group by work. */
export function referencedLibraryAddress(event: Event): string | null {
  let section: string | null = null;
  for (const addr of libraryAddresses(event)) {
    const parsed = parseAddress(addr);
    if (!parsed) continue;
    if (parsed.kind !== KIND.SECTION) return addr;
    section ??= addr;
  }
  return section;
}

function taggedLibraryKind(event: Event): boolean {
  return event.tags.some(
    (t) => (t[0] === 'K' || t[0] === 'k') && t[1] != null && isLibraryKind(Number(t[1]))
  );
}

/** Kind 1111 whose root or parent is a publication, section, wiki, or spec. */
export function isLibraryComment(event: Event): boolean {
  if (event.kind !== KIND.COMMENT) return false;
  return taggedLibraryKind(event) || libraryAddress(event) != null;
}

/** Kind 9802 that references a library a-tag — not an i-tag website highlight. */
export function isLibraryHighlight(event: Event): boolean {
  if (event.kind !== KIND.HIGHLIGHT) return false;
  return libraryAddress(event) != null;
}

export function addressPath(coord: string): string | null {
  const parsed = parseAddress(coord);
  if (!parsed) return null;
  const npub = nip19.npubEncode(parsed.pubkey);
  const d = encodeURIComponent(parsed.d);
  if (parsed.kind === KIND.SPEC) return `/spec/d/${d}/p/${npub}`;
  if (parsed.kind === KIND.WIKI) return `/wiki/d/${d}/p/${npub}`;
  if (parsed.kind === KIND.LONG_FORM) return `/article/d/${d}/p/${npub}`;
  return `/publication/d/${d}/p/${npub}`;
}

/** Newest event per referenced work (edition/wiki/spec, else section). */
export function newestPerReferencedWork(
  events: Event[],
  keep: (event: Event) => boolean
): Event[] {
  const byAddr = new Map<string, Event>();
  for (const event of events) {
    if (!keep(event)) continue;
    const addr = referencedLibraryAddress(event);
    if (!addr) continue;
    const prev = byAddr.get(addr);
    if (!prev || isNewerReplaceable(event, prev)) byAddr.set(addr, event);
  }
  return [...byAddr.values()].sort((a, b) => b.created_at - a.created_at);
}

/** Newest highlight per work. */
export function newestHighlightPerAddress(events: Event[]): Event[] {
  return newestPerReferencedWork(events, isLibraryHighlight);
}

/** Newest comment per work — not the whole thread. */
export function newestCommentPerWork(events: Event[]): Event[] {
  return newestPerReferencedWork(events, isLibraryComment);
}
