import type { Event } from 'nostr-tools';
import { KIND } from '../constants';
import { dTagVariants, normalizeDTag } from '../dtag';
import { preferRicherEvent, publicationSectionCount } from '../metadata';
import { isNewerReplaceable } from './replaceable';
import { firstTag } from './verify';

/** Session-local index of events already shown in the UI (shelves, search, etc.). */
const byId = new Map<string, Event>();
const byAddr = new Map<string, Event>();
/** Newest kind-0 per pubkey — badges remount without waiting on profile relays. */
const byMetaPubkey = new Map<string, Event>();

const MAX_BY_ID = 4_000;
const MAX_BY_ADDR = 6_000;
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

export function memoryGetEvent(id: string): Event | null {
  const key = id.toLowerCase();
  const hit = byId.get(key);
  if (!hit) return null;
  touchMap(byId, key, hit);
  return hit;
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
