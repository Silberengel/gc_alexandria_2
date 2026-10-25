import { describe, expect, it } from 'vitest';
import { diffHasChanges, diffLines } from './text-diff';

describe('diffLines', () => {
  it('marks added and removed lines', () => {
    const lines = diffLines('one\ntwo\nthree', 'one\nTWO\nthree\nfour');
    expect(lines).toEqual([
      { type: 'same', text: 'one' },
      { type: 'del', text: 'two' },
      { type: 'add', text: 'TWO' },
      { type: 'same', text: 'three' },
      { type: 'add', text: 'four' }
    ]);
    expect(diffHasChanges(lines)).toBe(true);
  });

  it('returns only same lines when identical', () => {
    const lines = diffLines('a\nb', 'a\nb');
    expect(lines.every((l) => l.type === 'same')).toBe(true);
    expect(diffHasChanges(lines)).toBe(false);
  });
});
