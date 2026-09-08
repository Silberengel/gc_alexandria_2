import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('mercury unavailable cooldown', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns empty and skips further calls for a cooldown window', async () => {
    vi.useFakeTimers();
    const { mercuryFilter, isMercuryUnavailable } = await import('./mercury');
    const first = await mercuryFilter({ kinds: [30040], limit: 1 });
    expect(first).toEqual([]);
    expect(isMercuryUnavailable()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    const second = await mercuryFilter({ kinds: [30040], limit: 1 });
    expect(second).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    await mercuryFilter({ kinds: [1], limit: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
