import { describe, expect, it } from 'vitest';
import {
  AUTHOR_ROLE_OTHER,
  authorRoleSelectValue,
  authorRowsFromRaw,
  formatAuthors,
  parseAuthorLine,
  splitAuthors
} from './compose-publication-authors';

describe('compose-publication-authors', () => {
  it('parses pipe and paren roles', () => {
    expect(parseAuthorLine('Ada|translator')).toEqual({ name: 'Ada', role: 'translator' });
    expect(parseAuthorLine('Ada (translator)')).toEqual({ name: 'Ada', role: 'translator' });
    expect(parseAuthorLine('Bob')).toEqual({ name: 'Bob', role: null });
  });

  it('splits semicolon and newline lists', () => {
    expect(splitAuthors('Ada|translator\nBob;Carol (ghostwriter)')).toEqual([
      { name: 'Ada', role: 'translator' },
      { name: 'Bob', role: null },
      { name: 'Carol', role: 'ghostwriter' }
    ]);
  });

  it('formats rows like imwald (omit default author role)', () => {
    expect(
      formatAuthors([
        { name: 'Ada', role: 'translator' },
        { name: 'Bob', role: 'author' },
        { name: '', role: 'author' }
      ])
    ).toBe('Ada|translator\nBob\n');
  });

  it('builds editor rows with default role author', () => {
    expect(authorRowsFromRaw('')).toEqual([{ name: '', role: 'author' }]);
    expect(authorRowsFromRaw('Ada|translator\nBob')).toEqual([
      { name: 'Ada', role: 'translator' },
      { name: 'Bob', role: 'author' }
    ]);
  });

  it('round-trips editor rows through format/parse', () => {
    const raw = formatAuthors([
      { name: 'Ada', role: 'translator' },
      { name: 'Bob', role: 'author' }
    ]);
    expect(authorRowsFromRaw(raw)).toEqual([
      { name: 'Ada', role: 'translator' },
      { name: 'Bob', role: 'author' }
    ]);
    expect(splitAuthors(raw)).toEqual([
      { name: 'Ada', role: 'translator' },
      { name: 'Bob', role: null }
    ]);
  });

  it('maps known roles to the dropdown and unknown to other', () => {
    expect(authorRoleSelectValue('translator')).toBe('translator');
    expect(authorRoleSelectValue('editor')).toBe('editor');
    expect(authorRoleSelectValue('annotator')).toBe('annotator');
    expect(authorRoleSelectValue('preface')).toBe('preface');
    expect(authorRoleSelectValue('cartographer')).toBe('cartographer');
    expect(authorRoleSelectValue('narrator')).toBe(AUTHOR_ROLE_OTHER);
    expect(authorRoleSelectValue('')).toBe('author');
  });
});
