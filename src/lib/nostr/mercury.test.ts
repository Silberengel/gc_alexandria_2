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

describe('parsePublicationStreamNdjson', () => {
  it('unwraps NDJSON publication stream rows in pos order', async () => {
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools');
    const { parsePublicationStreamNdjson } = await import('./mercury');
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const a = finalizeEvent(
      { kind: 30041, created_at: 1, tags: [['d', 'ch1']], content: 'one' },
      sk
    );
    const b = finalizeEvent(
      { kind: 30023, created_at: 1, tags: [['d', 'ch2']], content: 'two' },
      sk
    );
    expect(a.pubkey).toBe(pk);
    const text = [
      JSON.stringify({ pos: 0, kind: 30041, d: 'ch1', id: a.id, event: a }),
      JSON.stringify({ pos: 1, kind: 30023, d: 'ch2', id: b.id, event: b })
    ].join('\n');
    const events = parsePublicationStreamNdjson(text);
    expect(events.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(events[1]?.kind).toBe(30023);
  });
});
