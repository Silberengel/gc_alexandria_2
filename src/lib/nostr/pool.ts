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
  /**
   * Cap parallel query() calls (each may fan out to many relays).
   * Keep this high enough that wiki/profile loads are not queued behind landing feeds.
   */
  private activeQueries = 0;
  private queryWaiters: Array<() => void> = [];
  private static readonly MAX_PARALLEL_QUERIES = 8;
  /**
   * Default fan-out per REQ. Parallel across these hosts, but keep the count modest —
   * publication social loads fire several filters at once and large fan-outs trip rate limits.
   */
  private static readonly MAX_RELAYS_PER_QUERY = 5;

  setSignedIn(signedIn: boolean): void {
    this.signedIn = signedIn;
  }

  private async withQuerySlot<T>(fn: () => Promise<T>, priority = false): Promise<T> {
    const limit = priority
      ? RelayPool.MAX_PARALLEL_QUERIES + 2
      : RelayPool.MAX_PARALLEL_QUERIES;
    const waitStarted = Date.now();
    while (this.activeQueries >= limit) {
      if (Date.now() - waitStarted > 15_000) {
        console.warn('[alexandria:pool] waited 15s for a query slot — continuing to avoid deadlock');
        break;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 400);
        this.queryWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.activeQueries++;
    try {
      return await fn();
    } finally {
      this.activeQueries--;
      this.queryWaiters.shift()?.();
    }
  }

  /**
   * Never throws — dead relays return [].
   * Hits up to `maxRelays` in parallel and optionally streams merges via `onBatch`
   * as each relay answers (callers can paint before the slowest EOSE).
   * Pass `priority: true` for navigation (wiki/publication) so Home background work
   * cannot hold the last slots for minutes.
   */
  async query(
    relays: string[],
    filters: Filter[],
    timeoutMs = 8000,
    maxRelays = RelayPool.MAX_RELAYS_PER_QUERY,
    onBatch?: (events: Event[]) => void,
    opts?: { priority?: boolean }
  ): Promise<Event[]> {
    try {
      const wssRelays = usableRelays(relays, maxRelays);
      const cleanFilters = normalizeRelayFilters(filters);
      if (!wssRelays.length || !cleanFilters.length) return [];

      return await this.withQuerySlot(async () => {
        const byId = new Map<string, Event>();
        const pool = this.pool;
        const hardCapMs = Math.max(timeoutMs + 2000, 5000);

        const emit = (): void => {
          if (!onBatch || !byId.size) return;
          try {
            onBatch([...byId.values()]);
          } catch {
            /* caller paint must not break the query */
          }
        };

        const run = async (): Promise<Event[]> => {
          // All selected relays in parallel — do not serialize behind a concurrency-2 worker pool.
          await Promise.all(
            wssRelays.map(async (url) => {
              for (const filter of cleanFilters) {
                try {
                  const batch = await pool.querySync([url], filter, { maxWait: timeoutMs });
                  let added = false;
                  for (const event of batch) {
                    const v = ingestEvent(event);
                    if (!v) continue;
                    noteEventSource(v.id, url);
                    if (!byId.has(v.id)) {
                      byId.set(v.id, v);
                      added = true;
                    }
                  }
                  if (added) emit();
                } catch {
                  /* one relay failed — continue */
                }
              }
            })
          );
          return [...byId.values()];
        };

        let events: Event[] = [];
        let raceDone = false;
        let hardCapTimer: ReturnType<typeof setTimeout> | 0 = 0;
        try {
          events = await Promise.race([
            run().then((value) => {
              raceDone = true;
              if (hardCapTimer) clearTimeout(hardCapTimer);
              return value;
            }),
            new Promise<Event[]>((resolve) => {
              hardCapTimer = setTimeout(() => {
                if (raceDone) return;
                raceDone = true;
                console.warn(
                  '[alexandria:pool] query hard-cap',
                  hardCapMs,
                  'ms',
                  cleanFilters[0]?.kinds
                );
                resolve([...byId.values()]);
              }, hardCapMs);
            })
          ]);
        } catch {
          events = [...byId.values()];
        } finally {
          if (hardCapTimer) clearTimeout(hardCapTimer);
        }
        try {
          await cachePutMany(events);
        } catch {
          /* cache write must not fail the read path */
        }
        return events;
      }, opts?.priority === true);
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
      // SimplePool.publish returns Promise[] — settle each so rejects stay quiet.
      const pubs = this.pool.publish(wssRelays, event);
      await Promise.allSettled(
        pubs.map((p) => Promise.resolve(p).then(() => undefined, () => undefined))
      );
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
