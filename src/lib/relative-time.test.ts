import { describe, expect, it } from 'vitest';
import { formatAbsoluteTime, formatRelativeTime } from './relative-time';

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 8, 22, 14, 0, 0); // 2026-09-22T14:00:00Z

  it('formats recent seconds and minutes', () => {
    expect(formatRelativeTime(Math.floor(now / 1000) - 10, now, 'en')).toMatch(/second|now/i);
    expect(formatRelativeTime(Math.floor(now / 1000) - 120, now, 'en')).toMatch(/2 minutes/i);
  });

  it('formats hours and days', () => {
    expect(formatRelativeTime(Math.floor(now / 1000) - 7200, now, 'en')).toMatch(/2 hours/i);
    expect(formatRelativeTime(Math.floor(now / 1000) - 86400 * 3, now, 'en')).toMatch(/3 days/i);
  });

  it('returns empty for invalid input', () => {
    expect(formatRelativeTime(0, now)).toBe('');
    expect(formatRelativeTime(Number.NaN, now)).toBe('');
  });
});

describe('formatAbsoluteTime', () => {
  it('returns a locale string for a valid timestamp', () => {
    expect(formatAbsoluteTime(1_700_000_000).length).toBeGreaterThan(4);
  });
});
