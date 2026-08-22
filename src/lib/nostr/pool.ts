import { type Event, type Filter } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { cachePutMany } from './cache';
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

    return new Promise((resolve) => {
      const byId = new Map<string, Event>();
      let closed = false;
      let eoseCount = 0;

      const finish = async () => {
        if (closed) return;
        closed = true;
        sub.close();
        clearTimeout(timer);
        const events = [...byId.values()];
        await cachePutMany(events);
        resolve(events);
      };

      const onEose = () => {
        eoseCount += 1;
        if (eoseCount >= wssRelays.length) finish();
      };

      const sub = this.pool.subscribeMany(wssRelays, cleanFilters, {
        onevent: (event) => {
          const v = ingestEvent(event);
          if (v && !byId.has(v.id)) byId.set(v.id, v);
        },
        oneose: onEose,
        onclose: onEose
      });

      const timer = setTimeout(finish, timeoutMs);
    });
  }

  subscribe(relays: string[], filters: Filter[], cb: SubCallback): () => void {
    const wssRelays = webSocketRelays(relays);
    const cleanFilters = normalizeRelayFilters(filters);
    if (!wssRelays.length || !cleanFilters.length) return () => {};

    const sub = this.pool.subscribeMany(wssRelays, cleanFilters, {
      onevent: (event) => {
        const v = ingestEvent(event);
        if (v) {
          void import('./cache').then(({ cachePutEvent }) => cachePutEvent(v));
          cb.onEvent(v, '');
        }
      },
      oneose: () => cb.onEose?.('')
    });
    return () => sub.close();
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
