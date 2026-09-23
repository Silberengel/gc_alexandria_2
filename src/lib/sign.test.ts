import { describe, expect, it } from 'vitest';
import { ALEXANDRIA_CLIENT } from './constants';
import { withClientTag } from './sign';

describe('client tag', () => {
  it('stamps Alexandria on a draft and replaces another client', () => {
    expect(withClientTag([['d', 'book']])).toEqual([
      ['d', 'book'],
      ['client', ALEXANDRIA_CLIENT]
    ]);
    expect(withClientTag([['client', 'Bookshelf'], ['a', '30040:aa:book']])).toEqual([
      ['a', '30040:aa:book'],
      ['client', ALEXANDRIA_CLIENT]
    ]);
    const tagged = [['e', 'ab'], ['client', ALEXANDRIA_CLIENT]];
    expect(withClientTag(tagged)).toBe(tagged);
  });
});
