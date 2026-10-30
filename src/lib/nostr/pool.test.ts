import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';

vi.mock('./cache', () => ({
  cachePutMany: async () => {}
}));

vi.mock('./event-sources', () => ({
  noteEventSource: () => {}
}));

vi.mock('./mercury', () => ({
  isMercuryUnavailable: () => true,
  isMercuryDocumentFilter: () => false
}));

vi.mock('./selector', () => ({
  constrainRelays: (urls: string[]) => urls
}));

vi.mock('./verify', () => ({
  ingestEvent: (raw: unknown) => raw as Event
}));

vi.mock('./relay-filters', () => ({
  normalizeRelayFilters: (filters: unknown[]) => filters,
  webSocketRelays: (urls: string[]) => urls,
  writeWebSocketRelays: (urls: string[]) => urls
}));

type SubHandlers = {
  onevent?: (event: Event) => void;
  oneose?: () => void;
  onclose?: () => void;
};

const subscribeMap = vi.fn();

vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    subscribeMap(_reqs: unknown[], handlers: SubHandlers) {
      return subscribeMap(handlers);
    }
    publish() {
      return [];
    }
    close() {}
  }
}));

function fakeEvent(id: string): Event {
  return {
    id: id.padEnd(64, '0').slice(0, 64),
    kind: 1,
    pubkey: 'a'.repeat(64),
    created_at: 1,
    tags: [],
    content: id,
    sig: 'b'.repeat(128)
  };
}

describe('RelayPool query sheds', () => {
  beforeEach(() => {
    vi.resetModules();
    subscribeMap.mockReset();
  });

  it('non-priority waits briefly for a slot instead of returning [] immediately', async () => {
    const { RelayPool } = await import('./pool');
    const pool = new RelayPool();

    let active = 0;
    let released = 0;
    subscribeMap.mockImplementation((handlers: SubHandlers) => {
      active += 1;
      const mine = active;
      // Hold early REQs long enough to saturate MAX_PARALLEL_QUERIES (4).
      const delay = mine <= 4 ? 80 : 10;
      const timer = setTimeout(() => {
        handlers.onevent?.(fakeEvent(`evt${mine}`));
        handlers.oneose?.();
        active -= 1;
        released += 1;
      }, delay);
      return {
        close: () => {
          clearTimeout(timer);
        }
      };
    });

    // One host each so per-host depth shed does not fire — only the global slot cap.
    // Fifth query misses the fast slot grab, then waits BACKGROUND_SLOT_WAIT_MS.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        pool.query([`wss://test-slot-${i}.example`], [{ kinds: [1], limit: 1 }], 2000, 1)
      )
    );

    expect(results.every((batch) => batch.length === 1)).toBe(true);
    expect(released).toBeGreaterThanOrEqual(5);
    pool.close();
  });

  it('priority still runs when the host queue is already at capacity', async () => {
    const { RelayPool } = await import('./pool');
    const pool = new RelayPool();
    const relay = 'wss://test-depth.example';

    let started = 0;
    subscribeMap.mockImplementation((handlers: SubHandlers) => {
      started += 1;
      const n = started;
      const delay = n <= 2 ? 60 : 5;
      const timer = setTimeout(() => {
        handlers.onevent?.(fakeEvent(`p${n}`));
        handlers.oneose?.();
      }, delay);
      return {
        close: () => {
          clearTimeout(timer);
        }
      };
    });

    // Fill host queue depth (2), then fire a priority nav query that must not shed.
    const background = [
      pool.query([relay], [{ kinds: [1], authors: ['1'.repeat(64)], limit: 1 }], 2000, 1),
      pool.query([relay], [{ kinds: [1], authors: ['2'.repeat(64)], limit: 1 }], 2000, 1)
    ];
    await new Promise((r) => setTimeout(r, 5));
    const priority = pool.query(
      [relay],
      [{ kinds: [1], authors: ['3'.repeat(64)], limit: 1 }],
      2000,
      1,
      undefined,
      { priority: true }
    );
    const [a, b, c] = await Promise.all([...background, priority]);
    expect(a.length + b.length).toBeGreaterThan(0);
    expect(c.length).toBe(1);
    expect(started).toBeGreaterThanOrEqual(3);
    pool.close();
  });
});
