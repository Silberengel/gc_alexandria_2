import { describe, expect, it } from 'vitest';
import { KIND } from './constants';
import {
  activeReadingEntries,
  isReadingFinished,
  moveReadingEntryToFront,
  parseReadingQueue,
  readingProgressPercent,
  readingQueueDraft,
  removeReadingEntry,
  upsertReadingEntry,
  waitingReadingEntries,
  type ReadingQueueEntry
} from './reading-queue';
import type { Event } from 'nostr-tools';

function ev(tags: string[][]): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: KIND.READING_QUEUE,
    tags,
    content: '',
    sig: 'c'.repeat(128)
  };
}

const a1 = `30040:${'1'.repeat(64)}:book-one`;
const a2 = `30040:${'2'.repeat(64)}:book-two`;
const a3 = `30040:${'3'.repeat(64)}:book-three`;

describe('reading queue', () => {
  it('round-trips book tags and preserves order', () => {
    const entries: ReadingQueueEntry[] = [
      { a: a1, pos: 2, total: 10, sectionId: 'd'.repeat(64), updated: 100 },
      { a: a2, pos: 0, total: 5, updated: 50 }
    ];
    const draft = readingQueueDraft(entries);
    expect(draft.kind).toBe(KIND.READING_QUEUE);
    expect(draft.tags.filter((t) => t[0] === 'a')).toHaveLength(2);
    const parsed = parseReadingQueue(ev(draft.tags));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ pos: 2, total: 10, sectionId: 'd'.repeat(64), updated: 100 });
    expect(parsed[0]?.a).toContain('book-one');
    expect(parsed[1]).toMatchObject({ pos: 0, total: 5, updated: 50 });
    expect(parsed[1]?.a).toContain('book-two');
  });

  it('splits active and waiting by concurrent limit', () => {
    const entries = [
      { a: a1, pos: 0, total: 3 },
      { a: a2, pos: 1, total: 3 },
      { a: a3, pos: 0, total: 3 }
    ];
    expect(activeReadingEntries(entries, 2).map((e) => e.a)).toEqual([a1, a2]);
    expect(waitingReadingEntries(entries, 2).map((e) => e.a)).toEqual([a3]);
  });

  it('upserts, moves to front, and removes', () => {
    let entries: ReadingQueueEntry[] = [];
    entries = upsertReadingEntry(entries, { a: a1, pos: 0, total: 4 });
    entries = upsertReadingEntry(entries, { a: a2, pos: 1, total: 8 });
    expect(entries).toHaveLength(2);
    entries = upsertReadingEntry(entries, { a: a1, pos: 2, total: 4 });
    expect(entries[0]?.pos).toBe(2);
    entries = moveReadingEntryToFront(entries, a2);
    expect(entries[0]?.a).toBe(a2);
    entries = removeReadingEntry(entries, a2);
    expect(entries.map((e) => e.a)).toEqual([a1]);
  });

  it('detects finish and percent', () => {
    expect(isReadingFinished({ pos: 9, total: 10 })).toBe(true);
    expect(isReadingFinished({ pos: 0, total: 10 })).toBe(false);
    expect(readingProgressPercent({ pos: 0, total: 4 })).toBe(25);
    expect(readingProgressPercent({ pos: 3, total: 4 })).toBe(100);
  });
});
