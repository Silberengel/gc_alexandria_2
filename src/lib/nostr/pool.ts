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

function queryIdentityKey(
  relays: string[],
  filters: Filter[],
  timeoutMs: number,
  maxRelays: number
): string {
  return JSON.stringify({
    relays: [...relays].map((r) => r.toLowerCase()).sort(),
    filters,
    timeoutMs,
    maxRelays
  });
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
  /** Identical in-flight REQs share one Promise (social + comments often overlap). */
  private inflight = new Map<string, Promise<Event[]>>();
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
   * Identical in-flight queries are coalesced (shared Promise); late `onBatch` after
   * the soft timeout is ignored.
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

      // Coalesce only when callers do not need their own progressive onBatch.
      const coalesceKey = onBatch
        ? null
        : queryIdentityKey(wssRelays, cleanFilters, timeoutMs, maxRelays);
      if (coalesceKey) {
        const pending = this.inflight.get(coalesceKey);
        if (pending) return pending.then((events) => [...events]);
      }

      const job = this.withQuerySlot(async () => {
        const byId = new Map<string, Event>();
        const pool = this.pool;
        const hardCapMs = Math.max(timeoutMs + 2000, 5000);
        let acceptBatches = true;

        const emit = (): void => {
          if (!acceptBatches || !onBatch || !byId.size) return;
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
                  if (!acceptBatches) continue;
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
                acceptBatches = false;
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
          acceptBatches = false;
        }
        try {
          await cachePutMany(events);
        } catch {
          /* cache write must not fail the read path */
        }
        return events;
      }, opts?.priority === true);

      if (coalesceKey) {
        this.inflight.set(coalesceKey, job);
        void job.finally(() => {
          if (this.inflight.get(coalesceKey) === job) this.inflight.delete(coalesceKey);
        });
      }

      return job;
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

  /**
   * How many relays accepted the event.
   * Resolves on the first OK so the UI can paint immediately, or when every relay has rejected.
   * Never throws.
   */
  async publish(relays: string[], event: Event): Promise<number> {
    if (!this.signedIn) return 0;
    try {
      const wssRelays = writeWebSocketRelays(relays);
      if (!wssRelays.length) return 0;
      // SimplePool.publish returns Promise[] — one per relay, fulfilled on OK.
      const pubs = this.pool.publish(wssRelays, event);
      if (!pubs.length) return 0;
      return await new Promise<number>((resolve) => {
        let accepted = 0;
        let pending = pubs.length;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve(accepted);
        };
        for (const pub of pubs) {
          void Promise.resolve(pub).then(
            () => {
              accepted += 1;
              pending -= 1;
              if (accepted > 0) finish();
              else if (pending <= 0) finish();
            },
            () => {
              pending -= 1;
              if (pending <= 0 && accepted === 0) finish();
            }
          );
        }
      });
    } catch {
      return 0;
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
