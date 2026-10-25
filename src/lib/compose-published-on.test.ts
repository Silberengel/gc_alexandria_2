import { describe, expect, it } from 'vitest';
import {
  formatPublishedOn,
  fromIsoDateValue,
  parsePublishedOn,
  toIsoDateValue
} from './compose-published-on';

describe('compose-published-on', () => {
  it('formats UTC days as dd.mm.yyyy', () => {
    expect(formatPublishedOn(new Date(Date.UTC(1847, 9, 16)))).toBe('16.10.1847');
  });

  it('parses dd.mm.yyyy and bare years', () => {
    expect(parsePublishedOn('16.10.1847')?.toISOString()).toBe('1847-10-16T00:00:00.000Z');
    expect(parsePublishedOn('1847')?.toISOString()).toBe('1847-01-01T00:00:00.000Z');
    expect(parsePublishedOn('')).toBeNull();
    expect(parsePublishedOn('32.01.2000')).toBeNull();
  });

  it('round-trips through iso date values', () => {
    const date = parsePublishedOn('01.03.2020')!;
    expect(toIsoDateValue(date)).toBe('2020-03-01');
    expect(formatPublishedOn(fromIsoDateValue('2020-03-01')!)).toBe('01.03.2020');
  });
});
