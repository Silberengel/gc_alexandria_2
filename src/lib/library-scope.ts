import { nip19, type Event } from 'nostr-tools';
import { KIND } from './constants';

const LIBRARY_KINDS = new Set<number>([KIND.PUBLICATION, KIND.SECTION, KIND.WIKI, KIND.SPEC]);

export const LIBRARY_KIND_TAGS = [...LIBRARY_KINDS].map(String);

export function isLibraryKind(kind: number): boolean {
  return LIBRARY_KINDS.has(kind);
}

export function parseAddress(coord: string): { kind: number; pubkey: string; d: string } | null {
  const parts = coord.split(':');
  if (parts.length < 3) return null;
  const kind = Number(parts[0]);
  const pubkey = parts[1]?.toLowerCase();
  const d = parts.slice(2).join(':');
  if (!Number.isInteger(kind) || !pubkey || !/^[0-9a-f]{64}$/.test(pubkey)) return null;
  return { kind, pubkey, d };
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
  if (parsed.kind === KIND.WIKI || parsed.kind === KIND.SPEC) return `/wiki/d/${d}/p/${npub}`;
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
    if (!prev || event.created_at > prev.created_at) byAddr.set(addr, event);
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
