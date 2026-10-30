import { type Event, type EventTemplate, type Filter, type VerifiedEvent } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { MERCURY_WSS } from '../constants';
import { cachePutMany } from './cache';
import { noteEventSource } from './event-sources';
import { isMercuryUnavailable, isMercuryDocumentFilter } from './mercury';
import { normalizeRelayFilters, webSocketRelays, writeWebSocketRelays } from './relay-filters';
import { constrainRelays } from './selector';
import { ingestEvent } from './verify';

/** NIP-42 AUTH signer (kind 22242). Set from the session when signed in. */
export type RelayAuthHandler = (evt: EventTemplate) => Promise<VerifiedEvent>;

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
  allowMercuryWss: boolean,
  opts?: { bypassConstrain?: boolean }
): string[] {
  const mercury = MERCURY_WSS.replace(/\/+$/, '').toLowerCase();
  const out: string[] = [];
  const source = opts?.bypassConstrain ? webSocketRelays(urls) : webSocketRelays(constrainRelays(urls));
  // Allowlist before the cap, so a disallowed hint cannot crowd out a permitted relay.
  for (const url of source) {
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
  private authHandler: RelayAuthHandler | null = null;
  private pool = new (SimplePool as new (opts?: object) => SimplePool)({
    maxWaitForConnection: 2500,
    enableReconnect: false,
    allowConnectingToRelay: (url: string) => !this.relayCoolingDown(url),
    onRelayConnectionFailure: (url: string) => this.markRelayFailed(url)
    // Do not set automaticallyAuth: connect-time AUTH failures throw uncaught
    // ("invalid: relay URL does not match") inside nostr-tools. We only AUTH on
    // auth-required: close/publish via onauth in subscribeMap / publish.
  });
  private signedIn = false;
  private activeQueries = 0;
  private queryWaiters: Array<() => void> = [];
  /** Identical in-flight REQs share one Promise (social + comments often overlap). */
  private inflight = new Map<string, Promise<Event[]>>();
  private relayFailedUntil = new Map<string, number>();
  /** At most one REQ in flight per host (outboxes like pipe.imwald.eu are 12 msg/min). */
  private relayTurn = new Map<string, Promise<void>>();
  /** Queued + in-flight REQs per host (see MAX_RELAY_QUEUE_DEPTH). */
  private relayQueueDepth = new Map<string, number>();
  /**
   * Cap concurrent live REQs (slot held only while the WebSocket REQ runs —
   * not while queued for a per-host turn).
   */
  private static readonly MAX_PARALLEL_QUERIES = 4;
  /** Queued+active REQs per host before later queries skip that host. */
  private static readonly MAX_RELAY_QUEUE_DEPTH = 2;
  /** Background work gives up the slot wait; priority keeps waiting. */
  private static readonly SLOT_WAIT_MS = 15_000;
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

  private async withRelayTurn(url: string, fn: () => Promise<Event[]>): Promise<Event[]> {
    const key = this.relayKey(url);
    const depth = this.relayQueueDepth.get(key) ?? 0;
    // Don't chain onto a backed-up host — trips 12 msg/min rate limits (pipe.imwald.eu).
    // Slot is acquired inside `fn` (see queryRelay), so waiting on `prev` is cheap.
    if (depth >= RelayPool.MAX_RELAY_QUEUE_DEPTH) return [];
    this.relayQueueDepth.set(key, depth + 1);
    const prev = this.relayTurn.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.relayTurn.set(
      key,
      prev.then(() => next).catch(() => next)
    );
    try {
      await prev.catch(() => {});
      return await fn();
    } finally {
      release();
      this.relayQueueDepth.set(key, Math.max(0, (this.relayQueueDepth.get(key) ?? 1) - 1));
    }
  }

  /**
   * One WebSocket REQ (all filters) per relay. CLOSE the sub when done so the
   * next query cannot stack REQ ids (sovbit/wine "too many concurrent REQs").
   * Do not close the WebSocket itself — that is what Firefox logs as interrupted.
   *
   * Per-host turn wait happens *before* the global query slot, so a backed-up
   * outbox no longer parks a slot for the full attempt timeout.
   *
   * @param ignoreCooling Retry even when the host is in a soft-fail cooldown
   *   (advanced search / feed paths that already opted into includeCooling).
   */
  private runRelayReq(url: string, filters: Filter[], maxWait: number): Promise<Event[]> {
    return new Promise((resolve) => {
      const collected: Event[] = [];
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try {
          void closer.close('done');
        } catch {
          /* ignore */
        }
        resolve(collected);
      };
      const closer = this.pool.subscribeMap(
        filters.map((filter) => ({ url, filter })),
        {
          maxWait,
          onevent: (event: Event) => {
            collected.push(event);
          },
          oneose: finish,
          onclose: finish,
          ...(this.authHandler ? { onauth: this.authHandler } : {})
        }
      );
      setTimeout(finish, maxWait);
    });
  }

  private queryRelay(
    url: string,
    filters: Filter[],
    maxWait: number,
    ignoreCooling = false,
    priority = false
  ): Promise<Event[]> {
    return this.withRelayTurn(url, async () => {
      if (!ignoreCooling && this.relayCoolingDown(url)) return [] as Event[];
      if (ignoreCooling) this.relayFailedUntil.delete(this.relayKey(url));

      // Host turn is already held. Never wait long for a global slot here —
      // that used to park the outbox and cascade into 15s background sheds.
      if (priority) {
        const events = await this.withQuerySlot(
          () => this.runRelayReq(url, filters, maxWait),
          true,
          5_000
        );
        return events ?? [];
      }
      if (!this.tryAcquireQuerySlot(false)) return [];
      try {
        return await this.runRelayReq(url, filters, maxWait);
      } finally {
        this.releaseQuerySlot();
      }
    });
  }

  setSignedIn(signedIn: boolean): void {
    this.signedIn = signedIn;
  }

  /**
   * Wire NIP-42 AUTH for auth-required publish/REQ retries.
   * Intentionally not connected to automaticallyAuth (see constructor).
   */
  setAuthHandler(handler: RelayAuthHandler | null): void {
    this.authHandler = handler;
  }

  private querySlotLimit(priority: boolean): number {
    return priority
      ? RelayPool.MAX_PARALLEL_QUERIES + 2
      : RelayPool.MAX_PARALLEL_QUERIES;
  }

  private releaseQuerySlot(): void {
    this.activeQueries = Math.max(0, this.activeQueries - 1);
    const free = Math.max(0, RelayPool.MAX_PARALLEL_QUERIES + 2 - this.activeQueries);
    for (let n = 0; n < free && this.queryWaiters.length; n += 1) {
      this.queryWaiters.shift()?.();
    }
  }

  /** Non-blocking: take a slot if one is free. Used for background REQs that already hold a host turn. */
  private tryAcquireQuerySlot(priority: boolean): boolean {
    if (this.activeQueries >= this.querySlotLimit(priority)) return false;
    this.activeQueries++;
    return true;
  }

  /**
   * Acquire a global query slot. Priority may use two extra slots.
   * When called while a per-host turn is held, pass a short `maxWaitMs` so a
   * saturated pool cannot park that outbox for {@link SLOT_WAIT_MS}.
   */
  private async withQuerySlot<T>(
    fn: () => Promise<T>,
    priority = false,
    maxWaitMs = RelayPool.SLOT_WAIT_MS
  ): Promise<T | null> {
    const limit = this.querySlotLimit(priority);
    const waitCap = priority ? Math.min(maxWaitMs, RelayPool.SLOT_WAIT_MS * 2) : maxWaitMs;
    const waitStarted = Date.now();
    let warned = false;
    while (this.activeQueries >= limit) {
      const waited = Date.now() - waitStarted;
      if (waited > waitCap) {
        if (priority) {
          console.warn('[alexandria:pool] shed priority query after slot wait');
        } else {
          console.warn('[alexandria:pool] shed background query after 15s slot wait');
        }
        return null;
      }
      if (priority && waited > Math.min(3_000, waitCap / 2) && !warned) {
        console.warn('[alexandria:pool] priority query still waiting for a slot');
        warned = true;
      }
      // Register one waiter per wait cycle and remove it on settle — the old
      // push-every-400ms path left dozens of stale wakeups per shed.
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const i = this.queryWaiters.indexOf(finish);
          if (i >= 0) this.queryWaiters.splice(i, 1);
          resolve();
        };
        const timer = setTimeout(finish, 400);
        this.queryWaiters.push(finish);
      });
    }
    this.activeQueries++;
    try {
      return await fn();
    } finally {
      this.releaseQuerySlot();
    }
  }

  /**
   * Never throws — dead relays return [].
   * Hits up to `maxRelays` in parallel and optionally streams merges via `onBatch`
   * as each relay answers (callers can paint before the slowest EOSE).
   * Pass `priority: true` for navigation (wiki/publication/feed) so background
   * extras yield slots; background REQs skip a busy host instead of waiting 15s.
   * Identical in-flight queries are coalesced (shared Promise); late `onBatch` after
   * the soft timeout is ignored.
   */
  async query(
    relays: string[],
    filters: Filter[],
    timeoutMs = 8000,
    maxRelays = RelayPool.MAX_RELAYS_PER_QUERY,
    onBatch?: (events: Event[]) => void,
    opts?: {
      priority?: boolean;
      includeCooling?: boolean;
      /** Skip NIP-65 allowlist — for NIP-37 private-storage URLs the author chose. */
      bypassConstrain?: boolean;
    }
  ): Promise<Event[]> {
    try {
      await waitForWindowLoad();
      const cleanFilters = normalizeRelayFilters(filters);
      const wssRelays = usableRelays(
        relays,
        maxRelays,
        opts?.includeCooling ? new Set() : this.skippedRelayKeys(),
        cleanFilters.every(isMercuryDocumentFilter),
        { bypassConstrain: opts?.bypassConstrain === true }
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

      const ignoreCooling = opts?.includeCooling === true;
      const priority = opts?.priority === true;
      // Slot is per live REQ inside queryRelay — not around this whole fan-out —
      // so waiting on a per-host turn cannot starve the pool for 15s+.
      const job = (async () => {
        const byId = new Map<string, Event>();
        const attemptMs = Math.min(timeoutMs, RelayPool.RELAY_ATTEMPT_MS);
        await Promise.all(
          wssRelays.map(async (url) => {
            try {
              const batch = await this.queryRelay(
                url,
                cleanFilters,
                attemptMs,
                ignoreCooling,
                priority
              );
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
      })();

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
    const closeAll = (): void => {
      for (const closer of closers) {
        try {
          closer.close();
        } catch {
          /* ignore */
        }
      }
    };
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
          if (closed) break;
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
      // Closer may have run after the first `closed` check but before subscribeMap finished.
      if (closed) closeAll();
    });
    return () => {
      closed = true;
      closeAll();
    };
  }

  /**
   * How many relays accepted the event.
   * Resolves on the first OK so the UI can paint immediately, or when every relay has rejected.
   * Never throws. Requires a signed-in session (new publishes).
   */
  async publish(
    relays: string[],
    event: Event,
    opts?: { bypassConstrain?: boolean }
  ): Promise<number> {
    if (!this.signedIn) return 0;
    return this.publishAlreadySigned(relays, event, {
      settle: 'first-ok',
      bypassConstrain: opts?.bypassConstrain === true
    });
  }

  /**
   * Re-send an already-signed event (no session required).
   * Waits for every relay so the caller can report how many accepted.
   */
  async broadcast(relays: string[], event: Event): Promise<number> {
    return this.publishAlreadySigned(relays, event, { settle: 'all' });
  }

  private async publishAlreadySigned(
    relays: string[],
    event: Event,
    opts: { settle: 'first-ok' | 'all'; bypassConstrain?: boolean }
  ): Promise<number> {
    try {
      const scoped = opts.bypassConstrain ? relays : constrainRelays(relays);
      const wssRelays = writeWebSocketRelays(scoped);
      if (!wssRelays.length) return 0;
      // SimplePool.publish returns Promise[] — one per relay, fulfilled on OK.
      const pubs = this.pool.publish(
        wssRelays,
        event,
        this.authHandler ? { onauth: this.authHandler } : undefined
      );
      if (!pubs.length) return 0;
      if (opts.settle === 'all') {
        const results = await Promise.allSettled(pubs.map((pub) => Promise.resolve(pub)));
        return results.filter((r) => r.status === 'fulfilled').length;
      }
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
