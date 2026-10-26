import type { Event } from 'nostr-tools';
import { KIND } from '../constants';
import { dTagVariants, normalizeDTag } from '../dtag';
import { preferRicherEvent, publicationSectionCount } from '../metadata';
import { isNewerReplaceable } from './replaceable';
import { firstTag } from './verify';

/**
 * Session-local index of events already shown in the UI (shelves, search, seeds).
 * Caps must fit a full Douay tree (~38k) plus a reading-plan index — trimming below
 * that silently drops Genesis verses while later books survive, so plan days paint
 * as headings with no text.
 */
const byId = new Map<string, Event>();
const byAddr = new Map<string, Event>();
/** Newest kind-0 per pubkey — badges remount without waiting on profile relays. */
const byMetaPubkey = new Map<string, Event>();
/**
 * Kind 1 notes, kind 1111 comments, and kind 7 reactions, plus the other feed
 * post kinds. Kept apart from the publication tree so a feed recall stays small.
 */
const SOCIAL_KINDS = new Set<number>([
  KIND.TEXT_NOTE,
  KIND.REACTION,
  KIND.COMMENT,
  KIND.DJOT,
  KIND.PICTURE,
  KIND.VIDEO,
  KIND.LONG_FORM,
  KIND.PUBLICATION,
  KIND.WIKI,
  KIND.SPEC,
  KIND.REPOST,
  KIND.GENERIC_REPOST
]);
const bySocialKind = new Map<number, Map<string, Event>>();
/** Events whose e / E / q tag points at this id (replies, comments, reactions). */
const byRef = new Map<string, Map<string, Event>>();
const MAX_SOCIAL_KIND = 800;
const MAX_REFS = 2_000;
const MAX_PER_REF = 200;

/** Match Cache Storage publication-stream cap (see cache.ts MAX_PUBLICATION_STREAM_EVENTS). */
const MAX_BY_ID = 50_000;
const MAX_BY_ADDR = 55_000;
const MAX_META = 1_500;

function trimMap<K, V>(map: Map<K, V>, max: number): void {
  if (map.size <= max) return;
  const drop = map.size - max;
  let i = 0;
  for (const key of map.keys()) {
    map.delete(key);
    if (++i >= drop) break;
  }
}

function touchMap<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
}

function referencedEventIds(event: Event): string[] {
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'e' && tag[0] !== 'E' && tag[0] !== 'q') continue;
    const id = tag[1]?.trim().toLowerCase() ?? '';
    if (/^[0-9a-f]{64}$/.test(id)) out.push(id);
  }
  return out;
}

function rememberSocial(event: Event): void {
  if (!SOCIAL_KINDS.has(event.kind)) return;
  const id = event.id.toLowerCase();
  let bucket = bySocialKind.get(event.kind);
  if (!bucket) {
    bucket = new Map();
    bySocialKind.set(event.kind, bucket);
  }
  touchMap(bucket, id, event);
  trimMap(bucket, MAX_SOCIAL_KIND);
  for (const ref of referencedEventIds(event)) {
    let refs = byRef.get(ref);
    if (!refs) {
      refs = new Map();
      byRef.set(ref, refs);
    }
    touchMap(refs, id, event);
    trimMap(refs, MAX_PER_REF);
  }
  trimMap(byRef, MAX_REFS);
}

function addrKey(kind: number, pubkey: string, d: string): string {
  return `${kind}:${pubkey.toLowerCase()}:${normalizeDTag(d) || d}`;
}

