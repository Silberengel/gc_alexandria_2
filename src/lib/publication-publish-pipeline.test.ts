import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';

vi.mock('./nostr/pool', () => ({
  relayPool: {
    query: vi.fn()
  }
}));

vi.mock('./nostr/selector', () => ({
  documentStack: vi.fn(() => ['wss://doc.example']),
  writeStack: vi.fn(() => ['wss://write.example'])
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
import { publishSigned, signUnsigned } from './sign';
import { rememberEvents } from './nostr/event-memory';
import {
  publishAndVerifyEvents,
  retryPublicationEvents,
  verifyEventOnRelays
} from './publication-publish-pipeline';

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
      ['wss://write.example', 'wss://doc.example'],
      [{ ids: [ev.id], limit: 1 }],
      6_000
    );
  });

  it('queries write and document relays together', async () => {
    const { publicationVerifyRelays } = await import('./publication-publish-pipeline');
    expect(publicationVerifyRelays()).toEqual([
      'wss://write.example',
      'wss://doc.example'
    ]);
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

describe('publishAndVerifyEvents', () => {
  beforeEach(() => {
    vi.mocked(relayPool.query).mockReset();
    vi.mocked(publishSigned).mockReset().mockResolvedValue(true);
    vi.mocked(signUnsigned).mockReset();
    vi.mocked(rememberEvents).mockReset();
  });

  it('signs, publishes, verifies, and reports signing phase', async () => {
    const signed = fakeEvent({ id: '11'.repeat(32), d: 'one' });
    vi.mocked(signUnsigned).mockResolvedValueOnce(signed);
    vi.mocked(relayPool.query).mockResolvedValue([signed]);
    const phases: string[] = [];
    const result = await publishAndVerifyEvents({
      items: [
        {
          key: 'one',
          label: 'One',
          buildPartial: () => ({ kind: 30041, content: 'x', tags: [['d', 'one']] })
        }
      ],
      onProgress: (p) => phases.push(p.phase)
    });
    expect(result.ok).toBe(true);
    expect(phases).toContain('signing');
    expect(phases).toContain('publishing');
    expect(phases).toContain('verifying');
    expect(phases).toContain('done');
    expect(rememberEvents).toHaveBeenCalledWith([signed]);
  });

  it('republishes once when verify misses then succeeds', async () => {
    const signed = fakeEvent({ id: '22'.repeat(32), d: 'two' });
    vi.mocked(signUnsigned).mockResolvedValueOnce(signed);
    // First verify pass: id + address lookups both empty. After republish: hit.
    let round = 0;
    vi.mocked(relayPool.query).mockImplementation(async () => {
      round += 1;
      return round <= 2 ? [] : [signed];
    });
    const phases: string[] = [];
    const result = await publishAndVerifyEvents({
      items: [
        {
          key: 'two',
          label: 'Two',
          buildPartial: () => ({ kind: 30041, content: 'y', tags: [['d', 'two']] })
        }
      ],
      onProgress: (p) => phases.push(p.phase)
    });
    expect(result.ok).toBe(true);
    expect(phases).toContain('republishing');
    expect(publishSigned).toHaveBeenCalledTimes(2);
  });

  it('returns failure when sign fails', async () => {
    vi.mocked(signUnsigned).mockResolvedValueOnce(null);
    const result = await publishAndVerifyEvents({
      items: [
        {
          key: 'x',
          label: 'X',
          buildPartial: () => ({ kind: 30041, content: '', tags: [['d', 'x']] })
        }
      ]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/sign/i);
    expect(result.canContinueSigning).toBe(true);
  });

  it('resumes from alreadySigned without re-signing those keys', async () => {
    const kept = fakeEvent({ id: '55'.repeat(32), d: 'kept' });
    const next = fakeEvent({ id: '66'.repeat(32), d: 'next' });
    vi.mocked(signUnsigned).mockResolvedValueOnce(next);
    vi.mocked(relayPool.query).mockResolvedValue([kept, next]);
    const result = await publishAndVerifyEvents({
      alreadySigned: [kept],
      items: [
        {
          key: 'kept',
          label: 'Kept',
          buildPartial: () => ({ kind: 30041, content: '', tags: [['d', 'kept']] })
        },
        {
          key: 'next',
          label: 'Next',
          buildPartial: () => ({ kind: 30041, content: '', tags: [['d', 'next']] })
        }
      ]
    });
    expect(result.ok).toBe(true);
    expect(signUnsigned).toHaveBeenCalledTimes(1);
    expect(publishSigned).toHaveBeenCalledTimes(1);
    expect(publishSigned).toHaveBeenCalledWith(next);
    if (!result.ok) return;
    expect(result.events.map((e) => e.id)).toEqual([kept.id, next.id]);
  });
});

describe('retryPublicationEvents', () => {
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

    const result = await retryPublicationEvents({ events: [ok, miss] });
    expect(publishSigned).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingDTags).toEqual(['miss']);
    expect(result.missingEvents.map((e) => e.id)).toEqual([miss.id]);
  });

  it('succeeds when every event verifies after republish', async () => {
    const a = fakeEvent({ id: '33'.repeat(32), d: 'a' });
    vi.mocked(relayPool.query).mockResolvedValue([a]);
    const result = await retryPublicationEvents({ events: [a] });
    expect(result).toEqual({ ok: true, events: [a] });
  });
});
