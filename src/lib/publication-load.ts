import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import { parseAddress } from './library-scope';
import { firstTag, eventAddress } from './nostr/verify';
import { coverTitle, humanizeTag } from './cover-fallback';
import { displayTitle } from './metadata';
import { publicationCoordinateLookupKeys } from './publication-coordinate';
import { bibleDisplay, isBibleSection } from './bible-verse';

export type TocEntry = {
  pos: number;
  title: string;
  address?: string;
  id?: string;
  /** Nesting depth under the root edition (0 = edition itself). */
  depth: number;
  /** True for kind-30040 index headings (edition or nested). */
  index?: boolean;
  /** True for the top-level edition ToC row (link to publication top). */
  root?: boolean;
  kind?: number;
  /** Embedded index event from Mercury /toc (for reading-pane headings). */
  event?: Event;
};

export function naddrFor(event: Event): string {
  return nip19.naddrEncode({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: firstTag(event, 'd') ?? ''
  });
}

/** Clipboard target for a section/event: naddr when addressable, else nevent. */
export function copyPointerForEvent(event: Event): { label: 'Copy naddr' | 'Copy nevent'; text: string } {
  const d = firstTag(event, 'd');
  if (d != null && event.kind >= 30_000 && event.kind < 40_000) {
    return { label: 'Copy naddr', text: naddrFor(event) };
  }
  return {
    label: 'Copy nevent',
    text: nip19.neventEncode({
      id: event.id,
      kind: event.kind,
      author: event.pubkey
    })
  };
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

/**
 * Short label for an index d-tag when Mercury omits title
 * (e.g. `…-category-politics` → `Politics`).
 */
export function shortIndexTitle(d: string): string {
  const raw = d.trim();
  if (!raw) return 'Untitled';
  const category = raw.match(/(?:^|-)category-(.+)$/i);
  if (category?.[1]) return humanizeHeading(category[1]);
  const parts = raw.split('-').filter(Boolean);
  if (parts.length > 5) return humanizeHeading(parts.slice(-2).join('-'));
  return humanizeHeading(raw);
}

function isPublicationIndexKind(kind: number | undefined): boolean {
  return kind === KIND.PUBLICATION;
}

function tocAddressFromItem(
  o: Record<string, unknown>,
  fallbackKind?: number,
  fallbackPubkey?: string
): string | undefined {
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
        : fallbackPubkey;
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

export type TocNode = {
  entry: TocEntry;
  children: TocNode[];
};

/** Among siblings, leaf sections before nested 30040 indexes (stable within each group). */
export function preferSectionsBeforeIndexes(nodes: TocNode[]): TocNode[] {
  const sorted = [...nodes].sort((a, b) => {
    const ai = a.entry.index ? 1 : 0;
    const bi = b.entry.index ? 1 : 0;
    return ai - bi;
  });
  return sorted.map((node) => ({
    ...node,
    children: preferSectionsBeforeIndexes(node.children)
  }));
}

/** Nest a depth-annotated flat ToC into a tree for expandable rendering. */
export function buildTocTree(entries: TocEntry[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const entry of entries) {
    const node: TocNode = { entry, children: [] };
    const depth = entry.depth ?? 0;
    while (stack.length && (stack[stack.length - 1]?.entry.depth ?? 0) >= depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return preferSectionsBeforeIndexes(roots);
}

export function tocEntryKey(entry: TocEntry): string {
  return entry.address ?? entry.id ?? `pos:${entry.pos}`;
}

/**
 * Which ToC row matches the reading pane: exact section id/address, else the
 * nearest preceding corpus section that appears in the ToC (index or leaf).
 */
export function activeTocEntry(
  toc: TocEntry[],
  opts: {
    pos: number;
    sectionId?: string;
    /** Corpus in document order (may be denser than the ToC). */
    corpus?: Event[];
  }
): TocEntry | null {
  if (!toc.length) return null;
  const { pos, sectionId, corpus } = opts;

  if (sectionId) {
    const byId = toc.find((e) => e.id?.toLowerCase() === sectionId.toLowerCase());
    if (byId) return byId;
  }

  if (corpus?.length) {
    const byId = new Map<string, TocEntry>();
    const byAddr = new Map<string, TocEntry>();
    for (const entry of toc) {
      if (entry.id) byId.set(entry.id.toLowerCase(), entry);
      if (entry.address) {
        for (const key of publicationCoordinateLookupKeys(entry.address)) {
          byAddr.set(key.toLowerCase(), entry);
        }
      }
    }
    const start = Math.min(Math.max(0, Math.floor(pos)), corpus.length - 1);
    for (let i = start; i >= 0; i--) {
      const section = corpus[i];
      if (!section) continue;
      const hit =
        byId.get(section.id.toLowerCase()) ??
        (() => {
          for (const key of publicationCoordinateLookupKeys(eventAddress(section))) {
            const e = byAddr.get(key.toLowerCase());
            if (e) return e;
          }
          return undefined;
        })();
      if (hit) return hit;
    }
  }

  let best: TocEntry | null = null;
  for (const entry of toc) {
    if (entry.pos > pos + 1e-9) continue;
    if (
      !best ||
      entry.pos > best.pos ||
      (entry.pos === best.pos && (entry.depth ?? 0) > (best.depth ?? 0))
    ) {
      best = entry;
    }
  }
  return best;
}

/** Ancestor keys (root → parent) for a ToC node; empty if the key is missing. */
export function tocPathKeys(nodes: TocNode[], targetKey: string): string[] {
  const walk = (list: TocNode[], trail: string[]): string[] | null => {
    for (const node of list) {
      const key = tocEntryKey(node.entry);
      const next = [...trail, key];
      if (key === targetKey) return next;
      const child = walk(node.children, next);
      if (child) return child;
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}

/** Non-30040 children from an index event (Mercury /toc embeds the event). */
function leafEntriesFromItem(
  o: Record<string, unknown>,
  parent: TocEntry
): TocEntry[] {
  return childEntriesFromItem(o, parent, { indexes: false });
}

/** Children from an index event; optionally include nested 30040 indexes. */
function childEntriesFromItem(
  o: Record<string, unknown>,
  parent: TocEntry,
  opts: { indexes: boolean }
): TocEntry[] {
  const embedded = o.event;
  if (!embedded || typeof embedded !== 'object') return [];
  const tags = (embedded as { tags?: string[][] }).tags;
  if (!Array.isArray(tags)) return [];
  const out: TocEntry[] = [];
  const depth = (parent.depth ?? 0) + 1;
  const step = Math.pow(10, -3 * depth);
  let n = 0;
  for (const tag of tags) {
    if (tag[0] === 'a' && tag[1]) {
      const parsed = parseAddress(tag[1]);
      if (!parsed) continue;
      const index = parsed.kind === KIND.PUBLICATION;
      if (index && !opts.indexes) continue;
      out.push({
        pos: parent.pos + (n + 1) * step,
        title: parsed.d
          ? index
            ? shortIndexTitle(parsed.d)
            : humanizeHeading(parsed.d)
          : `Section ${n + 1}`,
        address: tag[1],
        depth,
        index,
        kind: parsed.kind
      });
      n += 1;
    } else if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
      out.push({
        pos: parent.pos + (n + 1) * step,
        title: `Section ${n + 1}`,
        id: tag[1],
        depth,
        index: false
      });
      n += 1;
    }
  }
  return out;
}

function partitionRootTags(publication: Event): TocEntry[] {
  const sections: TocEntry[] = [];
  const indexes: TocEntry[] = [];
  for (const tag of publication.tags) {
    if (tag[0] === 'a' && tag[1]) {
      const parsed = parseAddress(tag[1]);
      const d = parsed?.d ?? tag[1].split(':').slice(2).join(':');
      const entry: TocEntry = {
        pos: 0,
        title: d ? humanizeHeading(d) : 'Section',
        address: tag[1],
        depth: 0,
        index: parsed?.kind === KIND.PUBLICATION,
        kind: parsed?.kind
      };
      if (entry.index) indexes.push(entry);
      else sections.push(entry);
    } else if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
      sections.push({
        pos: 0,
        title: 'Section',
        id: tag[1],
        depth: 0
      });
    }
  }
  // Sections first, then nested 30040s — renumber pos in that order.
  return [...sections, ...indexes].map((entry, i) => ({
    ...entry,
    pos: i,
    title:
      entry.title === 'Section' && !entry.address
        ? `Section ${i + 1}`
        : entry.title === 'Section' && entry.address
          ? humanizeHeading(parseAddress(entry.address)?.d ?? entry.title)
          : entry.title
  }));
}

/** Direct non-30040 children of the edition (Mercury /toc is indexes-only). */
function rootLeafEntries(publication: Event): TocEntry[] {
  const out: TocEntry[] = [];
  for (const tag of publication.tags) {
    if (tag[0] === 'a' && tag[1]) {
      const parsed = parseAddress(tag[1]);
      if (!parsed || parsed.kind === KIND.PUBLICATION) continue;
      out.push({
        pos: 0,
        title: parsed.d ? humanizeHeading(parsed.d) : 'Section',
        address: tag[1],
        depth: 0,
        index: false,
        kind: parsed.kind
      });
    } else if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
      out.push({
        pos: 0,
        title: 'Section',
        id: tag[1],
        depth: 0,
        index: false
      });
    }
  }
  // Negative pos so edition sections sort before Mercury index rows (pos ≥ 0).
  return out.map((entry, i) => ({
    ...entry,
    pos: i - out.length,
    title: entry.title === 'Section' ? `Section ${i + 1}` : entry.title
  }));
}

export function parseToc(raw: unknown[] | null, publication: Event): TocEntry[] {
  if (raw?.length) {
    const childAddrs = new Map<string, string[]>();
    const rawByKey = new Map<string, Record<string, unknown>>();
    const entries: TocEntry[] = raw.map((item, i) => {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const kind = Number(o.kind);
        const address = tocAddressFromItem(
          o,
          Number.isFinite(kind) ? kind : undefined,
          publication.pubkey
        );
        const rawTitle =
          (typeof o.title === 'string' && o.title.trim()) ||
          (typeof o.T === 'string' && o.T.trim()) ||
          (typeof o.name === 'string' && o.name.trim()) ||
          '';
        const d = typeof o.d === 'string' ? o.d : address ? parseAddress(address)?.d : undefined;
        const index =
          isPublicationIndexKind(kind) ||
          Boolean(address && parseAddress(address)?.kind === KIND.PUBLICATION);
        const title = humanizeHeading(
          rawTitle || (index && d ? shortIndexTitle(d) : d ? d : `Section ${i + 1}`)
        );
        const pos = Number(o.pos ?? o.position ?? i);
        const id = typeof o.id === 'string' ? o.id : undefined;
        if (address) {
          childAddrs.set(address.toLowerCase(), childAddressesFromItem(o));
          rawByKey.set(address.toLowerCase(), o);
        }
        if (id) rawByKey.set(id.toLowerCase(), o);
        const embedded =
          o.event && typeof o.event === 'object' && typeof (o.event as Event).kind === 'number'
            ? (o.event as Event)
            : undefined;
        return {
          pos: Number.isFinite(pos) ? pos : i,
          title,
          address,
          id,
          depth: 0,
          index,
          kind: Number.isFinite(kind) ? kind : address ? parseAddress(address)?.kind : undefined,
          event: index ? embedded : undefined
        };
      }
      return { pos: i, title: humanizeHeading(String(item)), depth: 0 };
    });
    const withDepth = assignTocDepths(entries, childAddrs).sort((a, b) => a.pos - b.pos);
    const leaves: TocEntry[] = [];
    const seenLeaf = new Set<string>();
    for (const entry of withDepth) {
      if (!entry.index) continue;
      const o =
        (entry.address && rawByKey.get(entry.address.toLowerCase())) ||
        (entry.id && rawByKey.get(entry.id.toLowerCase())) ||
        null;
      if (!o) continue;
      for (const leaf of leafEntriesFromItem(o, entry)) {
        const key = tocEntryKey(leaf);
        if (seenLeaf.has(key)) continue;
        // Skip if this leaf is already a ToC row (e.g. also listed as its own index).
        if (withDepth.some((e) => tocEntryKey(e) === key)) continue;
        seenLeaf.add(key);
        leaves.push(leaf);
      }
    }
    const mercury = [...withDepth, ...leaves];
    const seen = new Set(mercury.map((e) => tocEntryKey(e)));
    // Edition-level sections belong before nested indexes (Mercury /toc omits them).
    const rootLeaves = rootLeafEntries(publication).filter((e) => !seen.has(tocEntryKey(e)));
    return withEditionRoot(
      publication,
      [...rootLeaves, ...mercury].sort(
        (a, b) => a.pos - b.pos || Number(!!a.index) - Number(!!b.index)
      )
    );
  }
  return withEditionRoot(publication, partitionRootTags(publication));
}

/** Prepend the top-level 30040 as ToC root (title link → publication top). */
export function withEditionRoot(publication: Event, entries: TocEntry[]): TocEntry[] {
  if (publication.kind !== KIND.PUBLICATION) return entries;
  const addr = eventAddress(publication);
  const addrKey = addr.toLowerCase();
  if (entries.some((e) => e.root || (e.address && e.address.toLowerCase() === addrKey))) {
    return entries;
  }
  const root: TocEntry = {
    pos: -1000,
    title: sectionHeading(publication),
    address: addr,
    id: publication.id,
    depth: 0,
    index: true,
    root: true,
    kind: KIND.PUBLICATION,
    event: publication
  };
  return [
    root,
    ...entries.map((entry) => ({
      ...entry,
      depth: (entry.depth ?? 0) + 1
    }))
  ];
}

/**
 * Ensure edition / nested 30040 events from the ToC appear in the reading pane.
 * Uses embedded or already-fetched events only — never invents placeholders here
 * (those block relay fetches for indexes Mercury listed without an embed).
 */
export function ensureIndexHeadings(sections: Event[], toc: TocEntry[]): Event[] {
  if (!toc.length) return sections;
  const have = new Set<string>();
  for (const section of sections) {
    if (isPlaceholderIndex(section)) continue;
    have.add(section.id.toLowerCase());
    have.add(eventAddress(section).toLowerCase());
  }
  const extra: Event[] = [];
  for (const entry of toc) {
    if (!entry.index) continue;
    if (entry.id && have.has(entry.id.toLowerCase())) continue;
    if (entry.address && have.has(entry.address.toLowerCase())) continue;
    const ev = entry.event?.kind === KIND.PUBLICATION ? entry.event : null;
    if (!ev || isPlaceholderIndex(ev)) continue;
    if (have.has(ev.id.toLowerCase())) continue;
    have.add(ev.id.toLowerCase());
    have.add(eventAddress(ev).toLowerCase());
    extra.push(ev);
  }
  if (!extra.length) return dropSupersededPlaceholders(sections);
  return dropSupersededPlaceholders([...sections, ...extra]);
}

/** Synthetic title-only index (created_at 0, zero sig) used when relays have no event. */
export function isPlaceholderIndex(event: Event): boolean {
  return event.kind === KIND.PUBLICATION && event.created_at === 0 && /^0+$/.test(event.sig);
}

/** Drop placeholder 30040s when a real event for the same address is present. */
export function dropSupersededPlaceholders(sections: Event[]): Event[] {
  const realAddrs = new Set(
    sections.filter((e) => !isPlaceholderIndex(e)).map((e) => eventAddress(e).toLowerCase())
  );
  return sections.filter(
    (e) => !isPlaceholderIndex(e) || !realAddrs.has(eventAddress(e).toLowerCase())
  );
}

/** Merge section lists by id, preferring real events over placeholders. */
export function mergePublicationSections(...lists: Event[][]): Event[] {
  const byId = new Map<string, Event>();
  for (const list of lists) {
    for (const event of list) {
      const cur = byId.get(event.id);
      if (!cur || (isPlaceholderIndex(cur) && !isPlaceholderIndex(event))) {
        byId.set(event.id, event);
      }
    }
  }
  return dropSupersededPlaceholders([...byId.values()]);
}

/** Stable secondary key for bible leaves missing from the a-tag walk. */
function bibleSortKey(event: Event): [number, number, number] {
  if (!isBibleSection(event)) return [2, 0, 0];
  const disp = bibleDisplay(event);
  if (disp.kind === 'heading') return [0, 0, 0];
  return [1, Number(disp.chapter) || 0, Number(disp.verse) || 0];
}

/**
 * Document order: depth-first walk of a/e tags from the edition root through
 * loaded indexes. Mercury /stream pages arrive unordered; ToC is often
 * indexes-only — tag order on each parent is the authoritative sequence.
 * Optional `limit` stops the walk early so huge corpora do not freeze the UI.
 */
export function orderPublicationSections(
  list: Event[],
  opts?: { root?: Event | null; toc?: TocEntry[]; limit?: number }
): Event[] {
  if (list.length < 2) return list;

  const byId = new Map<string, Event>();
  const byAddr = new Map<string, Event>();
  for (const event of list) {
    byId.set(event.id.toLowerCase(), event);
    for (const key of publicationCoordinateLookupKeys(eventAddress(event))) {
      byAddr.set(key.toLowerCase(), event);
    }
  }

  const tocRank = new Map<string, number>();
  for (const entry of opts?.toc ?? []) {
    if (entry.address) tocRank.set(entry.address.toLowerCase(), entry.pos);
    if (entry.id) tocRank.set(entry.id.toLowerCase(), entry.pos);
  }

  const resolveChild = (tag: string[]): Event | undefined => {
    if (tag[0] === 'a' && tag[1]) {
      for (const key of publicationCoordinateLookupKeys(tag[1])) {
        const hit = byAddr.get(key.toLowerCase());
        if (hit) return hit;
      }
      return undefined;
    }
    if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
      return byId.get(tag[1].toLowerCase());
    }
    return undefined;
  };

  const limit = opts?.limit != null && opts.limit > 0 ? opts.limit : Infinity;
  const ordered: Event[] = [];
  const seen = new Set<string>();
  const visit = (event: Event) => {
    if (seen.has(event.id) || ordered.length >= limit) return;
    seen.add(event.id);
    ordered.push(event);
    if (ordered.length >= limit) return;
    for (const tag of event.tags) {
      if (ordered.length >= limit) return;
      const child = resolveChild(tag);
      if (child) visit(child);
    }
  };

  const root =
    opts?.root && byId.has(opts.root.id.toLowerCase())
      ? byId.get(opts.root.id.toLowerCase())!
      : null;
  if (root) visit(root);

  if (ordered.length >= limit) {
    const rest: Event[] = [];
    for (const event of list) {
      if (!seen.has(event.id)) rest.push(event);
    }
    return [...ordered, ...rest];
  }

  const leftoverIndex = new Map<string, number>();
  const leftovers: Event[] = [];
  for (let i = 0; i < list.length; i++) {
    const event = list[i]!;
    if (seen.has(event.id)) continue;
    leftoverIndex.set(event.id, i);
    leftovers.push(event);
  }

  leftovers.sort((a, b) => {
    const ra =
      tocRank.get(eventAddress(a).toLowerCase()) ??
      tocRank.get(a.id.toLowerCase()) ??
      1_000_000_000;
    const rb =
      tocRank.get(eventAddress(b).toLowerCase()) ??
      tocRank.get(b.id.toLowerCase()) ??
      1_000_000_000;
    if (ra !== rb) return ra - rb;
    const ka = bibleSortKey(a);
    const kb = bibleSortKey(b);
    for (let i = 0; i < 3; i++) {
      if (ka[i]! !== kb[i]!) return ka[i]! - kb[i]!;
    }
    return (leftoverIndex.get(a.id) ?? 0) - (leftoverIndex.get(b.id) ?? 0);
  });

  return [...ordered, ...leftovers];
}

/** Bind fetched index events onto ToC rows and expand nested children from a-tags. */
export function expandTocFromSections(toc: TocEntry[], sections: Event[]): TocEntry[] {
  if (!toc.length || !sections.length) return toc;
  const byAddr = new Map<string, Event>();
  for (const section of sections) {
    if (section.kind !== KIND.PUBLICATION || isPlaceholderIndex(section)) continue;
    for (const key of publicationCoordinateLookupKeys(eventAddress(section))) {
      byAddr.set(key.toLowerCase(), section);
    }
  }

  const lookup = (address: string): Event | undefined => {
    for (const key of publicationCoordinateLookupKeys(address)) {
      const hit = byAddr.get(key.toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  };

  // Only dump direct leaf sections from indexes Mercury already listed — never from
  // nested books/chapters discovered below (a Bible would explode the ToC).
  const originalIndexKeys = new Set(
    toc
      .filter((e) => e.index)
      .map((e) => (e.address ?? e.id ?? '').toLowerCase())
      .filter(Boolean)
  );

  let bound = toc.map((entry) => {
    if (!entry.index || !entry.address) return entry;
    const hit = lookup(entry.address);
    if (!hit) return entry;
    return {
      ...entry,
      id: hit.id,
      title: sectionHeading(hit) || entry.title,
      event: hit
    };
  });

  // Multi-pass: nest 30040 indexes only (OT → book → chapter). Skip verse leaves here.
  for (let pass = 0; pass < 8; pass++) {
    const seen = new Set(bound.map((e) => tocEntryKey(e)));
    const extra: TocEntry[] = [];
    for (const entry of bound) {
      if (!entry.index || entry.root || !entry.event) continue;
      for (const child of childEntriesFromItem({ event: entry.event }, entry, { indexes: true })) {
        if (!child.index) continue;
        const key = tocEntryKey(child);
        if (seen.has(key)) continue;
        seen.add(key);
        const hit = child.address ? lookup(child.address) : undefined;
        if (hit) {
          extra.push({
            ...child,
            id: hit.id,
            title: sectionHeading(hit) || child.title,
            event: hit
          });
        } else {
          extra.push(child);
        }
      }
    }
    if (!extra.length) break;
    bound = [...bound, ...extra];
  }

  // One-level leaf sections under the original (Mercury) indexes only.
  const seen = new Set(bound.map((e) => tocEntryKey(e)));
  const leaves: TocEntry[] = [];
  for (const entry of bound) {
    if (!entry.index || entry.root || !entry.event) continue;
    const key = (entry.address ?? entry.id ?? '').toLowerCase();
    if (!originalIndexKeys.has(key)) continue;
    for (const leaf of childEntriesFromItem({ event: entry.event }, entry, { indexes: false })) {
      const leafKey = tocEntryKey(leaf);
      if (seen.has(leafKey)) continue;
      seen.add(leafKey);
      leaves.push(leaf);
    }
  }

  return [...bound, ...leaves].sort(
    (a, b) => a.pos - b.pos || Number(!!a.index) - Number(!!b.index)
  );
}

/** Deterministic placeholder id for ghost Mercury index rows (no published event). */
function placeholderEventId(seed: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < seed.length; i++) {
    bytes[i % 32] ^= seed.charCodeAt(i) & 0xff;
    bytes[(i + 7) % 32] = (bytes[(i + 7) % 32]! + seed.charCodeAt(i)) & 0xff;
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build a title-only 30040 when Mercury lists an index with no fetchable event. */
export function placeholderIndexEvent(entry: TocEntry): Event | null {
  if (!entry.index || !entry.address) return null;
  const parsed = parseAddress(entry.address);
  if (!parsed || parsed.kind !== KIND.PUBLICATION) return null;
  const title =
    entry.title && entry.title !== humanizeHeading(parsed.d)
      ? entry.title
      : shortIndexTitle(parsed.d);
  return {
    id: entry.id && /^[0-9a-f]{64}$/i.test(entry.id) ? entry.id.toLowerCase() : placeholderEventId(entry.address),
    pubkey: parsed.pubkey.toLowerCase(),
    created_at: 0,
    kind: KIND.PUBLICATION,
    tags: [
      ['d', parsed.d],
      ['title', title]
    ],
    content: '',
    sig: '0'.repeat(128)
  };
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
    // Never build a 1:1 ToC from tens of thousands of leaves — indexes only.
    const source =
      sections.length > 400
        ? sections.filter((s) => s.kind === KIND.PUBLICATION)
        : sections;
    return source.map((section, i) => ({
      pos: i,
      title: sectionHeading(section),
      address: eventAddress(section),
      id: section.id,
      depth: 0,
      index: section.kind === KIND.PUBLICATION,
      kind: section.kind
    }));
  }

  const byId = new Map<string, Event>();
  const byAddr = new Map<string, Event>();
  const byD = new Map<string, Event>();
  for (const section of sections) {
    byId.set(section.id.toLowerCase(), section);
    const addr = eventAddress(section);
    for (const key of publicationCoordinateLookupKeys(addr)) {
      byAddr.set(key.toLowerCase(), section);
    }
    const d = firstTag(section, 'd');
    if (d && !byD.has(d)) byD.set(d, section);
  }

  const used = new Set<string>();
  return toc.map((entry) => {
    // Nested 30040 headings keep their own titles — never bind to a section body by list index.
    if (isIndexEntry(entry)) return entry;
    let hit: Event | undefined;
    if (entry.id) hit = byId.get(entry.id.toLowerCase());
    if (!hit && entry.address) {
      for (const key of publicationCoordinateLookupKeys(entry.address)) {
        hit = byAddr.get(key.toLowerCase());
        if (hit) break;
      }
    }
    if (!hit && entry.address) {
      const d = entry.address.includes(':')
        ? entry.address.split(':').slice(2).join(':')
        : entry.address;
      if (d) hit = byD.get(d);
    }
    if (!hit || used.has(hit.id)) return entry;
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
  const cleaned = raw.trim().split('?')[0].split('#')[0];
  if (!cleaned) return '';
  try {
    const decoded = nip19.decode(cleaned);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    /* hex */
  }
  const hex = cleaned.toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : '';
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
