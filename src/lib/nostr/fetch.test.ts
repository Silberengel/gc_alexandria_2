import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';

const memoryFindByAddress = vi.fn();
const memoryGetEvent = vi.fn();
const cacheFindByAddress = vi.fn();
const cacheGetEvent = vi.fn();
const cacheDeleteEvent = vi.fn();
const mercuryFilter = vi.fn();
const query = vi.fn();

vi.mock('./event-memory', () => ({
  memoryFindByAddress: (...args: unknown[]) => memoryFindByAddress(...args),
  memoryGetEvent: (...args: unknown[]) => memoryGetEvent(...args),
  rememberEvents: () => {}
}));

vi.mock('./cache', () => ({
  cacheFindByAddress: (...args: unknown[]) => cacheFindByAddress(...args),
  cacheGetEvent: (...args: unknown[]) => cacheGetEvent(...args),
  cacheDeleteEvent: (...args: unknown[]) => cacheDeleteEvent(...args)
}));

vi.mock('./mercury', () => ({
  mercuryFilter: (...args: unknown[]) => mercuryFilter(...args),
  isMercuryUnavailable: () => false
}));

vi.mock('../deletions', () => ({
  isEventDeleted: () => false,
  refreshDeletionsFor: async () => {},
  filterDeletedEvents: (events: Event[]) => events
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
    cacheDeleteEvent.mockReset().mockResolvedValue(undefined);
    mercuryFilter.mockReset().mockResolvedValue([]);
    query.mockReset().mockResolvedValue([]);
  });

  it('returns a rich cached 30040 without hitting the network', async () => {
    const cached = ev({
      id: 'a'.repeat(64),
      kind: 30040,
      pubkey: 'b'.repeat(64),
      tags: [
        ['d', 'jane'],
        ['a', `30041:${'b'.repeat(64)}:ch1`]
      ]
    });
    memoryFindByAddress.mockReturnValue(cached);
    const { fetchByAddress } = await import('./fetch');
    await expect(fetchByAddress(`30040:${'b'.repeat(64)}:jane`)).resolves.toBe(cached);
    expect(mercuryFilter).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('refreshes a thin cached 30040 (no a/e tags) from the network', async () => {
    const thin = ev({ id: 'a'.repeat(64), kind: 30040, pubkey: 'b'.repeat(64) });
    const rich = ev({
      id: 'f'.repeat(64),
      kind: 30040,
      pubkey: 'b'.repeat(64),
      created_at: 2,
      tags: [
        ['d', 'jane'],
        ['a', `30041:${'b'.repeat(64)}:ch1`]
      ]
    });
    memoryFindByAddress.mockReturnValue(thin);
    query.mockResolvedValue([rich]);
    const { fetchByAddress } = await import('./fetch');
    await expect(fetchByAddress(`30040:${'b'.repeat(64)}:jane`)).resolves.toBe(rich);
    expect(query).toHaveBeenCalled();
  });

  it('does not let a fast thin Mercury 30040 beat a richer relay copy', async () => {
    const thin = ev({ id: 'a'.repeat(64), kind: 30040, pubkey: 'b'.repeat(64) });
    const rich = ev({
      id: 'f'.repeat(64),
      kind: 30040,
      pubkey: 'b'.repeat(64),
      created_at: 2,
      tags: [
        ['d', 'jane'],
        ['a', `30041:${'b'.repeat(64)}:ch1`]
      ]
    });
    mercuryFilter.mockResolvedValue([thin]);
    query.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([rich]), 30))
    );
    const { fetchByAddress } = await import('./fetch');
    await expect(fetchByAddress(`30040:${'b'.repeat(64)}:jane`)).resolves.toBe(rich);
  });

  it('relaysOnly skips Mercury for citadel-only walks', async () => {
    const rich = ev({
      id: 'f'.repeat(64),
      kind: 30040,
      pubkey: 'b'.repeat(64),
      tags: [
        ['d', 'jane'],
        ['a', `30041:${'b'.repeat(64)}:ch1`]
      ]
    });
    query.mockResolvedValue([rich]);
    const { fetchByAddress } = await import('./fetch');
    await expect(
      fetchByAddress(`30040:${'b'.repeat(64)}:jane`, { relaysOnly: true })
    ).resolves.toBe(rich);
    expect(mercuryFilter).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
  });

  it('returns a cached id event without hitting the network', async () => {
    const cached = ev({ id: 'd'.repeat(64), kind: 1, pubkey: 'e'.repeat(64), tags: [] });
    memoryGetEvent.mockReturnValue(cached);
    const { fetchById } = await import('./fetch');
    await expect(fetchById(cached.id)).resolves.toBe(cached);
    expect(mercuryFilter).not.toHaveBeenCalled();
  });

  it('falls back to relays when Mercury misses', async () => {
    const live = ev({ id: 'f'.repeat(64), kind: 30040, pubkey: 'b'.repeat(64) });
    query.mockResolvedValue([live]);
    const { fetchByAddress } = await import('./fetch');
    await expect(fetchByAddress(`30040:${'b'.repeat(64)}:jane`)).resolves.toBe(live);
    expect(query).toHaveBeenCalled();
  });

  it('returns null only when neither cache nor live has the event', async () => {
    const { fetchByAddress } = await import('./fetch');
    await expect(fetchByAddress(`30040:${'b'.repeat(64)}:missing`)).resolves.toBeNull();
  });
});
