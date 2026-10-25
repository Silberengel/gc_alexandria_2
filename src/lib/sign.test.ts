import { describe, expect, it } from 'vitest';
import { ALEXANDRIA_CLIENT } from './constants';
import { withClientTag } from './sign';

describe('client tag', () => {
  it('always strips client tags and appends ["client", "alexandria"]', () => {
    expect(ALEXANDRIA_CLIENT).toBe('alexandria');
    expect(withClientTag([['d', 'book']])).toEqual([
      ['d', 'book'],
      ['client', 'alexandria']
    ]);
    expect(withClientTag([['client', 'Bookshelf'], ['a', '30040:aa:book']])).toEqual([
      ['a', '30040:aa:book'],
      ['client', 'alexandria']
    ]);
    expect(
      withClientTag([
        ['e', 'ab'],
        ['client', 'Alexandria'],
        ['client', 'alexandria', 'extra']
      ])
    ).toEqual([
      ['e', 'ab'],
      ['client', 'alexandria']
    ]);
  });
});
