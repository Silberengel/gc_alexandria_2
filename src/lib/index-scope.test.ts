import { describe, expect, it, beforeEach } from 'vitest';
import type { Event } from 'nostr-tools';
import { rememberEvents } from './nostr/event-memory';
import {
  buildIndexScopedToc,
  collectIndexPaintEvents,
  isIndexScopedEdition,
  isLeafIndex,
  isPlanDayD,
  isReadingPlanEdition,
  listLeafIndexes,
  pickScopedOpenIndex,
  resolvePaintIndex
} from './index-scope';

const PK = '3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690';

function ev(over: Partial<Event> & { tags: string[][]; id?: string }): Event {
  const d = over.tags.find((t) => t[0] === 'd')?.[1] ?? 'x';
  return {
    id: (over.id ?? d.padEnd(64, '0').slice(0, 64)).toLowerCase(),
    pubkey: (over.pubkey ?? PK).toLowerCase(),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? 30040,
    tags: over.tags,
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

function a(kind: number, d: string): string {
  return `${kind}:${PK}:${d}`;
}

beforeEach(() => {
  // rememberEvents is append-only for the session; use unique d-tags per test.
});

describe('isIndexScopedEdition', () => {
  it('matches type=bible, reading plans, and large index roots', () => {
    expect(
      isIndexScopedEdition(ev({ tags: [['d', 'quran-the-koran-al-qur-an'], ['type', 'bible']] }))
    ).toBe(true);
    expect(
      isIndexScopedEdition(ev({ tags: [['d', 'bible-the-bible-douay-rheims-version'], ['type', 'bible']] }))
    ).toBe(true);
    expect(isReadingPlanEdition(ev({ tags: [['d', 'biblestr-plan-chronological']] }))).toBe(true);
    expect(isIndexScopedEdition(ev({ tags: [['d', 'some-novel']] }))).toBe(false);
    expect(isPlanDayD('biblestr-plan-chronological-day-001')).toBe(true);
    expect(isPlanDayD('biblestr-plan-chronological-day-001-r1')).toBe(false);

    const dayTags: string[][] = [['d', 'big-plan'], ['title', 'Plan']];
    for (let i = 1; i <= 40; i += 1) {
      dayTags.push(['a', a(30040, `big-plan-day-${String(i).padStart(3, '0')}`)]);
    }
    expect(isIndexScopedEdition(ev({ tags: dayTags }))).toBe(true);
    expect(isReadingPlanEdition(ev({ tags: dayTags }))).toBe(true);
  });
});

describe('buildIndexScopedToc', () => {
  it('lists plan days and omits reading headings and verses', () => {
    const verse = ev({
      id: '1'.repeat(64),
      kind: 30041,
      tags: [['d', 'v-1-1'], ['title', '1:1']]
    });
    const reading = ev({
      id: '2'.repeat(64),
      tags: [
        ['d', 'biblestr-plan-chronological-day-001-r1'],
        ['title', 'Genesis 1-3'],
        ['a', a(30041, 'v-1-1')]
      ]
    });
    const day1 = ev({
      id: '3'.repeat(64),
      tags: [
        ['d', 'biblestr-plan-chronological-day-001'],
        ['title', 'Day 1 — Creation'],
        ['a', a(30040, 'biblestr-plan-chronological-day-001-r1')]
      ]
    });
    const day2 = ev({
      id: '4'.repeat(64),
      tags: [
        ['d', 'biblestr-plan-chronological-day-002'],
        ['title', 'Day 2'],
        ['a', a(30040, 'biblestr-plan-chronological-day-001-r1')]
      ]
    });
    const root = ev({
      id: '5'.repeat(64),
      tags: [
        ['d', 'biblestr-plan-chronological'],
        ['title', 'Chronological Bible'],
        ['a', a(30040, 'biblestr-plan-chronological-day-001')],
        ['a', a(30040, 'biblestr-plan-chronological-day-002')]
      ]
    });
    rememberEvents([verse, reading, day1, day2, root]);

    const toc = buildIndexScopedToc(root);
    const titles = toc.map((e) => e.title);
    expect(titles).toContain('Chronological Bible');
    expect(titles).toContain('Day 1 — Creation');
    expect(titles).toContain('Day 2');
    expect(titles.some((t) => t.includes('Genesis'))).toBe(false);
    expect(toc.every((e) => e.index || e.root)).toBe(true);
    expect(toc.some((e) => e.kind === 30041)).toBe(false);

    const leaves = listLeafIndexes(root, toc);
    expect(leaves.map((e) => e.id)).toEqual([day1.id, day2.id]);

    const painted = collectIndexPaintEvents(day1);
    expect(painted.map((e) => e.id)).toEqual([day1.id, reading.id, verse.id]);
  });

  it('lists Douay indexes without verse rows', () => {
    const v1 = ev({
      id: 'a'.repeat(64),
      kind: 30041,
      tags: [['d', 'gen-1-1'], ['title', '1:1']]
    });
    const v2 = ev({
      id: 'b'.repeat(64),
      kind: 30041,
      tags: [['d', 'gen-1-2'], ['title', '1:2']]
    });
    const ch1 = ev({
      id: 'c'.repeat(64),
      tags: [
        ['d', 'genesis-ch-1'],
        ['title', 'Genesis Chapter 1'],
        ['a', a(30041, 'gen-1-1')],
        ['a', a(30041, 'gen-1-2')]
      ]
    });
    const ch2 = ev({
      id: 'd'.repeat(64),
      tags: [
        ['d', 'genesis-ch-2'],
        ['title', 'Genesis Chapter 2'],
        ['a', a(30041, 'gen-1-1')]
      ]
    });
    const book = ev({
      id: 'e'.repeat(64),
      tags: [
        ['d', 'bk-genesis'],
        ['title', 'Genesis'],
        ['a', a(30040, 'genesis-ch-1')],
        ['a', a(30040, 'genesis-ch-2')]
      ]
    });
    const root = ev({
      id: 'f'.repeat(64),
      tags: [
        ['d', 'bible-the-bible-douay-rheims-version'],
        ['type', 'bible'],
        ['title', 'Douay-Rheims Bible'],
        ['a', a(30040, 'bk-genesis')]
      ]
    });
    rememberEvents([v1, v2, ch1, ch2, book, root]);

    expect(isIndexScopedEdition(root)).toBe(true);
    expect(isLeafIndex(ch1)).toBe(true);
    expect(isLeafIndex(book)).toBe(false);

    const toc = buildIndexScopedToc(root);
    const titles = toc.map((e) => e.title);
    expect(titles).toEqual([
      'Douay-Rheims Bible',
      'Genesis',
      'Genesis Chapter 1',
      'Genesis Chapter 2'
    ]);
    expect(toc.some((e) => e.title === '1:1')).toBe(false);

    const leaves = listLeafIndexes(root, toc);
    expect(leaves.map((e) => e.id)).toEqual([ch1.id, ch2.id]);

    expect(resolvePaintIndex(book, root, toc)?.id).toBe(ch1.id);
    expect(collectIndexPaintEvents(ch1).map((e) => e.id)).toEqual([ch1.id, v1.id, v2.id]);

    expect(pickScopedOpenIndex(root, toc, { pos: 5000, queueTotal: 38000 })?.id).toBe(ch1.id);
    expect(pickScopedOpenIndex(root, toc, { pos: 1, sectionId: ch2.id })?.id).toBe(ch2.id);
  });
});
