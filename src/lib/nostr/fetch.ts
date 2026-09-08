import type { Event, Filter } from 'nostr-tools';
import { KIND } from '../constants';
import { dTagVariants, normalizeDTag } from '../dtag';
import { parseAddress } from '../library-scope';
import { cacheFindByAddress, cacheGetEvent } from './cache';
import { memoryFindByAddress, memoryGetEvent } from './event-memory';
import { mercuryFilter } from './mercury';
import { relayPool } from './pool';
import { documentStack, wikiStack } from './selector';

export function mergeById(...lists: Event[][]): Event[] {
  const byId = new Map<string, Event>();
  for (const list of lists) {
    for (const event of list) byId.set(event.id, event);
  }
  return [...byId.values()];
}

export async function poolMap<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!);
      } catch {
        /* one item failed — leave hole; callers filter */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 0 }, () => worker()));
  return out;
}

function stackForKind(kind: number): string[] {
  if (kind === KIND.WIKI || kind === KIND.SPEC) return wikiStack();
  return documentStack();
}

export async function fetchByAddress(coord: string): Promise<Event | null> {
  let cached: Event | null = null;
  try {
    const parsed = parseAddress(coord);
    if (!parsed) return null;
    cached = memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d);
    if (!cached) {
      try {
        cached = await cacheFindByAddress(parsed.kind, parsed.pubkey, parsed.d);
      } catch {
        cached = null;
      }
    }
    // Shelf resolution and navigation already have the event — do not REQ every address again.
    if (cached) return cached;

    const dValues = dTagVariants(parsed.d);
    const slug = normalizeDTag(parsed.d);
    if (slug && !dValues.includes(slug)) dValues.unshift(slug);
    const filter: Filter = {
      kinds: [parsed.kind],
      authors: [parsed.pubkey],
      '#d': dValues.slice(0, 12),
      limit: 1
    };
    const mercury = await mercuryFilter(filter);
    if (mercury[0]) return mercury[0];
    const ws = await relayPool.query(stackForKind(parsed.kind), [filter]);
    return ws[0] ?? cached;
  } catch {
    return cached;
  }
}

export async function fetchById(id: string): Promise<Event | null> {
  let cached: Event | null = null;
  try {
    if (!/^[0-9a-f]{64}$/i.test(id)) return null;
    cached = memoryGetEvent(id);
    if (!cached) {
      try {
        cached = await cacheGetEvent(id);
      } catch {
        cached = null;
      }
    }
    if (cached) return cached;

    const filter: Filter = { ids: [id.toLowerCase()], limit: 1 };
    const mercury = await mercuryFilter(filter);
    if (mercury[0]) return mercury[0];
    const ws = await relayPool.query(documentStack(), [filter]);
    return ws[0] ?? cached;
  } catch {
    return cached;
  }
}

/** Load a 30040 by d + pubkey, preferring cache when Mercury/relays fail. */
export async function fetchPublication(d: string, pubkey: string): Promise<Event | null> {
  return fetchByAddress(`${KIND.PUBLICATION}:${pubkey.toLowerCase()}:${d}`);
}

export async function fetchByAddresses(coords: string[], concurrency = 3): Promise<Event[]> {
  const unique = [...new Set(coords.filter(Boolean))];
  const fetched = await poolMap(unique, concurrency, fetchByAddress);
  return fetched.filter((e): e is Event => !!e);
}

export async function fetchByIds(ids: string[], concurrency = 3): Promise<Event[]> {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()).filter((id) => /^[0-9a-f]{64}$/.test(id)))];
  const fetched = await poolMap(unique, concurrency, fetchById);
  return fetched.filter((e): e is Event => !!e);
}
