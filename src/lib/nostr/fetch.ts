import type { Event, Filter } from 'nostr-tools';
import { KIND } from '../constants';
import { isEventDeleted } from '../deletions';
import { dTagVariants, normalizeDTag } from '../dtag';
import { preferRicherEvent, publicationSectionCount } from '../metadata';
import { parseAddress } from '../library-scope';
import { cacheDeleteEvent, cacheFindByAddress, cacheGetEvent } from './cache';
import { memoryFindByAddress, memoryGetEvent, rememberEvents } from './event-memory';
import { mercuryFilter } from './mercury';
import { relayPool } from './pool';
import { isNewerReplaceable } from './replaceable';
import { documentStack, wikiStack } from './selector';

export function mergeById(...lists: Event[][]): Event[] {
  const byId = new Map<string, Event>();
  for (const list of lists) {
    for (const event of list) {
      const prev = byId.get(event.id);
      byId.set(event.id, prev ? preferRicherEvent(prev, event) : event);
    }
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

async function hideIfDeleted(event: Event | null): Promise<Event | null> {
  if (!event) return null;
  // Use in-memory tombstones only on the hot path — a live kind-5 refresh per address
  // saturates the relay pool and stalls wiki/publication navigation.
  if (!isEventDeleted(event)) {
    rememberEvents([event]);
    return event;
  }
  void cacheDeleteEvent(event.id);
  return null;
}

/** Synthetic ToC stubs must not block a live fetch for the same address. */
function isSyntheticPlaceholder(event: Event): boolean {
  return event.created_at === 0 && /^0+$/.test(event.sig ?? '');
}

/** Catalog/search cards often lack a/e tags — never treat them as the final index. */
function isThinPublicationIndex(event: Event): boolean {
  return event.kind === KIND.PUBLICATION && publicationSectionCount(event) === 0;
}

/** Pick newest, but never prefer a thin 30040 over one that still has children to walk. */
function pickBestAddressable(events: Event[], kind: number, pubkey: string): Event | null {
  let best: Event | null = null;
  for (const event of events) {
    if (event.kind !== kind) continue;
    if (event.pubkey.toLowerCase() !== pubkey) continue;
    if (!best) {
      best = event;
      continue;
    }
    const bestSecs = publicationSectionCount(best);
    const nextSecs = publicationSectionCount(event);
    if (kind === KIND.PUBLICATION && nextSecs !== bestSecs) {
      if (nextSecs > bestSecs) best = event;
      continue;
    }
    if (isNewerReplaceable(event, best)) best = event;
  }
  return best;
}

/** Resolve with the first non-null result; wait for all only when every source misses. */
function firstEvent(promises: Array<Promise<Event | null>>): Promise<Event | null> {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (!pending) {
      resolve(null);
      return;
    }
    let done = false;
    for (const p of promises) {
      p.then((event) => {
        if (done) return;
        if (event) {
          done = true;
          resolve(event);
          return;
        }
        pending -= 1;
        if (pending === 0) resolve(null);
      }).catch(() => {
        if (done) return;
        pending -= 1;
        if (pending === 0) resolve(null);
      });
    }
  });
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
    if (cached && isSyntheticPlaceholder(cached)) cached = null;
    // Rich indexes / leaves: trust cache. Thin 30040 catalog cards must still hit the network
    // or nested Surahs/Preamble walks stop at empty headings.
    if (cached && !isThinPublicationIndex(cached)) return hideIfDeleted(cached);

    const dValues = dTagVariants(parsed.d);
    const slug = normalizeDTag(parsed.d);
    if (slug && !dValues.includes(slug)) dValues.unshift(slug);
    const filter: Filter = {
      kinds: [parsed.kind],
      authors: [parsed.pubkey],
      '#d': dValues.slice(0, 12),
      limit: 5
    };
    // Race Mercury HTTP with relays — a hung /filter must not delay the a-tag walk.
    const hit = await firstEvent([
      mercuryFilter(filter).then((events) =>
        pickBestAddressable(events, parsed.kind, parsed.pubkey.toLowerCase())
      ),
      relayPool
        .query(
          stackForKind(parsed.kind),
          [filter],
          4000,
          5,
          undefined,
          { priority: parsed.kind === KIND.WIKI || parsed.kind === KIND.SPEC }
        )
        .then((events) => pickBestAddressable(events, parsed.kind, parsed.pubkey.toLowerCase()))
    ]);
    if (hit && cached) {
      const chosen =
        publicationSectionCount(hit) >= publicationSectionCount(cached) ? hit : cached;
      if (chosen === hit) rememberEvents([hit]);
      return hideIfDeleted(chosen);
    }
    if (hit) rememberEvents([hit]);
    return hideIfDeleted(hit ?? cached);
  } catch {
    return cached ? hideIfDeleted(cached) : null;
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
    if (cached && isSyntheticPlaceholder(cached)) cached = null;
    if (cached) return hideIfDeleted(cached);

    const filter: Filter = { ids: [id.toLowerCase()], limit: 1 };
    const hit = await firstEvent([
      mercuryFilter(filter).then((events) => events[0] ?? null),
      relayPool.query(documentStack(), [filter]).then((events) => events[0] ?? null)
    ]);
    return hideIfDeleted(hit ?? cached);
  } catch {
    return cached ? hideIfDeleted(cached) : null;
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
