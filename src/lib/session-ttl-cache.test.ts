import { describe, expect, it, vi } from 'vitest';
import { SessionTtlCache } from './session-ttl-cache';

describe('SessionTtlCache', () => {
  it('returns cached values within the TTL and reloads after expiry', async () => {
    vi.useFakeTimers();
    const cache = new SessionTtlCache<number>(1000);
    let loads = 0;
    const load = async () => {
      loads += 1;
      return loads;
    };
    expect(await cache.getOrLoad('a', load)).toBe(1);
    expect(await cache.getOrLoad('a', load)).toBe(1);
    expect(loads).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(await cache.getOrLoad('a', load)).toBe(2);
    expect(loads).toBe(2);
    vi.useRealTimers();
  });

  it('caches null and coalesces inflight loads', async () => {
    const cache = new SessionTtlCache<string | null>(60_000);
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = async () => {
      loads += 1;
      await gate;
      return null;
    };
    const a = cache.getOrLoad('miss', load);
    const b = cache.getOrLoad('miss', load);
    release();
    expect(await a).toBeNull();
    expect(await b).toBeNull();
    expect(loads).toBe(1);
    expect(await cache.getOrLoad('miss', load)).toBeNull();
    expect(loads).toBe(1);
  });

  it('invalidates by prefix', async () => {
    const cache = new SessionTtlCache<string>(60_000);
    cache.set('dir:aa:root', 'a');
    cache.set('dir:aa:books', 'b');
    cache.set('dir:bb:root', 'c');
    cache.invalidate('dir:aa:');
    expect(cache.getFresh('dir:aa:root')).toBeUndefined();
    expect(cache.getFresh('dir:bb:root')?.value).toBe('c');
  });
});
