import { type Event, type Filter } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { MERCURY_WSS } from '../constants';
import { cachePutMany } from './cache';
import { noteEventSource } from './event-sources';
import { isMercuryUnavailable } from './mercury';
import { normalizeRelayFilters, webSocketRelays, writeWebSocketRelays } from './relay-filters';
import { ingestEvent } from './verify';

type SubCallback = {
  onEvent: (event: Event, relay: string) => void;
  onEose?: (relay: string) => void;
};

function usableRelays(urls: string[], max: number): string[] {
  const mercury = MERCURY_WSS.replace(/\/+$/, '').toLowerCase();
  return webSocketRelays(urls)
    .filter((url) => {
      // Mercury HTTP outage usually means its WSS is unreachable too — skip instead of hanging DNS.
      if (isMercuryUnavailable() && url.replace(/\/+$/, '').toLowerCase() === mercury) return false;
      return true;
    })
    .slice(0, max);
}

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

  /** Never throws — dead relays return []. */
  async query(relays: string[], filters: Filter[], timeoutMs = 8000): Promise<Event[]> {
    try {
      const wssRelays = usableRelays(relays, RelayPool.MAX_RELAYS_PER_QUERY);
      const cleanFilters = normalizeRelayFilters(filters);
      if (!wssRelays.length || !cleanFilters.length) return [];

      return await this.withQuerySlot(async () => {
        const byId = new Map<string, Event>();
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
                /* one relay failed — continue */
              }
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, wssRelays.length) }, () => worker()));
        const events = [...byId.values()];
        try {
          await cachePutMany(events);
        } catch {
          /* cache write must not fail the read path */
        }
        return events;
      });
    } catch {
      return [];
    }
  }

  /** Never throws — returns a no-op closer if subscribe cannot start. */
  subscribe(relays: string[], filters: Filter[], cb: SubCallback): () => void {
    try {
      const wssRelays = usableRelays(relays, RelayPool.MAX_RELAYS_PER_QUERY);
      const cleanFilters = normalizeRelayFilters(filters);
      if (!wssRelays.length || !cleanFilters.length) return () => {};

      const closers = wssRelays.flatMap((url) =>
        cleanFilters.map((filter) => {
          try {
            return this.pool.subscribe([url], filter, {
              onevent: (event) => {
                try {
                  const v = ingestEvent(event);
                  if (v) {
                    noteEventSource(v.id, url);
                    void import('./cache').then(({ cachePutEvent }) => cachePutEvent(v)).catch(() => {});
                    cb.onEvent(v, url);
                  }
                } catch {
                  /* bad event — ignore */
                }
              },
              oneose: () => {
                try {
                  cb.onEose?.(url);
                } catch {
                  /* ignore */
                }
              }
            });
          } catch {
            return { close: () => {} };
          }
        })
      );
      return () => {
        for (const c of closers) {
          try {
            c.close();
          } catch {
            /* ignore */
          }
        }
      };
    } catch {
      return () => {};
    }
  }

  /** Never throws — failed publishes are ignored. */
  async publish(relays: string[], event: Event): Promise<void> {
    if (!this.signedIn) return;
    try {
      const wssRelays = writeWebSocketRelays(relays);
      if (!wssRelays.length) return;
      await Promise.allSettled(wssRelays.map((r) => this.pool.publish([r], event)));
    } catch {
      /* ignore */
    }
  }

  close(): void {
    try {
      this.pool.close([]);
    } catch {
      /* ignore */
    }
  }
}

export const relayPool = new RelayPool();
