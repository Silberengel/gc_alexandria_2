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

function addrKey(kind: number, pubkey: string, d: string): string {
  return `${kind}:${pubkey.toLowerCase()}:${normalizeDTag(d) || d}`;
}

export function rememberEvents(events: Event[]): void {
  for (const event of events) {
    if (!event?.id || !event.pubkey) continue;
    const id = event.id.toLowerCase();
    const prev = byId.get(id);
    // Same id: keep the richer tag set (search sources often disagree on a/e completeness).
    if (!prev) byId.set(id, event);
    else byId.set(id, preferRicherEvent(prev, event));

    const pk = event.pubkey.toLowerCase();
    if (event.kind === 0) {
      const cur = byMetaPubkey.get(pk);
      if (!cur || isNewerReplaceable(event, cur)) byMetaPubkey.set(pk, event);
    }

    const d = firstTag(event, 'd');
    if (d == null) continue;
    for (const variant of new Set([d, ...dTagVariants(d), normalizeDTag(d)].filter(Boolean))) {
      const key = addrKey(event.kind, pk, variant);
      const cur = byAddr.get(key);
      if (!cur) {
        byAddr.set(key, event);
        continue;
      }
      // Reader walks need a/e tags — never let a thin catalog card replace a richer index.
      if (event.kind === KIND.PUBLICATION && cur.kind === KIND.PUBLICATION) {
        const curSecs = publicationSectionCount(cur);
        const nextSecs = publicationSectionCount(event);
        if (nextSecs > curSecs) {
          byAddr.set(key, event);
          continue;
        }
        if (nextSecs < curSecs) continue;
      }
      if (isNewerReplaceable(event, cur)) byAddr.set(key, event);
      else if (cur.id.toLowerCase() === id) byAddr.set(key, preferRicherEvent(cur, event));
    }
  }
}

export function memoryGetEvent(id: string): Event | null {
  return byId.get(id.toLowerCase()) ?? null;
}

export function memoryFindMetadata(pubkey: string): Event | null {
  return byMetaPubkey.get(pubkey.trim().toLowerCase()) ?? null;
}

export function memoryFindByAddress(kind: number, pubkey: string, d: string): Event | null {
  const pk = pubkey.toLowerCase();
  const wanted = new Set(dTagVariants(d));
  const normalized = normalizeDTag(d);
  if (normalized) wanted.add(normalized);
  if (d) wanted.add(d);

  let best: Event | null = null;
  for (const variant of wanted) {
    const hit = byAddr.get(addrKey(kind, pk, variant));
    if (!hit) continue;
    if (!best) {
      best = hit;
      continue;
    }
    if (kind === KIND.PUBLICATION) {
      const bestSecs = publicationSectionCount(best);
      const hitSecs = publicationSectionCount(hit);
      if (hitSecs !== bestSecs) {
        if (hitSecs > bestSecs) best = hit;
        continue;
      }
    }
    if (isNewerReplaceable(hit, best)) best = hit;
  }
  return best;
}
