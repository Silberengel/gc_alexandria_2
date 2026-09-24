import { describe, expect, it } from 'vitest';
import { nextTrackedPos } from './reading-queue-actions';

describe('nextTrackedPos', () => {
  it('only advances forward', () => {
    expect(nextTrackedPos(10, 12)).toBe(12);
    expect(nextTrackedPos(10, 10)).toBe(10);
    expect(nextTrackedPos(10, 3)).toBe(10);
    expect(nextTrackedPos(0, 0)).toBe(0);
  });
});
