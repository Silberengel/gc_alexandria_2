import type { Event } from 'nostr-tools';
import { buildReadingQueueBookTags } from '@silberengel/kind-compose-catalog';
import { KIND } from './constants';
import { coordinatesOverlap } from './publication-coordinate';
import { eventAddress } from './nostr/verify';
import { latestReplaceable } from './mute';
import { isNewerReplaceable } from './nostr/replaceable';

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
  /** When true, book tags live in NIP-44-encrypted content. */
  private?: boolean;
};

const HEX64 = /^[0-9a-f]{64}$/i;
const ADDR = /^30040:[0-9a-f]{64}:.+/i;

function bookEntriesFromTags(tags: string[][], isPrivate: boolean): ReadingQueueEntry[] {
  const out: ReadingQueueEntry[] = [];
  for (const tag of tags) {
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
      updated: Number.isFinite(updatedRaw) && updatedRaw > 0 ? Math.floor(updatedRaw) : undefined,
      private: isPrivate || undefined
    });
  }
  return out;
}

/** Parse one kind-16374 replaceable into ordered queue entries (public + optional private tags). */
export function parseReadingQueue(
  event: Event | null | undefined,
  privateTags: string[][] = []
): ReadingQueueEntry[] {
  if (!event || event.kind !== KIND.READING_QUEUE) return [];
  const publicEntries = bookEntriesFromTags(event.tags, false);
  const privateEntries = bookEntriesFromTags(privateTags, true);
  const seen = new Set(publicEntries.map((e) => e.a.toLowerCase()));
  const out = [...publicEntries];
  for (const row of privateEntries) {
    if (seen.has(row.a.toLowerCase())) continue;
    seen.add(row.a.toLowerCase());
    out.push(row);
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

export function readingQueueFromMetadata(
  events: Event[],
  privateTags: string[][] = []
): ReadingQueueEntry[] {
  return parseReadingQueue(latestReplaceable(events, KIND.READING_QUEUE), privateTags);
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
  const prev = entries.find((e) => coordinatesOverlap(e.a, addr));
  const row: ReadingQueueEntry = {
    a: addr,
    pos: Math.max(0, Math.floor(next.pos)),
    total: Math.max(1, Math.floor(next.total)),
    sectionId: next.sectionId?.trim() || undefined,
    updated: next.updated ?? Math.floor(Date.now() / 1000),
    private: next.private ?? prev?.private
  };
  if (opts?.front) return [row, ...rest];
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

export type ReadingQueueDraft = {
  kind: number;
  /** Public tags only. */
  tags: string[][];
  /** Private book/a tag rows to encrypt into content (may be empty). */
  privateTags: string[][];
};

function toBookEmit(e: ReadingQueueEntry) {
  return {
    a: normalizeEditionAddr(e.a),
    pos: e.pos,
    total: e.total,
    sectionId: e.sectionId,
    updated: e.updated
  };
}

/** Split entries into public tags + private tag rows for encryption. */
export function readingQueueDraft(entries: ReadingQueueEntry[]): ReadingQueueDraft {
  const publicEntries = entries.filter((e) => !e.private);
  const privateEntries = entries.filter((e) => e.private);
  return {
    kind: KIND.READING_QUEUE,
    tags: buildReadingQueueBookTags(publicEntries.map(toBookEmit)),
    privateTags: buildReadingQueueBookTags(privateEntries.map(toBookEmit))
  };
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

/** Pubkeys whose reading queue includes this edition (newest event per author). Public tags only. */
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
    if (!prev || isNewerReplaceable(event, prev)) byPk.set(pk, event);
  }
  return [...byPk.keys()];
}
