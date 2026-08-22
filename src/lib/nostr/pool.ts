import { type Event, type Filter } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { cachePutMany } from './cache';
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
    const wssRelays = relays.filter((r) => r.startsWith('wss://') || r.startsWith('ws://'));
    if (!wssRelays.length || !filters.length) return [];

    return new Promise((resolve) => {
      const byId = new Map<string, Event>();
      let closed = false;

      const finish = async () => {
        if (closed) return;
        closed = true;
        sub.close();
        clearTimeout(timer);
        const events = [...byId.values()];
        await cachePutMany(events);
        resolve(events);
      };

      const sub = this.pool.subscribeMany(wssRelays, filters, {
        onevent: (event) => {
          const v = ingestEvent(event);
          if (v && !byId.has(v.id)) byId.set(v.id, v);
        },
        oneose: finish
      });

      const timer = setTimeout(finish, timeoutMs);
    });
  }

  subscribe(relays: string[], filters: Filter[], cb: SubCallback): () => void {
    const wssRelays = relays.filter((r) => r.startsWith('wss://') || r.startsWith('ws://'));
    const sub = this.pool.subscribeMany(wssRelays, filters, {
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
    await Promise.allSettled(
      relays
        .filter((r) => r.startsWith('wss://') || r.startsWith('ws://'))
        .map((r) => this.pool.publish([r], event))
    );
  }

  close(): void {
    this.pool.close([]);
  }
}

export const relayPool = new RelayPool();
