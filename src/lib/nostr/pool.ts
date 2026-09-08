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

  setSignedIn(signedIn: boolean): void {
    this.signedIn = signedIn;
  }

  async query(relays: string[], filters: Filter[], timeoutMs = 8000): Promise<Event[]> {
    const wssRelays = webSocketRelays(relays);
    const cleanFilters = normalizeRelayFilters(filters);
    if (!wssRelays.length || !cleanFilters.length) return [];

    const byId = new Map<string, Event>();
    // Cap concurrent REQs — relays (e.g. sovbit) reject "too many concurrent REQs".
    const concurrency = 2;
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
  }

  subscribe(relays: string[], filters: Filter[], cb: SubCallback): () => void {
    const wssRelays = webSocketRelays(relays);
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
