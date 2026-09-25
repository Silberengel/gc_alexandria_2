import { describe, expect, it } from 'vitest';
import { pagerItems } from './pager';

describe('pagerItems', () => {
  it('lists every page when the set is small', () => {
    expect(pagerItems(1, 2)).toEqual([1, 2]);
    expect(pagerItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pagerItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps first and last with neighbors around the current page', () => {
    expect(pagerItems(1, 12)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 12]);
    expect(pagerItems(6, 12)).toEqual([1, 'ellipsis', 4, 5, 6, 7, 8, 'ellipsis', 12]);
    expect(pagerItems(12, 12)).toEqual([1, 'ellipsis', 8, 9, 10, 11, 12]);
  });

  it('clamps out-of-range page values', () => {
    expect(pagerItems(0, 3)).toEqual([1, 2, 3]);
    expect(pagerItems(99, 3)).toEqual([1, 2, 3]);
  });
});
