import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';

vi.mock('./nostr/pool', () => ({
  relayPool: {
    query: vi.fn()
  }
}));

vi.mock('./nostr/selector', () => ({
  documentStack: vi.fn(() => ['wss://relay.example'])
}));

vi.mock('./sign', () => ({
  withClientTag: (tags: string[][]) => tags,
  publishSigned: vi.fn(async () => true),
  signUnsigned: vi.fn(),
  consumeSignFailure: vi.fn(() => null)
}));

vi.mock('./nostr/event-memory', () => ({
  rememberEvents: vi.fn()
}));

import { relayPool } from './nostr/pool';
import { publishSigned } from './sign';
import { retryPublicationSplitEvents, verifyEventOnRelays } from './publication-split-publish';

function fakeEvent(partial: Partial<Event> & { id: string; d: string }): Event {
  return {
    id: partial.id,
    pubkey: partial.pubkey ?? 'ab'.repeat(32),
    created_at: partial.created_at ?? 1,
    kind: partial.kind ?? 30041,
    tags: partial.tags ?? [
      ['d', partial.d],
      ['title', 'T']
    ],
    content: partial.content ?? 'body',
    sig: partial.sig ?? '00'
  };
}

describe('verifyEventOnRelays', () => {
  beforeEach(() => {
    vi.mocked(relayPool.query).mockReset();
  });

  it('confirms by id from a live relay query (not memory)', async () => {
    const ev = fakeEvent({ id: 'aa'.repeat(32), d: 'ch-1' });
    vi.mocked(relayPool.query).mockResolvedValueOnce([ev]);
    await expect(verifyEventOnRelays(ev)).resolves.toBe(true);
    expect(relayPool.query).toHaveBeenCalledWith(
      ['wss://relay.example'],
      [{ ids: [ev.id], limit: 1 }],
      6_000
    );
  });

  it('falls back to address lookup when id query misses', async () => {
    const ev = fakeEvent({ id: 'bb'.repeat(32), d: 'ch-2' });
    vi.mocked(relayPool.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ev]);
    await expect(verifyEventOnRelays(ev)).resolves.toBe(true);
    expect(relayPool.query).toHaveBeenCalledTimes(2);
  });

  it('returns false when relays do not have the event', async () => {
    const ev = fakeEvent({ id: 'cc'.repeat(32), d: 'ch-3' });
    vi.mocked(relayPool.query).mockResolvedValue([]);
    await expect(verifyEventOnRelays(ev)).resolves.toBe(false);
  });
});

describe('retryPublicationSplitEvents', () => {
  beforeEach(() => {
    vi.mocked(relayPool.query).mockReset();
    vi.mocked(publishSigned).mockReset().mockResolvedValue(true);
  });

  it('republishes then re-verifies and reports remaining misses', async () => {
    const ok = fakeEvent({ id: '11'.repeat(32), d: 'ok' });
    const miss = fakeEvent({ id: '22'.repeat(32), d: 'miss' });
    vi.mocked(relayPool.query).mockImplementation(async (_relays, filters) => {
      const ids = (filters[0] as { ids?: string[] }).ids;
      if (ids?.includes(ok.id)) return [ok];
      return [];
    });

    const result = await retryPublicationSplitEvents({ events: [ok, miss] });
    expect(publishSigned).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingDTags).toEqual(['miss']);
    expect(result.missingEvents.map((e) => e.id)).toEqual([miss.id]);
  });

  it('succeeds when every event verifies after republish', async () => {
    const a = fakeEvent({ id: '33'.repeat(32), d: 'a' });
    vi.mocked(relayPool.query).mockResolvedValue([a]);
    const result = await retryPublicationSplitEvents({ events: [a] });
    expect(result).toEqual({ ok: true, events: [a] });
  });
});
