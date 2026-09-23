import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  bibleDisplay,
  groupReaderSections,
  isBibleSection,
  offersVerseStyling
} from './bible-verse';

function section(over: Partial<Event> & { tags?: string[][] }): Event {
  return {
    id: over.id ?? 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: over.kind ?? 30041,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: 'c'.repeat(128)
  };
}

describe('isBibleSection', () => {
  it('matches type=bible on kind 30041', () => {
    expect(isBibleSection(section({ tags: [['type', 'bible'], ['title', '1:1']] }))).toBe(true);
    expect(isBibleSection(section({ tags: [['type', 'Bible']] }))).toBe(true);
    expect(isBibleSection(section({ tags: [['type', 'essay']] }))).toBe(false);
    expect(isBibleSection(section({ kind: 30040, tags: [['type', 'bible']] }))).toBe(false);
  });
});

describe('bibleDisplay', () => {
  it('prefers c/s tags', () => {
    expect(
      bibleDisplay(
        section({
          tags: [
            ['type', 'bible'],
            ['title', '1:1'],
            ['c', '1'],
            ['s', '1']
          ]
        })
      )
    ).toEqual({ kind: 'verse', chapter: '1', verse: '1', label: '1:1' });
  });

  it('parses title when c/s are absent', () => {
    expect(bibleDisplay(section({ tags: [['type', 'bible'], ['title', '12:3']] }))).toEqual({
      kind: 'verse',
      chapter: '12',
      verse: '3',
      label: '12:3'
    });
  });

  it('treats preamble-style titles as headings', () => {
    expect(bibleDisplay(section({ tags: [['type', 'bible'], ['title', 'Preamble']] }))).toEqual({
      kind: 'heading',
      title: 'Preamble'
    });
  });
});

describe('offersVerseStyling', () => {
  it('matches edition type/C tags or loaded bible sections', () => {
    expect(offersVerseStyling(section({ kind: 30040, tags: [['type', 'bible']] }))).toBe(true);
    expect(offersVerseStyling(section({ kind: 30040, tags: [['C', 'bible']] }))).toBe(true);
    expect(offersVerseStyling(section({ kind: 30040, tags: [['type', 'essay']] }))).toBe(false);
    expect(
      offersVerseStyling(section({ kind: 30040, tags: [['type', 'essay']] }), [
        section({ tags: [['type', 'bible'], ['title', '1:1']] })
      ])
    ).toBe(true);
  });
});

describe('groupReaderSections', () => {
  it('collapses consecutive bible verses and keeps indexes as blocks', () => {
    const index = section({
      id: '1'.repeat(64),
      kind: 30040,
      tags: [['d', 'exodus'], ['title', 'Exodus']]
    });
    const v1 = section({
      id: '2'.repeat(64),
      tags: [
        ['type', 'bible'],
        ['title', '1:1'],
        ['c', '1'],
        ['s', '1']
      ],
      content: 'one'
    });
    const v2 = section({
      id: '3'.repeat(64),
      tags: [
        ['type', 'bible'],
        ['title', '1:2'],
        ['c', '1'],
        ['s', '2']
      ],
      content: 'two'
    });
    const groups = groupReaderSections([index, v1, v2]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ kind: 'block', event: index });
    expect(groups[1]?.kind).toBe('bible');
    if (groups[1]?.kind === 'bible') expect(groups[1].verses.map((e) => e.id)).toEqual([v1.id, v2.id]);
  });
});
