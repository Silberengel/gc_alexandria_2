import { describe, expect, it } from 'vitest';
import { clampReadingSize } from './stores/appearance';

describe('clampReadingSize', () => {
  it('keeps values in the Settings 14–28 range', () => {
    expect(clampReadingSize(18)).toBe(18);
    expect(clampReadingSize(14)).toBe(14);
    expect(clampReadingSize(28)).toBe(28);
    expect(clampReadingSize(10)).toBe(14);
    expect(clampReadingSize(40)).toBe(28);
    expect(clampReadingSize(Number.NaN)).toBe(18);
  });
});
