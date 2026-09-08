import type { Event } from 'nostr-tools';
import { dTagVariants, normalizeDTag } from '../dtag';
import { firstTag } from './verify';

/** Session-local index of events already shown in the UI (shelves, search, etc.). */
const byId = new Map<string, Event>();
const byAddr = new Map<string, Event>();

function addrKey(kind: number, pubkey: string, d: string): string {
  return `${kind}:${pubkey.toLowerCase()}:${normalizeDTag(d) || d}`;
}

export function rememberEvents(events: Event[]): void {
  for (const event of events) {
    if (!event?.id || !event.pubkey) continue;
    const id = event.id.toLowerCase();
    const prev = byId.get(id);
    if (!prev || event.created_at >= prev.created_at) byId.set(id, event);

    const d = firstTag(event, 'd');
    if (d == null) continue;
    const pk = event.pubkey.toLowerCase();
    for (const variant of new Set([d, ...dTagVariants(d), normalizeDTag(d)].filter(Boolean))) {
      const key = addrKey(event.kind, pk, variant);
      const cur = byAddr.get(key);
      if (!cur || event.created_at >= cur.created_at) byAddr.set(key, event);
    }
  }
}

export function memoryGetEvent(id: string): Event | null {
  return byId.get(id.toLowerCase()) ?? null;
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
    if (hit && (!best || hit.created_at >= best.created_at)) best = hit;
  }
  return best;
}
