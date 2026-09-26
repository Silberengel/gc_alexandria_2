/**
 * Index-scoped reader for large / bible-typed publications and reading plans.
 * Contents stop at kind-30040 indexes; the pane paints one leaf index at a time.
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { parseAddress } from './library-scope';
import { memoryFindByAddress, memoryGetEvent, rememberEvents } from './nostr/event-memory';
import { eventAddress, firstTag } from './nostr/verify';
import {
  sectionHeading,
  shortIndexTitle,
  withEditionRoot,
  type TocEntry
} from './publication-load';

const PLAN_D = new Set(['biblestr-plan-bible-in-a-year', 'biblestr-plan-chronological']);

/** Whole-Bible verse counts look like this; day/chapter totals stay under ~400. */
const STALE_VERSE_TOTAL = 1000;

/** Direct nested 30040 children — plans (~365) and other huge roots trip this. */
const LARGE_INDEX_CHILDREN = 50;

/** Cap index warming so a broken tree cannot fan out forever. */
const MAX_WARM_INDEXES = 2_500;

export function hasBibleTypeTag(event: Event): boolean {
  return event.tags.some((t) => t[0] === 'type' && (t[1] ?? '').trim().toLowerCase() === 'bible');
}

export function countDirectPublicationChildren(event: Event): number {
  let n = 0;
  for (const tag of event.tags) {
    if (tag[0] !== 'a' || !tag[1]) continue;
    if (parseAddress(tag[1])?.kind === KIND.PUBLICATION) n += 1;
  }
  return n;
}

/**
 * Reading plans: known d-tags, or a root whose children are almost all `…-day-NNN` indexes.
 */
export function isReadingPlanEdition(edition: Event): boolean {
  if (edition.kind !== KIND.PUBLICATION) return false;
  const d = (firstTag(edition, 'd') ?? '').trim();
  if (PLAN_D.has(d)) return true;
  const kids = childAddresses(edition);
  if (kids.length < 30) return false;
  let days = 0;
  for (const coord of kids) {
    const parsed = parseAddress(coord);
    if (parsed?.kind === KIND.PUBLICATION && isPlanDayD(parsed.d)) days += 1;
  }
  return days >= 30 && days / kids.length >= 0.75;
}

/**
 * One-index reader: `type=bible`, reading plans, or roots with a very large nested index fan-out.
 */
export function isIndexScopedEdition(edition: Event): boolean {
  if (edition.kind !== KIND.PUBLICATION) return false;
  if (isReadingPlanEdition(edition)) return true;
  if (hasBibleTypeTag(edition)) return true;
  return countDirectPublicationChildren(edition) >= LARGE_INDEX_CHILDREN;
}

/** Plan day: `…-day-001` (not `…-day-001-r1`). */
export function isPlanDayD(d: string): boolean {
  return /(?:^|-)day-\d+$/i.test(d) && !/-day-\d+-r\d+$/i.test(d);
}

/** Plan reading heading under a day: `…-day-001-r1`. */
export function isPlanReadingD(d: string): boolean {
  return /-day-\d+-r\d+$/i.test(d);
}

function childAddresses(event: Event): string[] {
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'a' && tag[1]) out.push(tag[1]);
  }
  return out;
}

function lookupAddress(coord: string): Event | null {
  const parsed = parseAddress(coord);
  if (!parsed) return null;
  return memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d);
}

/** Plan day a-tags still missing from session memory (seed holes / cold cache). */
export function missingPlanDayAddresses(edition: Event): string[] {
  if (!isReadingPlanEdition(edition)) return [];
  const out: string[] = [];
  for (const coord of childAddresses(edition)) {
    const parsed = parseAddress(coord);
    if (!parsed || parsed.kind !== KIND.PUBLICATION) continue;
    if (!isPlanDayD(parsed.d)) continue;
    if (!lookupAddress(coord)) out.push(coord);
  }
  return out;
}

