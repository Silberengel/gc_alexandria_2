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
    await mercuryFilter({ kinds: [30040], limit: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('skips HTTP when the filter has no document kinds', async () => {
    const { mercuryFilter } = await import('./mercury');
    expect(await mercuryFilter({ ids: ['a'.repeat(64)], limit: 1 })).toEqual([]);
    expect(await mercuryFilter({ kinds: [1985, 1111, 10003], limit: 10 })).toEqual([]);
    expect(await mercuryFilter({ authors: ['b'.repeat(64)], limit: 10 })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not start cooldown on AbortError or TimeoutError', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw abort;
      })
    );
    const { mercuryFilter, isMercuryUnavailable } = await import('./mercury');
    expect(await mercuryFilter({ kinds: [30040], limit: 1 })).toEqual([]);
    expect(isMercuryUnavailable()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    await mercuryFilter({ kinds: [30040], limit: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.resetModules();
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw timeout;
      })
    );
    const mercury = await import('./mercury');
    expect(await mercury.mercuryFilter({ kinds: [30023], limit: 1 })).toEqual([]);
    expect(mercury.isMercuryUnavailable()).toBe(false);
  });

  it('strips non-document kinds before HTTP', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    );
    const { mercuryFilter } = await import('./mercury');
    await mercuryFilter({ kinds: [30040, 30045, 1], limit: 10 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string);
    expect(body.kinds).toEqual([30040]);
  });
});

describe('mercury HTTP 500 cooldown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('treats filter 500 like an outage and skips further calls', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(' Internal Server Error', { status: 500 }))
    );
    const { mercuryFilter, isMercuryUnavailable } = await import('./mercury');
    const first = await mercuryFilter({ kinds: [30023], limit: 1 });
    expect(first).toEqual([]);
    expect(isMercuryUnavailable()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    await mercuryFilter({ kinds: [30023], limit: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('mercury publication 404 cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Not Found', { status: 404 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not re-request meta/toc/stream for an naddr that 404d', async () => {
    const { mercuryPublicationMeta, mercuryPublicationToc, mercuryPublicationStream } =
      await import('./mercury');
    const naddr = 'naddr1qqtest';
    await expect(mercuryPublicationMeta(naddr)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(mercuryPublicationToc(naddr)).resolves.toBeNull();
    await expect(mercuryPublicationStream(naddr)).resolves.toEqual([]);
    // toc/stream short-circuit on the 404 cache from meta — no further HTTP.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('mercuryPublicationStream paging', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invokes onPage as soon as the first page arrives', async () => {
    const { finalizeEvent, generateSecretKey } = await import('nostr-tools');
    const { mercuryPublicationStream, resetMercuryClientState } = await import('./mercury');
    resetMercuryClientState();
    const sk = generateSecretKey();
    const a = finalizeEvent(
      { kind: 30041, created_at: 1, tags: [['d', 'ch1']], content: 'one' },
      sk
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ pos: 0, kind: 30041, d: 'ch1', id: a.id, event: a }) + '\n',
          { status: 200 }
        );
      })
    );
    const pages: string[][] = [];
    const all = await mercuryPublicationStream('naddr1qq', undefined, undefined, (page) => {
      pages.push(page.map((e) => e.id));
    });
    expect(pages).toEqual([[a.id]]);
    expect(all.map((e) => e.id)).toEqual([a.id]);
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
