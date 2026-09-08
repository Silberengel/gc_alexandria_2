import { type Event, type Filter } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { cachePutMany } from './cache';
import { noteEventSource } from './event-sources';
import { normalizeRelayFilters, webSocketRelays, writeWebSocketRelays } from './relay-filters';
import { ingestEvent } from './verify';

type SubCallback = {
  onEvent: (event: Event, relay: string) => void;
  onEose?: (relay: string) => void;
};

class RelayPool {
  private pool = new SimplePool();
  private signedIn = false;
  /** Cap parallel query() calls — landing used to fire many stack scans at once. */
  private activeQueries = 0;
  private queryWaiters: Array<() => void> = [];
  private static readonly MAX_PARALLEL_QUERIES = 2;
  private static readonly MAX_RELAYS_PER_QUERY = 5;

  setSignedIn(signedIn: boolean): void {
    this.signedIn = signedIn;
  }

  private async withQuerySlot<T>(fn: () => Promise<T>): Promise<T> {
    while (this.activeQueries >= RelayPool.MAX_PARALLEL_QUERIES) {
      await new Promise<void>((resolve) => this.queryWaiters.push(resolve));
    }
    this.activeQueries++;
    try {
      return await fn();
    } finally {
      this.activeQueries--;
      this.queryWaiters.shift()?.();
    }
  }

  async query(relays: string[], filters: Filter[], timeoutMs = 8000): Promise<Event[]> {
    // Tor/I2P already dropped in webSocketRelays(); still cap fan-out.
    const wssRelays = webSocketRelays(relays).slice(0, RelayPool.MAX_RELAYS_PER_QUERY);
    const cleanFilters = normalizeRelayFilters(filters);
    if (!wssRelays.length || !cleanFilters.length) return [];

    return this.withQuerySlot(async () => {
      const byId = new Map<string, Event>();
      // Cap concurrent REQs — relays (e.g. sovbit) reject "too many concurrent REQs".
      const concurrency = 1;
      const pool = this.pool;
      let next = 0;
      async function worker(): Promise<void> {
        while (next < wssRelays.length) {
          const i = next++;
          const url = wssRelays[i]!;
          for (const filter of cleanFilters) {
            try {
              const batch = await pool.querySync([url], filter, { maxWait: timeoutMs });
              for (const event of batch) {
                const v = ingestEvent(event);
                if (!v) continue;
                noteEventSource(v.id, url);
                if (!byId.has(v.id)) byId.set(v.id, v);
              }
            } catch {
              /* relay timeout / NOTICE — keep other relays */
            }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, wssRelays.length) }, () => worker()));
      const events = [...byId.values()];
      await cachePutMany(events);
      return events;
    });
  }

  subscribe(relays: string[], filters: Filter[], cb: SubCallback): () => void {
    const wssRelays = webSocketRelays(relays).slice(0, RelayPool.MAX_RELAYS_PER_QUERY);
    const cleanFilters = normalizeRelayFilters(filters);
    if (!wssRelays.length || !cleanFilters.length) return () => {};

    const closers = wssRelays.flatMap((url) =>
      cleanFilters.map((filter) =>
        this.pool.subscribe([url], filter, {
          onevent: (event) => {
            const v = ingestEvent(event);
            if (v) {
              noteEventSource(v.id, url);
              void import('./cache').then(({ cachePutEvent }) => cachePutEvent(v));
              cb.onEvent(v, url);
            }
          },
          oneose: () => cb.onEose?.(url)
        })
      )
    );
    return () => {
      for (const c of closers) c.close();
    };
  }

  async publish(relays: string[], event: Event): Promise<void> {
    if (!this.signedIn) return;
    const wssRelays = writeWebSocketRelays(relays);
    if (!wssRelays.length) return;
    await Promise.allSettled(wssRelays.map((r) => this.pool.publish([r], event)));
  }

  close(): void {
    this.pool.close([]);
  }
}

export const relayPool = new RelayPool();
