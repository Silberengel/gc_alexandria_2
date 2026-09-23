import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { coordinatesOverlap } from './publication-coordinate';
import { eventAddress } from './nostr/verify';
import { latestReplaceable } from './mute';

export type ReadingQueueEntry = {
  /** Edition coordinate `30040:pubkey:d`. */
  a: string;
  /** 0-based index in the flattened section stream. */
  pos: number;
  /** Stream length when last written. */
  total: number;
  /** Optional section event id or address at `pos`. */
  sectionId?: string;
  /** Unix seconds of last advance. */
  updated?: number;
};

const HEX64 = /^[0-9a-f]{64}$/i;
const ADDR = /^30040:[0-9a-f]{64}:.+/i;

/** Parse one kind-16374 replaceable into ordered queue entries. */
export function parseReadingQueue(event: Event | null | undefined): ReadingQueueEntry[] {
  if (!event || event.kind !== KIND.READING_QUEUE) return [];
  const out: ReadingQueueEntry[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'book' || !tag[1]) continue;
    const a = tag[1].trim();
    if (!ADDR.test(a)) continue;
    const pos = Number(tag[2]);
    const total = Number(tag[3]);
    if (!Number.isFinite(pos) || !Number.isFinite(total) || total < 1) continue;
    const sectionRaw = (tag[4] ?? '').trim();
    const updatedRaw = Number(tag[5]);
    out.push({
      a: normalizeEditionAddr(a),
      pos: Math.max(0, Math.floor(pos)),
      total: Math.max(1, Math.floor(total)),
      sectionId: sectionRaw || undefined,
      updated: Number.isFinite(updatedRaw) && updatedRaw > 0 ? Math.floor(updatedRaw) : undefined
    });
  }
  return out;
}

function normalizeEditionAddr(a: string): string {
  const parts = a.split(':');
  if (parts.length < 3) return a;
  const kind = parts[0];
  const pk = parts[1]?.toLowerCase() ?? '';
  const d = parts.slice(2).join(':');
  return `${kind}:${pk}:${d}`;
}

export function readingQueueFromMetadata(events: Event[]): ReadingQueueEntry[] {
  return parseReadingQueue(latestReplaceable(events, KIND.READING_QUEUE));
}

export function findQueueEntry(
  entries: ReadingQueueEntry[],
  editionAddress: string
): ReadingQueueEntry | null {
  return entries.find((e) => coordinatesOverlap(e.a, editionAddress)) ?? null;
}

export function activeReadingEntries(
  entries: ReadingQueueEntry[],
  concurrent: number
): ReadingQueueEntry[] {
  const n = Math.max(1, Math.floor(concurrent));
  return entries.slice(0, n);
}

export function waitingReadingEntries(
  entries: ReadingQueueEntry[],
  concurrent: number
): ReadingQueueEntry[] {
  const n = Math.max(1, Math.floor(concurrent));
  return entries.slice(n);
}

export function isReadingFinished(entry: Pick<ReadingQueueEntry, 'pos' | 'total'>): boolean {
  return entry.total >= 1 && entry.pos >= entry.total - 1;
}

export function readingProgressRatio(entry: Pick<ReadingQueueEntry, 'pos' | 'total'>): number {
  if (entry.total < 1) return 0;
  return Math.min(1, Math.max(0, (entry.pos + 1) / entry.total));
}

export function readingProgressPercent(entry: Pick<ReadingQueueEntry, 'pos' | 'total'>): number {
  return Math.round(readingProgressRatio(entry) * 100);
}

/** Upsert / append an entry; returns new ordered list. */
export function upsertReadingEntry(
  entries: ReadingQueueEntry[],
  next: ReadingQueueEntry,
  opts?: { front?: boolean }
): ReadingQueueEntry[] {
  const addr = normalizeEditionAddr(next.a);
  const rest = entries.filter((e) => !coordinatesOverlap(e.a, addr));
  const row: ReadingQueueEntry = {
    a: addr,
    pos: Math.max(0, Math.floor(next.pos)),
    total: Math.max(1, Math.floor(next.total)),
    sectionId: next.sectionId?.trim() || undefined,
    updated: next.updated ?? Math.floor(Date.now() / 1000)
  };
  if (opts?.front) return [row, ...rest];
  const prev = entries.find((e) => coordinatesOverlap(e.a, addr));
  if (prev) {
    const i = entries.findIndex((e) => coordinatesOverlap(e.a, addr));
    const copy = [...entries];
    copy[i] = row;
    return copy;
  }
  return [...rest, row];
}

export function removeReadingEntry(
  entries: ReadingQueueEntry[],
  editionAddress: string
): ReadingQueueEntry[] {
  return entries.filter((e) => !coordinatesOverlap(e.a, editionAddress));
}

export function moveReadingEntryToFront(
  entries: ReadingQueueEntry[],
  editionAddress: string
): ReadingQueueEntry[] {
  const hit = findQueueEntry(entries, editionAddress);
  if (!hit) return entries;
  return [hit, ...entries.filter((e) => !coordinatesOverlap(e.a, editionAddress))];
}

/** Draft tags + empty content for kind 16374. */
export function readingQueueDraft(entries: ReadingQueueEntry[]): {
  kind: number;
  content: string;
  tags: string[][];
} {
  const tags: string[][] = [];
  for (const e of entries) {
    const a = normalizeEditionAddr(e.a);
    tags.push([
      'book',
      a,
      String(Math.max(0, Math.floor(e.pos))),
      String(Math.max(1, Math.floor(e.total))),
      e.sectionId?.trim() ?? '',
      String(e.updated ?? Math.floor(Date.now() / 1000))
    ]);
    tags.push(['a', a]);
  }
  return { kind: KIND.READING_QUEUE, content: '', tags };
}

export function editionAddressFromPublication(publication: Event): string {
  return eventAddress(publication);
}

export function isPublicationAddress(addr: string): boolean {
  return ADDR.test(addr.trim());
}

export function isSectionEventId(id: string | undefined): boolean {
  return !!id && HEX64.test(id);
}

/** Pubkeys whose reading queue includes this edition (newest event per author). */
export function readingQueueAuthorsForEdition(
  events: Event[],
  publication: Event,
  mutePubkeys?: Set<string>
): string[] {
  const addr = eventAddress(publication);
  const byPk = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== KIND.READING_QUEUE) continue;
    const pk = event.pubkey.toLowerCase();
    if (mutePubkeys?.has(pk)) continue;
    const entries = parseReadingQueue(event);
    if (!entries.some((e) => coordinatesOverlap(e.a, addr))) continue;
    const prev = byPk.get(pk);
    if (!prev || event.created_at > prev.created_at) byPk.set(pk, event);
  }
  return [...byPk.keys()];
}
