import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';

const memoryFindByAddress = vi.fn();
const memoryGetEvent = vi.fn();
const cacheFindByAddress = vi.fn();
const cacheGetEvent = vi.fn();
const mercuryFilter = vi.fn();
const query = vi.fn();

vi.mock('./event-memory', () => ({
  memoryFindByAddress: (...args: unknown[]) => memoryFindByAddress(...args),
  memoryGetEvent: (...args: unknown[]) => memoryGetEvent(...args)
}));

vi.mock('./cache', () => ({
  cacheFindByAddress: (...args: unknown[]) => cacheFindByAddress(...args),
  cacheGetEvent: (...args: unknown[]) => cacheGetEvent(...args)
}));

vi.mock('./mercury', () => ({
  mercuryFilter: (...args: unknown[]) => mercuryFilter(...args)
}));

vi.mock('./pool', () => ({
  relayPool: { query: (...args: unknown[]) => query(...args) }
}));

vi.mock('./selector', () => ({
  documentStack: () => ['wss://example.com'],
  wikiStack: () => ['wss://example.com']
}));

function ev(partial: Partial<Event> & Pick<Event, 'id' | 'kind' | 'pubkey'>): Event {
  return {
    created_at: 1,
    tags: [['d', 'jane']],
    content: '',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('fetch cache fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    memoryFindByAddress.mockReset().mockReturnValue(null);
    memoryGetEvent.mockReset().mockReturnValue(null);
    cacheFindByAddress.mockReset().mockResolvedValue(null);
    cacheGetEvent.mockReset().mockResolvedValue(null);
    mercuryFilter.mockReset().mockResolvedValue([]);
    query.mockReset().mockResolvedValue([]);
  });

  it('returns a cached addressable event without hitting the network', async () => {
    const cached = ev({ id: 'a'.repeat(64), kind: 30040, pubkey: 'b'.repeat(64) });
    memoryFindByAddress.mockReturnValue(cached);
    const { fetchByAddress } = await import('./fetch');
    await expect(fetchByAddress(`30040:${'b'.repeat(64)}:jane`)).resolves.toBe(cached);
    expect(mercuryFilter).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a cached id event without hitting the network', async () => {
    const cached = ev({ id: 'd'.repeat(64), kind: 1, pubkey: 'e'.repeat(64), tags: [] });
    memoryGetEvent.mockReturnValue(cached);
    const { fetchById } = await import('./fetch');
    await expect(fetchById(cached.id)).resolves.toBe(cached);
    expect(mercuryFilter).not.toHaveBeenCalled();
  });

  it('returns null only when neither cache nor live has the event', async () => {
    const { fetchByAddress } = await import('./fetch');
    await expect(fetchByAddress(`30040:${'b'.repeat(64)}:missing`)).resolves.toBeNull();
  });
});
