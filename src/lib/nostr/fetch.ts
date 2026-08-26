import type { Event, Filter } from 'nostr-tools';
import { KIND } from '../constants';
import { parseAddress } from '../library-scope';
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
      out[i] = await fn(items[i]!);
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
  const parsed = parseAddress(coord);
  if (!parsed) return null;
  const filter: Filter = {
    kinds: [parsed.kind],
    authors: [parsed.pubkey],
    '#d': [parsed.d],
    limit: 1
  };
  const mercury = await mercuryFilter(filter);
  if (mercury[0]) return mercury[0];
  const ws = await relayPool.query(stackForKind(parsed.kind), [filter]);
  return ws[0] ?? null;
}

export async function fetchById(id: string): Promise<Event | null> {
  if (!/^[0-9a-f]{64}$/i.test(id)) return null;
  const filter: Filter = { ids: [id.toLowerCase()], limit: 1 };
  const mercury = await mercuryFilter(filter);
  if (mercury[0]) return mercury[0];
  const ws = await relayPool.query(documentStack(), [filter]);
  return ws[0] ?? null;
}

export async function fetchByAddresses(coords: string[], concurrency = 6): Promise<Event[]> {
  const unique = [...new Set(coords.filter(Boolean))];
  const fetched = await poolMap(unique, concurrency, fetchByAddress);
  return fetched.filter((e): e is Event => !!e);
}

export async function fetchByIds(ids: string[], concurrency = 6): Promise<Event[]> {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()).filter((id) => /^[0-9a-f]{64}$/.test(id)))];
  const fetched = await poolMap(unique, concurrency, fetchById);
  return fetched.filter((e): e is Event => !!e);
}
