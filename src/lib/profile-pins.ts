/**
 * NIP-51 kind 10001 pin list → resolved note events for a profile panel.
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { memoryGetEvent, rememberEvents } from './nostr/event-memory';
import { fetchByIds } from './nostr/fetch';
import { pickLatestReplaceable } from './nostr/replaceable';

const HEX_ID = /^[0-9a-f]{64}$/i;

/** Ordered unique `#e` ids from a pin list (kind 10001). */
export function pinEventIds(pinList: Event | null | undefined): string[] {
  if (!pinList || pinList.kind !== KIND.PIN) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of pinList.tags) {
    if (tag[0] !== 'e') continue;
    const id = (tag[1] ?? '').trim().toLowerCase();
    if (!HEX_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Latest kind-10001 for `pubkey` from a batch of replaceable candidates. */
export function pickPinList(events: Event[], pubkey: string): Event | null {
  return pickLatestReplaceable(events, KIND.PIN, pubkey);
}

/**
 * Resolve pin `#e` ids via event-memory, then `fetchByIds` for misses.
 * Preserves pin-list order; drops unresolved ids.
 */
export async function resolvePinnedNotes(
  pinList: Event | null | undefined,
  opts?: { limit?: number; fetchIds?: (ids: string[]) => Promise<Event[]> }
): Promise<Event[]> {
  const ids = pinEventIds(pinList).slice(0, opts?.limit ?? 24);
  if (!ids.length) return [];

  const byId = new Map<string, Event>();
  const missing: string[] = [];
  for (const id of ids) {
    const warm = memoryGetEvent(id);
    if (warm) byId.set(id, warm);
    else missing.push(id);
  }

  if (missing.length) {
    const fetchIds = opts?.fetchIds ?? ((need: string[]) => fetchByIds(need));
    const found = await fetchIds(missing);
    rememberEvents(found);
    for (const event of found) {
      if (event?.id) byId.set(event.id.toLowerCase(), event);
    }
  }

  return ids.map((id) => byId.get(id)).filter((e): e is Event => !!e);
}

/** True when both lists have the same event ids in the same order. */
export function samePinnedNoteIds(a: Event[], b: Event[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((event, i) => event.id.toLowerCase() === (b[i]?.id ?? '').toLowerCase());
}
