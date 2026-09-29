import { describe, expect, it } from 'vitest';
import { KIND } from './constants';
import {
  decodeProfileIdSegment,
  eventChronologySec,
  formatBlogDate,
  parseKindParam,
  profileKindHeading,
  profileKindPath
} from './profile-route';

describe('parseKindParam', () => {
  it('accepts valid uint16 kinds', () => {
    expect(parseKindParam('0')).toBe(0);
    expect(parseKindParam('1')).toBe(1);
    expect(parseKindParam('30023')).toBe(30023);
    expect(parseKindParam('65535')).toBe(65535);
  });

  it('rejects non-kind strings', () => {
    expect(parseKindParam('')).toBeNull();
    expect(parseKindParam('  ')).toBeNull();
    expect(parseKindParam('03')).toBeNull();
    expect(parseKindParam('30023.0')).toBeNull();
    expect(parseKindParam('-1')).toBeNull();
    expect(parseKindParam('65536')).toBeNull();
    expect(parseKindParam('abc')).toBeNull();
    expect(parseKindParam('1e3')).toBeNull();
    expect(parseKindParam(undefined)).toBeNull();
  });
});

describe('decodeProfileIdSegment', () => {
  it('decodes percent-encoded @', () => {
    expect(decodeProfileIdSegment('roland%40pareto.space')).toBe('roland@pareto.space');
    expect(decodeProfileIdSegment('roland@pareto.space')).toBe('roland@pareto.space');
  });
});

describe('profileKindHeading', () => {
  it('labels long-form as Articles', () => {
    expect(profileKindHeading(KIND.LONG_FORM)).toBe('Articles');
    expect(profileKindHeading(42)).toBe('Kind 42');
  });
});

describe('eventChronologySec', () => {
  it('prefers published_at', () => {
    expect(
      eventChronologySec({
        created_at: 10,
        tags: [['published_at', '100']]
      })
    ).toBe(100);
    expect(eventChronologySec({ created_at: 10, tags: [] })).toBe(10);
  });
});

describe('formatBlogDate', () => {
  it('formats a calendar date', () => {
    expect(formatBlogDate(1_700_000_000, 'en-US')).toMatch(/2023/);
  });
});

describe('profileKindPath', () => {
  it('keeps nip05 readable', () => {
    expect(profileKindPath('roland@pareto.space', 30023)).toBe('/p/roland@pareto.space/30023');
  });
});
