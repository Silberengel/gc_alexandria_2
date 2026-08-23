import { describe, expect, it } from 'vitest';
import { normalizeSearchKey } from './search';

describe('normalizeSearchKey', () => {
  it('folds case and whitespace so repeats hit the same snapshot', () => {
    expect(normalizeSearchKey('  Mansfield   Park ')).toBe('mansfield park');
    expect(normalizeSearchKey('MANSFIELD PARK')).toBe(normalizeSearchKey('mansfield park'));
  });
});
