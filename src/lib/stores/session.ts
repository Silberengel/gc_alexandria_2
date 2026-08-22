import { writable, derived, get } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { LOGIN_METADATA_KINDS } from '../constants';
import { cachePutMany } from '../nostr/cache';
import { relayPool } from '../nostr/pool';
import { documentStack, setSelectorContext, writeStack } from '../nostr/selector';
import { mercuryFilter } from '../nostr/mercury';

export type SessionState = {
  pubkey: string | null;
  npub: string | null;
  loading: boolean;
};

function createSessionStore() {
  const { subscribe, set, update } = writable<SessionState>({
    pubkey: null,
    npub: null,
    loading: false
  });

  let metadataEvents: Event[] = [];

  async function loadMetadata(pubkey: string): Promise<void> {
    const filter = { authors: [pubkey], kinds: LOGIN_METADATA_KINDS, limit: 100 };
    const [mercury, ws] = await Promise.all([
      mercuryFilter(filter),
      relayPool.query(documentStack(), [filter])
    ]);
    const byId = new Map<string, Event>();
    for (const e of [...mercury, ...ws]) byId.set(e.id, e);
    metadataEvents = [...byId.values()];
    await cachePutMany(metadataEvents);

    const relays = metadataEvents.filter((e) => e.kind === 10002);
    const favorites = metadataEvents.filter((e) => e.kind === 10012);
    const blocked = metadataEvents.filter((e) => e.kind === 10006);
    const local = metadataEvents.filter((e) => e.kind === 10432);

    const readList = (ev: Event | undefined, tag: string) =>
      ev?.tags.filter((t) => t[0] === tag && t[1]).map((t) => t[1]!) ?? [];

    setSelectorContext({
      signedIn: true,
      inbox: readList(relays[0], 'r'),
      outbox: readList(relays[0], 'w'),
      favorites: favorites.flatMap((e) => readList(e, 'relay')),
      local: local.flatMap((e) => readList(e, 'relay')),
      blocked: blocked.flatMap((e) => readList(e, 'relay'))
    });
  }

  async function signIn(): Promise<boolean> {
    update((s) => ({ ...s, loading: true }));
    try {
      const ext = window.nostr;
      if (!ext?.getPublicKey) return false;
      const pubkey = (await ext.getPublicKey()).toLowerCase();
      const { nip19 } = await import('nostr-tools');
      const npub = nip19.npubEncode(pubkey);
      set({ pubkey, npub, loading: false });
      relayPool.setSignedIn(true);
      await loadMetadata(pubkey);
      return true;
    } catch {
      update((s) => ({ ...s, loading: false }));
      return false;
    }
  }

  function signOut(): void {
    set({ pubkey: null, npub: null, loading: false });
    metadataEvents = [];
    setSelectorContext({ signedIn: false, inbox: [], outbox: [], favorites: [], local: [], blocked: [] });
    relayPool.setSignedIn(false);
  }

  async function publish(event: Event): Promise<void> {
    const relays = writeStack();
    await relayPool.publish(relays, event);
    await cachePutMany([event]);
  }

  return { subscribe, signIn, signOut, publish, getPubkey: () => get({ subscribe }).pubkey };
}

export const session = createSessionStore();

export const isSignedIn = derived(session, ($s) => !!$s.pubkey);

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent?(event: unknown): Promise<unknown>;
    };
  }
}