function titleForAddress(coord: string, hit: Event | null): string {
  if (hit) return sectionHeading(hit);
  const d = parseAddress(coord)?.d ?? '';
  return d ? shortIndexTitle(d) : 'Untitled';
}

/**
 * Contents for scoped editions: kind-30040 only.
 * Plans stop at days; Douay includes testament / book / chapter indexes.
 */
export function buildIndexScopedToc(edition: Event): TocEntry[] {
  const plan = isReadingPlanEdition(edition);
  const entries: TocEntry[] = [];
  const seen = new Set<string>();

  function walk(node: Event, depth: number, parentPos: number, sibling: number): void {
    const addr = eventAddress(node);
    const key = addr.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const d = firstTag(node, 'd') ?? '';
    if (plan && depth > 0 && !isPlanDayD(d)) return;

    const pos = depth === 0 ? -1000 : parentPos + (sibling + 1) * Math.pow(10, -3 * depth);
    entries.push({
      pos,
      title: sectionHeading(node),
      address: addr,
      id: node.id,
      depth,
      index: true,
      root: depth === 0,
      kind: KIND.PUBLICATION,
      event: node
    });

    if (plan && depth >= 1) return;

    let n = 0;
    for (const childAddr of childAddresses(node)) {
      const parsed = parseAddress(childAddr);
      if (!parsed || parsed.kind !== KIND.PUBLICATION) continue;
      if (plan && depth === 0 && !isPlanDayD(parsed.d)) continue;
      if (plan && depth >= 1) continue;
      const hit = lookupAddress(childAddr);
      if (hit) {
        walk(hit, depth + 1, pos, n);
      } else {
        const placeholderKey = childAddr.toLowerCase();
        if (seen.has(placeholderKey)) continue;
        seen.add(placeholderKey);
        entries.push({
          pos: pos + (n + 1) * Math.pow(10, -3 * (depth + 1)),
          title: titleForAddress(childAddr, null),
          address: childAddr,
          depth: depth + 1,
          index: true,
          kind: KIND.PUBLICATION
        });
      }
      n += 1;
    }
  }

  walk(edition, 0, 0, 0);
  return withEditionRoot(
    edition,
    entries.filter((e) => !e.root).sort((a, b) => a.pos - b.pos || a.depth - b.depth)
  );
}

/** True when this index paints verses directly (no nested 30040 children). */
export function isLeafIndex(event: Event): boolean {
  if (event.kind !== KIND.PUBLICATION) return false;
  let hasSection = false;
  let hasPub = false;
  for (const coord of childAddresses(event)) {
    const parsed = parseAddress(coord);
    if (!parsed) continue;
    if (parsed.kind === KIND.SECTION) hasSection = true;
    if (parsed.kind === KIND.PUBLICATION) hasPub = true;
  }
  return hasSection && !hasPub;
}

/**
 * Leaf indexes in contents order (plan days, or Douay chapters / preface leaves).
 * Days that only point at reading indexes still count once their reading has verses in memory,
 * or when the day itself is the selected unit (always for plans).
 */
export function listLeafIndexes(edition: Event, toc: TocEntry[]): Event[] {
  const plan = isReadingPlanEdition(edition);
  const out: Event[] = [];
  for (const entry of toc) {
    if (!entry.index || entry.root || !entry.address) continue;
    if (plan) {
      const d = parseAddress(entry.address)?.d ?? '';
      if (!isPlanDayD(d)) continue;
      const hit = entry.event ?? lookupAddress(entry.address);
      if (hit) out.push(hit);
      continue;
    }
    const hit = entry.event ?? lookupAddress(entry.address);
    if (!hit) continue;
    if (isLeafIndex(hit)) out.push(hit);
  }
  return out;
}

