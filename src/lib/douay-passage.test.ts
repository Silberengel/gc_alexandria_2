import { describe, expect, it } from 'vitest';
import {
  douayPassageHashPath,
  douayPassagePublicationPath,
  isDouayPassagePath,
  parseDouayPassage,
  parseDouayPath,
  parseVerseQuery,
  verseInRange
} from './douay-passage';
import type { Event } from 'nostr-tools';

describe('parseDouayPath', () => {
  it('accepts Biblestr book/chapter paths', () => {
    expect(parseDouayPath('/luke/9')?.book.slug).toBe('luke');
    expect(parseDouayPath('/luke/9')?.chapter).toBe(9);
    expect(parseDouayPath('genesis/1')?.book.code).toBe('genesis');
    expect(isDouayPassagePath('/luke/9')).toBe(true);
  });

  it('rejects unknown books and out-of-range chapters', () => {
    expect(parseDouayPath('/not-a-book/1')).toBeNull();
    expect(parseDouayPath('/luke/99')).toBeNull();
    expect(parseDouayPath('/luke')).toBeNull();
    expect(isDouayPassagePath('/settings')).toBe(false);
  });
});

describe('parseVerseQuery', () => {
  it('parses verse and verses like Biblestr', () => {
    expect(parseVerseQuery('?verses=46-50')).toEqual({ start: 46, end: 50 });
    expect(parseVerseQuery('verse=12')).toEqual({ start: 12, end: 12 });
    expect(parseVerseQuery(new URLSearchParams('verses=3-1'))).toEqual({ start: 1, end: 3 });
    expect(parseVerseQuery('')).toBeNull();
  });
});

describe('parseDouayPassage', () => {
  it('combines path and verse query', () => {
    const focus = parseDouayPassage('/luke/9', '?verses=46-50');
    expect(focus?.book.slug).toBe('luke');
    expect(focus?.chapter).toBe(9);
    expect(focus?.verses).toEqual({ start: 46, end: 50 });
    expect(douayPassageHashPath(focus!)).toBe('/luke/9?verses=46-50');
    expect(douayPassagePublicationPath(focus!)).toContain('book=luke');
    expect(douayPassagePublicationPath(focus!)).toContain('chapter=9');
    expect(douayPassagePublicationPath(focus!)).toContain('verses=46-50');
    expect(douayPassagePublicationPath(focus!)).toContain('read=1');
  });
});

describe('verseInRange', () => {
  it('matches numeric s tags', () => {
    const ev = {
      tags: [
        ['s', '47'],
        ['c', '9']
      ]
    } as Event;
    expect(verseInRange(ev, { start: 46, end: 50 })).toBe(true);
    expect(verseInRange(ev, { start: 1, end: 5 })).toBe(false);
    expect(verseInRange(ev, null)).toBe(false);
  });
});
