import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import { parseAddress } from './library-scope';
import { firstTag, eventAddress } from './nostr/verify';
import { coverTitle, humanizeTag } from './cover-fallback';
import { displayTitle } from './metadata';

export type TocEntry = {
  pos: number;
  title: string;
  address?: string;
  id?: string;
  /** Nesting depth under the root edition (0 = direct child). */
  depth: number;
  /** True for nested kind-30040 index headings (Mercury /toc). */
  index?: boolean;
  kind?: number;
};

export function naddrFor(event: Event): string {
  return nip19.naddrEncode({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: firstTag(event, 'd') ?? ''
  });
}

export function isUnreadableMeta(meta: Record<string, unknown> | null): boolean {
  if (!meta) return false;
  if (meta.readable === false || meta.unreadable === true || meta.ok === false) return true;
  return false;
}

export function sectionHeading(event: Event): string {
  return coverTitle(event);
}

export function humanizeHeading(title: string): string {
  const raw = title.trim();
  if (!raw) return 'Untitled';
  if (/^Section \d+$/i.test(raw)) return raw;
  return humanizeTag(raw) || raw;
}

function isPublicationIndexKind(kind: number | undefined): boolean {
  return kind === KIND.PUBLICATION;
}

function tocAddressFromItem(o: Record<string, unknown>, fallbackKind?: number): string | undefined {
  if (typeof o.a === 'string' && o.a.includes(':')) return o.a;
  if (typeof o.address === 'string' && o.address.includes(':')) return o.address;
  const embedded = o.event;
  if (embedded && typeof embedded === 'object') {
    const ev = embedded as Partial<Event>;
    if (typeof ev.kind === 'number' && typeof ev.pubkey === 'string' && Array.isArray(ev.tags)) {
      const d = firstTag(ev as Event, 'd');
      if (d != null) return `${ev.kind}:${ev.pubkey.toLowerCase()}:${d}`;
    }
  }
  const kind = Number(o.kind ?? fallbackKind);
  const d = typeof o.d === 'string' ? o.d : undefined;
  const pubkey =
    typeof o.pubkey === 'string'
      ? o.pubkey
      : embedded && typeof embedded === 'object' && typeof (embedded as { pubkey?: string }).pubkey === 'string'
        ? (embedded as { pubkey: string }).pubkey
        : undefined;
  if (Number.isInteger(kind) && pubkey && /^[0-9a-f]{64}$/i.test(pubkey) && d != null) {
    return `${kind}:${pubkey.toLowerCase()}:${d}`;
  }
  return undefined;
}

function childAddressesFromItem(o: Record<string, unknown>): string[] {
  const embedded = o.event;
  if (!embedded || typeof embedded !== 'object') return [];
  const tags = (embedded as { tags?: string[][] }).tags;
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const tag of tags) {
    if (tag[0] === 'a' && tag[1] && parseAddress(tag[1])) out.push(tag[1]);
  }
  return out;
}

/** Assign nesting depth from parent/child a-tag links among ToC index entries. */
export function assignTocDepths(entries: TocEntry[], childAddrs: Map<string, string[]>): TocEntry[] {
  if (entries.length < 2) {
    return entries.map((e) => ({ ...e, depth: e.depth ?? 0 }));
  }
  const byAddr = new Map<string, TocEntry>();
  for (const entry of entries) {
    if (entry.address) byAddr.set(entry.address.toLowerCase(), entry);
  }
  const parentOf = new Map<string, string>();
  for (const [addr, children] of childAddrs) {
    for (const child of children) {
      const key = child.toLowerCase();
      if (!byAddr.has(key) || parentOf.has(key)) continue;
      parentOf.set(key, addr.toLowerCase());
    }
  }

  function depthOf(addr: string, walking: Set<string>): number {
    if (walking.has(addr)) return 0;
    const parent = parentOf.get(addr);
    if (!parent) return 0;
    walking.add(addr);
    return 1 + depthOf(parent, walking);
  }

  return entries.map((entry) => {
    if (!entry.address) return { ...entry, depth: entry.depth ?? 0 };
    return { ...entry, depth: depthOf(entry.address.toLowerCase(), new Set()) };
  });
}