/** First chapter/day under an index, or the index itself when it is a leaf. */
export function resolvePaintIndex(target: Event, edition: Event, toc: TocEntry[]): Event | null {
  if (target.id === edition.id) {
    return listLeafIndexes(edition, toc)[0] ?? null;
  }
  if (isReadingPlanEdition(edition)) {
    const d = firstTag(target, 'd') ?? '';
    if (isPlanDayD(d)) return target;
    if (isPlanReadingD(d)) {
      // Climb: reading → day via memory walk of TOC days' children.
      for (const leaf of listLeafIndexes(edition, toc)) {
        if (childAddresses(leaf).some((a) => a.toLowerCase() === eventAddress(target).toLowerCase())) {
          return leaf;
        }
      }
    }
    return target;
  }
  if (isLeafIndex(target)) return target;
  // Book / testament: first leaf descendant in TOC order.
  const targetAddr = eventAddress(target).toLowerCase();
  const under: Event[] = [];
  let capturing = false;
  let targetDepth = -1;
  for (const entry of toc) {
    if ((entry.address ?? '').toLowerCase() === targetAddr) {
      capturing = true;
      targetDepth = entry.depth;
      const hit = entry.event ?? lookupAddress(entry.address!);
      if (hit && isLeafIndex(hit)) return hit;
      continue;
    }
    if (!capturing) continue;
    if (entry.depth <= targetDepth) break;
    const hit = entry.event ?? (entry.address ? lookupAddress(entry.address) : null);
    if (hit && isLeafIndex(hit)) under.push(hit);
  }
  return under[0] ?? null;
}

/**
 * Heading + nested reading indexes + verse sections for one leaf index.
 * Missing children are skipped (caller may fetch and retry).
 */
export function collectIndexPaintEvents(index: Event): Event[] {
  const out: Event[] = [];
  const seen = new Set<string>();

  function push(ev: Event): void {
    const id = ev.id.toLowerCase();
    if (seen.has(id)) return;
    seen.add(id);
    out.push(ev);
  }

  push(index);
  for (const childAddr of childAddresses(index)) {
    const hit = lookupAddress(childAddr);
    if (!hit) continue;
    push(hit);
    if (hit.kind === KIND.PUBLICATION) {
      for (const nested of childAddresses(hit)) {
        const leaf = lookupAddress(nested);
        if (leaf) push(leaf);
      }
    }
  }
  return out;
}

/** Addresses still missing from memory for a full paint of this index. */
export function missingPaintAddresses(index: Event): string[] {
  const missing: string[] = [];
  for (const childAddr of childAddresses(index)) {
    const hit = lookupAddress(childAddr);
    if (!hit) {
      missing.push(childAddr);
      continue;
    }
    if (hit.kind === KIND.PUBLICATION) {
      for (const nested of childAddresses(hit)) {
        if (!lookupAddress(nested)) missing.push(nested);
      }
    }
  }
  return missing;
}

export type ScopedProgress = {
  /** 0-based index among leaf indexes. */
  pos: number;
  total: number;
  sectionId: string;
  index: Event;
};

export function scopedProgressForIndex(
  edition: Event,
  toc: TocEntry[],
  index: Event
): ScopedProgress | null {
  const leaves = listLeafIndexes(edition, toc);
  if (!leaves.length) return null;
  const pos = leaves.findIndex((e) => e.id.toLowerCase() === index.id.toLowerCase());
  if (pos < 0) return null;
  return { pos, total: leaves.length, sectionId: index.id, index };
}

/**
 * Pick the leaf to open: saved day/chapter when valid, else the first.
 * Ignores old whole-Bible verse positions.
 */
