import { type Event, type Filter } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { MERCURY_WSS } from '../constants';
import { cachePutMany } from './cache';
import { noteEventSource } from './event-sources';
import { isMercuryUnavailable, isMercuryDocumentFilter } from './mercury';
import { normalizeRelayFilters, webSocketRelays, writeWebSocketRelays } from './relay-filters';
import { ingestEvent } from './verify';

function waitForWindowLoad(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  if (document.readyState === 'complete') return waitForIdle();
  return new Promise((resolve) => {
    window.addEventListener('load', () => waitForIdle().then(resolve), { once: true });
  });
}

function waitForIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') ric(() => resolve(), { timeout: 1500 });
    else setTimeout(resolve, 200);
  });
}

type SubCallback = {
  onEvent: (event: Event, relay: string) => void;
  onEose?: (relay: string) => void;
};

function usableRelays(
  urls: string[],
  max: number,
  skipKeys: ReadonlySet<string>,
  allowMercuryWss: boolean
): string[] {
  const mercury = MERCURY_WSS.replace(/\/+$/, '').toLowerCase();
  const out: string[] = [];
  for (const url of webSocketRelays(urls)) {
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (key === mercury && (!allowMercuryWss || isMercuryUnavailable())) continue;
    if (skipKeys.has(key)) continue;
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
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
  private pool = new (SimplePool as new (opts?: object) => SimplePool)({
    maxWaitForConnection: 2500,
    enableReconnect: false,
    allowConnectingToRelay: (url: string) => !this.relayCoolingDown(url),
    onRelayConnectionFailure: (url: string) => this.markRelayFailed(url)
  });
  private signedIn = false;
  /**
   * Cap parallel query() calls (each may fan out to many relays).
   * Keep this high enough that wiki/profile loads are not queued behind landing feeds.
   */
  private activeQueries = 0;
  private queryWaiters: Array<() => void> = [];
  /** Identical in-flight REQs share one Promise (social + comments often overlap). */
  private inflight = new Map<string, Promise<Event[]>>();
  private relayFailedUntil = new Map<string, number>();
  /** At most one REQ in flight per host (outboxes like pipe.imwald.eu are 12 msg/min). */
  private relayTurn = new Map<string, Promise<void>>();
  private static readonly MAX_PARALLEL_QUERIES = 3;
  /**
   * Default fan-out per REQ. Parallel across these hosts, but keep the count modest —
   * publication social loads fire several filters at once and large fan-outs trip rate limits.
   */
  private static readonly MAX_RELAYS_PER_QUERY = 4;
  /** Hung WebSockets often ignore SimplePool maxWait until TCP dies — bound the attempt. */
  private static readonly RELAY_ATTEMPT_MS = 4_000;
  private static readonly RELAY_FAIL_COOLDOWN_MS = 120_000;

  private relayKey(url: string): string {
    return url.replace(/\/+$/, '').toLowerCase();
  }

  private relayCoolingDown(url: string): boolean {
    const until = this.relayFailedUntil.get(this.relayKey(url)) ?? 0;
    return until > Date.now();
  }

  private skippedRelayKeys(): Set<string> {
    const now = Date.now();
    const skip = new Set<string>();
    for (const [key, until] of this.relayFailedUntil) {
      if (until > now) skip.add(key);
      else this.relayFailedUntil.delete(key);
    }
    return skip;
  }

  private markRelayFailed(url: string): void {
    this.relayFailedUntil.set(this.relayKey(url), Date.now() + RelayPool.RELAY_FAIL_COOLDOWN_MS);
  }

  private async withRelayTurn<T>(url: string, fn: () => Promise<T>): Promise<T> {
    const key = this.relayKey(url);
    const prev = this.relayTurn.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.relayTurn.set(
      key,
      prev.then(() => next).catch(() => next)
    );
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * One WebSocket REQ (all filters) per relay. CLOSE the sub when done so the
   * next query cannot stack REQ ids (sovbit/wine "too many concurrent REQs").
   * Do not close the WebSocket itself — that is what Firefox logs as interrupted.
   */
  private queryRelay(url: string, filters: Filter[], maxWait: number): Promise<Event[]> {
    return this.withRelayTurn(url, () => {
      if (this.relayCoolingDown(url)) return Promise.resolve([] as Event[]);
      return new Promise((resolve) => {
        const events: Event[] = [];
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          try {
            void closer.close('done');
          } catch {
            /* ignore */
          }
          resolve(events);
        };
        const closer = this.pool.subscribeMap(
          filters.map((filter) => ({ url, filter })),
          {
            maxWait,
            onevent: (event: Event) => {
              events.push(event);
            },
            oneose: finish,
            onclose: finish
          }
        );
        setTimeout(finish, maxWait);
      });
    });
  }

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
      await waitForWindowLoad();
      const cleanFilters = normalizeRelayFilters(filters);
      const wssRelays = usableRelays(
        relays,
        maxRelays,
        this.skippedRelayKeys(),
        cleanFilters.every(isMercuryDocumentFilter)
      );
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
        const attemptMs = Math.min(timeoutMs, RelayPool.RELAY_ATTEMPT_MS);
        await Promise.all(
          wssRelays.map(async (url) => {
            try {
              const batch = await this.queryRelay(url, cleanFilters, attemptMs);
              for (const event of batch) {
                const v = ingestEvent(event);
                if (!v) continue;
                noteEventSource(v.id, url);
                if (!byId.has(v.id)) {
                  byId.set(v.id, v);
                  if (onBatch) {
                    try {
                      onBatch([...byId.values()]);
                    } catch {
                      /* caller paint must not break the query */
                    }
                  }
                }
              }
            } catch {
              this.markRelayFailed(url);
            }
          })
        );
        const events = [...byId.values()];
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
    let closed = false;
    const closers: Array<{ close: (reason?: string) => void }> = [];
    void waitForWindowLoad().then(() => {
      if (closed) return;
      try {
        const cleanFilters = normalizeRelayFilters(filters);
        const wssRelays = usableRelays(
          relays,
          RelayPool.MAX_RELAYS_PER_QUERY,
          this.skippedRelayKeys(),
          cleanFilters.every(isMercuryDocumentFilter)
        );
        if (!wssRelays.length || !cleanFilters.length) return;
        for (const url of wssRelays) {
          closers.push(
            this.pool.subscribeMap(
              cleanFilters.map((filter) => ({ url, filter })),
              {
                onevent: (event: Event) => {
                  if (closed) return;
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
              }
            )
          );
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      closed = true;
      for (const closer of closers) {
        try {
          closer.close();
        } catch {
          /* ignore */
        }
      }
    };
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