export function parseToc(raw: unknown[] | null, publication: Event): TocEntry[] {
  if (raw?.length) {
    const childAddrs = new Map<string, string[]>();
    const entries: TocEntry[] = raw.map((item, i) => {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const kind = Number(o.kind);
        const address = tocAddressFromItem(o, Number.isFinite(kind) ? kind : undefined);
        const title = humanizeHeading(
          String(
            o.title ??
              o.T ??
              o.name ??
              (typeof o.d === 'string' ? o.d : undefined) ??
              `Section ${i + 1}`
          )
        );
        const pos = Number(o.pos ?? o.position ?? i);
        const id = typeof o.id === 'string' ? o.id : undefined;
        const index =
          isPublicationIndexKind(kind) ||
          Boolean(address && parseAddress(address)?.kind === KIND.PUBLICATION);
        if (address) childAddrs.set(address.toLowerCase(), childAddressesFromItem(o));
        return {
          pos: Number.isFinite(pos) ? pos : i,
          title,
          address,
          id,
          depth: 0,
          index,
          kind: Number.isFinite(kind) ? kind : address ? parseAddress(address)?.kind : undefined
        };
      }
      return { pos: i, title: humanizeHeading(String(item)), depth: 0 };
    });
    return assignTocDepths(entries, childAddrs).sort((a, b) => a.pos - b.pos);
  }
  const entries: TocEntry[] = [];
  let pos = 0;
  for (const tag of publication.tags) {
    if (tag[0] === 'a' && tag[1]) {
      const parsed = parseAddress(tag[1]);
      const d = parsed?.d ?? tag[1].split(':').slice(2).join(':');
      entries.push({
        pos,
        title: d ? humanizeHeading(d) : `Section ${pos + 1}`,
        address: tag[1],
        depth: 0,
        index: parsed?.kind === KIND.PUBLICATION,
        kind: parsed?.kind
      });
      pos += 1;
    } else if (tag[0] === 'e' && tag[1]) {
      entries.push({ pos, title: `Section ${pos + 1}`, id: tag[1], depth: 0 });
      pos += 1;
    }
  }
  return entries;
}

function sectionMatchesEntry(section: Event, entry: TocEntry): boolean {
  if (entry.address) {
    if (eventAddress(section) === entry.address) return true;
    const d = entry.address.includes(':')
      ? entry.address.split(':').slice(2).join(':')
      : entry.address;
    if (d && firstTag(section, 'd') === d) return true;
  }
  if (entry.id && section.id === entry.id) return true;
  const d = firstTag(section, 'd');
  if (d && (entry.title === d || entry.title === humanizeHeading(d))) return true;
  return false;
}

function isIndexEntry(entry: TocEntry): boolean {
  if (entry.index) return true;
  if (isPublicationIndexKind(entry.kind)) return true;
  if (entry.address && parseAddress(entry.address)?.kind === KIND.PUBLICATION) return true;
  return false;
}

export function enrichToc(toc: TocEntry[], sections: Event[]): TocEntry[] {
  if (!sections.length) return toc;
  if (!toc.length) {
    return sections.map((section, i) => ({
      pos: i,
      title: sectionHeading(section),
      address: eventAddress(section),
      id: section.id,
      depth: 0,
      index: section.kind === KIND.PUBLICATION,
      kind: section.kind
    }));
  }
  const used = new Set<string>();
  return toc.map((entry) => {
    // Nested 30040 headings keep their own titles — never bind to a section body by list index.
    if (isIndexEntry(entry)) return entry;
    const hit = sections.find((s) => !used.has(s.id) && sectionMatchesEntry(s, entry));
    if (!hit) return entry;
    used.add(hit.id);
    return {
      ...entry,
      title: sectionHeading(hit),
      address: entry.address ?? eventAddress(hit),
      id: entry.id ?? hit.id,
      kind: entry.kind ?? hit.kind
    };
  });
}

export function hexFromNpubParam(raw: string): string {
  try {
    const decoded = nip19.decode(raw);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    /* hex */
  }
  return raw.toLowerCase();
}

export function decodePublicationPointer(naddrOrNevent: string): {
  kind?: number;
  pubkey?: string;
  d?: string;
  id?: string;
} | null {
  try {
    const decoded = nip19.decode(naddrOrNevent);
    if (decoded.type === 'naddr') {
      return { kind: decoded.data.kind, pubkey: decoded.data.pubkey, d: decoded.data.identifier };
    }
    if (decoded.type === 'nevent') {
      return { id: decoded.data.id, kind: decoded.data.kind, pubkey: decoded.data.author };
    }
    if (decoded.type === 'note') {
      return { id: decoded.data };
    }
  } catch {
    return null;
  }
  return null;
}

export { eventAddress, displayTitle };
