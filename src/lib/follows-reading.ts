import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { coverAuthor, coverTitle } from './cover-fallback';
import { publicationPath } from './metadata';
import { fetchByAddresses } from './nostr/fetch';
import { relayPool } from './nostr/pool';
import { socialStack } from './nostr/selector';
import { eventAddress } from './nostr/verify';
import {
  activeReadingEntries,
  parseReadingQueue,
  type ReadingQueueEntry
} from './reading-queue';
import { isNewerReplaceable } from './nostr/replaceable';

export type FollowsReadingRow = {
  address: string;
  title: string;
  author: string;
  href: string;
  /** Full count of follows reading this publication. */
  readerCount: number;
  /** Sample of reader pubkeys for avatar chips. */
  readers: string[];
};

const ACTIVE_PER_FOLLOW = 2;
const MAX_FOLLOW_AUTHORS = 60;
const MAX_PUBLICATIONS = 8;
const MAX_READERS_SHOWN = 5;

/**
 * Newest kind-16374 per author from follows, then active queue slots only.
 */
export async function fetchFollowReadingQueues(
  followPubkeys: string[],
  mutePubkeys?: Set<string>
): Promise<Event[]> {
  const authors = [
    ...new Set(
      followPubkeys
        .map((pk) => pk.toLowerCase())
        .filter((pk) => pk.length === 64 && !mutePubkeys?.has(pk))
    )
  ].slice(0, MAX_FOLLOW_AUTHORS);
  if (!authors.length) return [];

  const events = await relayPool.query(
    socialStack(),
    [{ kinds: [KIND.READING_QUEUE], authors, limit: Math.min(120, authors.length * 2) }],
    4500,
    3
  );

  const byPk = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== KIND.READING_QUEUE) continue;
    const pk = event.pubkey.toLowerCase();
    if (mutePubkeys?.has(pk)) continue;
    const prev = byPk.get(pk);
    if (!prev || isNewerReplaceable(event, prev)) byPk.set(pk, event);
  }
  return [...byPk.values()];
}

type Acc = {
  address: string;
  readers: Map<string, number>;
};

/**
 * Group follow queues by publication address (active slots only).
 * Sorted by reader count, then most-recent activity.
 */
export function groupFollowsReadingByPublication(
  queues: Event[],
  opts?: { concurrent?: number; excludePubkey?: string | null }
): Acc[] {
  const concurrent = Math.max(1, opts?.concurrent ?? ACTIVE_PER_FOLLOW);
  const exclude = opts?.excludePubkey?.toLowerCase() ?? '';
  const byAddr = new Map<string, Acc>();

  for (const queue of queues) {
    const pk = queue.pubkey.toLowerCase();
    if (!pk || pk === exclude) continue;
    const entries = activeReadingEntries(parseReadingQueue(queue), concurrent);
    for (const entry of entries) {
      const addr = entry.a;
      if (!addr) continue;
      let row = byAddr.get(addr);
      if (!row) {
        row = { address: addr, readers: new Map() };
        byAddr.set(addr, row);
      }
      const updated = entry.updated ?? queue.created_at;
      const prev = row.readers.get(pk) ?? 0;
      if (updated >= prev) row.readers.set(pk, updated);
    }
  }

  return [...byAddr.values()].sort((a, b) => {
    if (b.readers.size !== a.readers.size) return b.readers.size - a.readers.size;
    const aMax = Math.max(0, ...a.readers.values());
    const bMax = Math.max(0, ...b.readers.values());
    return bMax - aMax;
  });
}

export async function loadFollowsReading(opts: {
  followPubkeys: string[];
  viewerPubkey?: string | null;
  mutePubkeys?: Set<string>;
  concurrent?: number;
  limitPubs?: number;
}): Promise<FollowsReadingRow[]> {
  const limitPubs = opts.limitPubs ?? MAX_PUBLICATIONS;
  const queues = await fetchFollowReadingQueues(opts.followPubkeys, opts.mutePubkeys);
  const grouped = groupFollowsReadingByPublication(queues, {
    concurrent: opts.concurrent ?? ACTIVE_PER_FOLLOW,
    excludePubkey: opts.viewerPubkey
  }).slice(0, limitPubs);

  if (!grouped.length) return [];

  const pubs = await fetchByAddresses(grouped.map((g) => g.address));
  const byAddr = new Map(pubs.map((e) => [eventAddress(e), e]));

  const rows: FollowsReadingRow[] = [];
  for (const g of grouped) {
    const pub = byAddr.get(g.address);
    const title = pub ? coverTitle(pub) : g.address.split(':').slice(2).join(':') || 'Untitled';
    const author = pub ? coverAuthor(pub) : '';
    const href = pub ? `#${publicationPath(pub)}` : '#/';
    const readers = [...g.readers.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([pk]) => pk)
      .slice(0, MAX_READERS_SHOWN);
    if (!readers.length) continue;
    rows.push({
      address: g.address,
      title,
      author,
      href,
      readerCount: g.readers.size,
      readers
    });
  }
  return rows;
}

/** Test helper — expose active-entry parsing without network. */
export function activeEntriesFromQueue(
  queue: Event,
  concurrent = ACTIVE_PER_FOLLOW
): ReadingQueueEntry[] {
  return activeReadingEntries(parseReadingQueue(queue), concurrent);
}
