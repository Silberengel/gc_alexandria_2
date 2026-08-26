import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { firstTag, eventAddress } from './nostr/verify';
import { coverTitle, humanizeTag } from './cover-fallback';
import { displayTitle } from './metadata';

export type TocEntry = {
  pos: number;
  title: string;
  address?: string;
  id?: string;
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

export function parseToc(raw: unknown[] | null, publication: Event): TocEntry[] {
  if (raw?.length) {
    return raw
      .map((item, i) => {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const title = humanizeHeading(String(o.title ?? o.T ?? o.name ?? `Section ${i + 1}`));
          const pos = Number(o.pos ?? o.position ?? i);
          const address =
            typeof o.a === 'string'
              ? o.a
              : typeof o.address === 'string'
                ? o.address
                : undefined;
          const id = typeof o.id === 'string' ? o.id : undefined;
          return { pos: Number.isFinite(pos) ? pos : i, title, address, id };
        }
        return { pos: i, title: humanizeHeading(String(item)) };
      })
      .sort((a, b) => a.pos - b.pos);
  }
  const entries: TocEntry[] = [];
  let pos = 0;
  for (const tag of publication.tags) {
    if (tag[0] === 'a' && tag[1]) {
      const d = tag[1].split(':').slice(2).join(':');
      entries.push({
        pos,
        title: d ? humanizeHeading(d) : `Section ${pos + 1}`,
        address: tag[1]
      });
      pos += 1;
    } else if (tag[0] === 'e' && tag[1]) {
      entries.push({ pos, title: `Section ${pos + 1}`, id: tag[1] });
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

export function enrichToc(toc: TocEntry[], sections: Event[]): TocEntry[] {
  if (!sections.length) return toc;
  if (!toc.length) {
    return sections.map((section, i) => ({
      pos: i,
      title: sectionHeading(section),
      address: eventAddress(section),
      id: section.id
    }));
  }
  const used = new Set<string>();
  return toc.map((entry, i) => {
    const indexed = sections[i];
    const hit =
      sections.find((s) => !used.has(s.id) && sectionMatchesEntry(s, entry)) ??
      (indexed && !used.has(indexed.id) ? indexed : undefined);
    if (!hit) return entry;
    used.add(hit.id);
    return {
      ...entry,
      title: sectionHeading(hit),
      address: entry.address ?? eventAddress(hit),
      id: entry.id ?? hit.id
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
