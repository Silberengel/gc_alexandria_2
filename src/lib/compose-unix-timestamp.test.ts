import { describe, expect, it } from 'vitest';
import {
  datetimeLocalToUnix,
  parseUnixSeconds,
  unixToDatetimeLocal
} from './compose-unix-timestamp';

describe('compose-unix-timestamp', () => {
  it('parses integer unix strings', () => {
    expect(parseUnixSeconds('1700000000')).toBe(1700000000);
    expect(parseUnixSeconds('7d')).toBeNull();
    expect(parseUnixSeconds('')).toBeNull();
  });

  it('round-trips datetime-local in the local zone', () => {
    const unix = datetimeLocalToUnix('2024-06-15T18:30')!;
    expect(unix).toBeTypeOf('number');
    expect(unixToDatetimeLocal(unix)).toBe('2024-06-15T18:30');
  });
});