export function rememberEvents(events: Event[]): void {
  for (const event of events) {
    if (!event?.id || !event.pubkey) continue;
    const id = event.id.toLowerCase();
    const prev = byId.get(id);
    // Same id: keep the richer tag set (search sources often disagree on a/e completeness).
    if (!prev) touchMap(byId, id, event);
    else touchMap(byId, id, preferRicherEvent(prev, event));

    rememberSocial(byId.get(id) ?? event);

    const pk = event.pubkey.toLowerCase();
    if (event.kind === 0) {
      const cur = byMetaPubkey.get(pk);
      if (!cur || isNewerReplaceable(event, cur)) touchMap(byMetaPubkey, pk, event);
    }

    const d = firstTag(event, 'd');
    if (d == null) continue;
    for (const variant of new Set([d, ...dTagVariants(d), normalizeDTag(d)].filter(Boolean))) {
      const key = addrKey(event.kind, pk, variant);
      const cur = byAddr.get(key);
      if (!cur) {
        touchMap(byAddr, key, event);
        continue;
      }
      // Reader walks need a/e tags — never let a thin catalog card replace a richer index.
      if (event.kind === KIND.PUBLICATION && cur.kind === KIND.PUBLICATION) {
        const curSecs = publicationSectionCount(cur);
        const nextSecs = publicationSectionCount(event);
        if (nextSecs > curSecs) {
          touchMap(byAddr, key, event);
          continue;
        }
        if (nextSecs < curSecs) continue;
      }
      if (isNewerReplaceable(event, cur)) touchMap(byAddr, key, event);
      else if (cur.id.toLowerCase() === id) touchMap(byAddr, key, preferRicherEvent(cur, event));
    }
  }
  trimMap(byId, MAX_BY_ID);
  trimMap(byAddr, MAX_BY_ADDR);
  trimMap(byMetaPubkey, MAX_META);
}

export function memoryEventsByKind(kind: number): Event[] {
  return [...(bySocialKind.get(kind)?.values() ?? [])];
}

export function memoryEventsReferencing(targetId: string): Event[] {
  return [...(byRef.get(targetId.toLowerCase())?.values() ?? [])];
}

export function memoryGetEvent(id: string): Event | null {
  const key = id.toLowerCase();
  const hit = byId.get(key);
  if (!hit) return null;
  touchMap(byId, key, hit);
  return hit;
}

export function memoryAllMetadata(): Event[] {
  return [...byMetaPubkey.values()];
}

export function memoryFindMetadata(pubkey: string): Event | null {
  const pk = pubkey.trim().toLowerCase();
  const hit = byMetaPubkey.get(pk);
  if (!hit) return null;
  touchMap(byMetaPubkey, pk, hit);
  return hit;
}

export function memoryFindByAddress(kind: number, pubkey: string, d: string): Event | null {
  const pk = pubkey.toLowerCase();
  const wanted = new Set(dTagVariants(d));
  const normalized = normalizeDTag(d);
  if (normalized) wanted.add(normalized);
  if (d) wanted.add(d);

  let best: Event | null = null;
  let bestKey: string | null = null;
  for (const variant of wanted) {
    const key = addrKey(kind, pk, variant);
    const hit = byAddr.get(key);
    if (!hit) continue;
    if (!best) {
      best = hit;
      bestKey = key;
      continue;
    }
    if (kind === KIND.PUBLICATION) {
      const bestSecs = publicationSectionCount(best);
      const hitSecs = publicationSectionCount(hit);
      if (hitSecs !== bestSecs) {
        if (hitSecs > bestSecs) {
          best = hit;
          bestKey = key;
        }
        continue;
      }
    }
    if (isNewerReplaceable(hit, best)) {
      best = hit;
      bestKey = key;
    }
  }
  if (best && bestKey) touchMap(byAddr, bestKey, best);
  return best;
}

/**
 * Douay chapter leaf: kind 30040 with matching book `T` code and chapter `c`.
 * Dedupes address aliases so the same event is only considered once.
 */
export function memoryFindBibleChapter(
  pubkey: string,
  bookCode: string,
  chapter: number
): Event | null {
  const pk = pubkey.toLowerCase();
  const code = bookCode.trim().toLowerCase();
  const c = String(chapter);
  const seen = new Set<string>();
  let best: Event | null = null;
  for (const ev of byAddr.values()) {
    const id = ev.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    if (ev.kind !== KIND.PUBLICATION) continue;
    if (ev.pubkey.toLowerCase() !== pk) continue;
    if (!ev.tags.some((t) => t[0] === 'c' && (t[1] ?? '').trim() === c)) continue;
    if (!ev.tags.some((t) => t[0] === 'T' && (t[1] ?? '').trim().toLowerCase() === code)) continue;
    const hasVerseChild = ev.tags.some((t) => t[0] === 'a' && (t[1] ?? '').startsWith(`${KIND.SECTION}:`));
    if (hasVerseChild) return ev;
    if (!best) best = ev;
  }
  return best;
}

/** @internal tests */
export function resetEventMemoryForTests(): void {
  byId.clear();
  byAddr.clear();
  byMetaPubkey.clear();
}