export function pickScopedOpenIndex(
  edition: Event,
  toc: TocEntry[],
  opts?: { pos?: number; sectionId?: string; queueTotal?: number }
): Event | null {
  const leaves = listLeafIndexes(edition, toc);
  if (!leaves.length) return null;

  const stale =
    (opts?.queueTotal != null && opts.queueTotal >= STALE_VERSE_TOTAL) ||
    (opts?.pos != null && opts.pos >= STALE_VERSE_TOTAL);

  if (!stale && opts?.sectionId) {
    const sid = opts.sectionId.toLowerCase();
    const editionRoot =
      sid === edition.id.toLowerCase() || sid === eventAddress(edition).toLowerCase();
    // Resume after "Go to top" stores the edition id — that is not a leaf pick.
    if (!editionRoot) {
      const byId = memoryGetEvent(opts.sectionId);
      if (byId) {
        const resolved = resolvePaintIndex(byId, edition, toc);
        if (resolved && leaves.some((l) => l.id === resolved.id)) return resolved;
      }
      const byLeaf = leaves.find((l) => l.id.toLowerCase() === sid);
      if (byLeaf) return byLeaf;
    }
  }

  if (!stale && opts?.pos != null && Number.isFinite(opts.pos)) {
    const i = Math.floor(opts.pos);
    if (i >= 0 && i < leaves.length) return leaves[i] ?? leaves[0] ?? null;
    // Past the end: clamp only when the leaf list looks complete (matches queue total).
    // Mid-warm (10 of 334 days) must not snap to the last loaded day.
    if (
      opts.queueTotal != null &&
      opts.queueTotal > 0 &&
      opts.queueTotal < STALE_VERSE_TOTAL &&
      leaves.length >= opts.queueTotal
    ) {
      return leaves[leaves.length - 1] ?? leaves[0] ?? null;
    }
  }

  return leaves[0] ?? null;
}

export function nextLeafIndex(edition: Event, toc: TocEntry[], current: Event): Event | null {
  const leaves = listLeafIndexes(edition, toc);
  const i = leaves.findIndex((e) => e.id.toLowerCase() === current.id.toLowerCase());
  if (i < 0 || i + 1 >= leaves.length) return null;
  return leaves[i + 1] ?? null;
}

/**
 * Fetch nested kind-30040 indexes only (not verses) so the contents tree can deepen
 * for editions without local seed shards (e.g. Quran on relays/Mercury).
 */
export async function warmIndexTree(
  edition: Event,
  fetchAddr: (coord: string) => Promise<Event | null>,
  opts?: { signal?: AbortSignal; onIndex?: () => void; maxIndexes?: number }
): Promise<number> {
  const max = opts?.maxIndexes ?? MAX_WARM_INDEXES;
  const signal = opts?.signal;
  const seen = new Set<string>();
  const queue: string[] = [];
  let loaded = 0;
  const title = firstTag(edition, 'title') ?? firstTag(edition, 'd') ?? edition.id.slice(0, 8);
  const t0 = performance.now();
  console.info('[alexandria:index-warm] start', { title, max });

  const enqueue = (coord: string): void => {
    const key = coord.toLowerCase();
    if (seen.has(key)) return;
    const parsed = parseAddress(coord);
    if (!parsed || parsed.kind !== KIND.PUBLICATION) return;
    seen.add(key);
    queue.push(coord);
  };

  for (const coord of childAddresses(edition)) enqueue(coord);

  while (queue.length && loaded < max) {
    if (signal?.aborted) break;
    const coord = queue.shift()!;
    let hit = lookupAddress(coord);
    if (!hit) {
      hit = await fetchAddr(coord);
      if (hit) rememberEvents([hit]);
    }
    if (!hit || hit.kind !== KIND.PUBLICATION) continue;
    loaded += 1;
    if (loaded === 1 || loaded % 25 === 0) {
      console.info('[alexandria:index-warm] progress', {
        title,
        loaded,
        queued: queue.length,
        ms: Math.round(performance.now() - t0)
      });
    }
    opts?.onIndex?.();
    // Plans: do not walk into reading headings under days.
    if (isReadingPlanEdition(edition)) {
      const d = firstTag(hit, 'd') ?? '';
      if (isPlanDayD(d)) continue;
    }
    for (const child of childAddresses(hit)) enqueue(child);
  }

  console.info('[alexandria:index-warm] done', {
    title,
    loaded,
    aborted: Boolean(signal?.aborted),
    ms: Math.round(performance.now() - t0)
  });
  return loaded;
}
