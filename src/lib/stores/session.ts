import { writable, derived, get } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { KIND, LOGIN_METADATA_KINDS } from '../constants';
import { applyMuteList, clearMute, decryptPrivateMuteTags, newestMuteList, parseMuteList } from '../mute';
import { cachePutMany } from '../nostr/cache';
import { relayPool } from '../nostr/pool';
import { webSocketRelays } from '../nostr/relay-filters';
import { documentStack, profileStack, setSelectorContext, writeStack } from '../nostr/selector';
import { mercuryFilter } from '../nostr/mercury';
import { mergeRememberedMetadata } from '../session-metadata';

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
  const metadata = writable<Event[]>([]);

  async function applyMuteFromMetadata(events: Event[]): Promise<void> {
    const muteEvent = newestMuteList(events);
    const extra = muteEvent ? await decryptPrivateMuteTags(muteEvent) : [];
    applyMuteList(parseMuteList(muteEvent, extra));
  }

  async function loadMetadata(pubkey: string): Promise<void> {
    // Kind 0 is not on Mercury (document index). Fetch it from profile mirrors.
    const listKinds = LOGIN_METADATA_KINDS.filter((k) => k !== KIND.METADATA);
    const listFilter = { authors: [pubkey], kinds: listKinds, limit: 100 };
    const profileFilter = { authors: [pubkey], kinds: [KIND.METADATA], limit: 1 };
    try {
      const [mercuryResult, wsResult, profileResult] = await Promise.allSettled([
        mercuryFilter(listFilter),
        relayPool.query(documentStack(), [listFilter]),
        relayPool.query(profileStack(), [profileFilter])
      ]);
      const mercury = mercuryResult.status === 'fulfilled' ? mercuryResult.value : [];
      const ws = wsResult.status === 'fulfilled' ? wsResult.value : [];
      const profiles = profileResult.status === 'fulfilled' ? profileResult.value : [];
      const byId = new Map<string, Event>();
      for (const e of [...mercury, ...ws, ...profiles]) byId.set(e.id, e);
      metadataEvents = [...byId.values()];
      metadata.set(metadataEvents);
      try {
        await cachePutMany(metadataEvents);
      } catch {
        /* ignore */
      }
      void applyMuteFromMetadata(metadataEvents).catch(() => {});

      const relays = metadataEvents.filter((e) => e.kind === 10002);
      const favorites = metadataEvents.filter((e) => e.kind === 10012);
      const blocked = metadataEvents.filter((e) => e.kind === 10006);
      const local = metadataEvents.filter((e) => e.kind === 10432);

      const readList = (ev: Event | undefined, tag: string) =>
        webSocketRelays(ev?.tags.filter((t) => t[0] === tag && t[1]).map((t) => t[1]!) ?? []);

      setSelectorContext({
        signedIn: true,
        inbox: readList(relays[0], 'r'),
        outbox: readList(relays[0], 'w'),
        favorites: webSocketRelays(favorites.flatMap((e) => readList(e, 'relay'))),
        local: webSocketRelays(local.flatMap((e) => readList(e, 'relay'))),
        blocked: webSocketRelays(blocked.flatMap((e) => readList(e, 'relay')))
      });
    } catch {
      // Signed-in UI must still work offline / when every relay is down.
      metadataEvents = [];
      metadata.set([]);
      setSelectorContext({
        signedIn: true,
        inbox: [],
        outbox: [],
        favorites: [],
        local: [],
        blocked: []
      });
    }
  }

  async function signIn(): Promise<boolean> {
    update((s) => ({ ...s, loading: true }));
    try {
      const ext = window.nostr;
      if (!ext?.getPublicKey) return false;
      const pubkey = (await ext.getPublicKey()).toLowerCase();
      const { nip19 } = await import('nostr-tools');
      const npub = nip19.npubEncode(pubkey);
      // Drop prior identity's lists before the new pubkey is visible to the UI.
      metadataEvents = [];
      metadata.set([]);
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
    metadata.set([]);
    clearMute();
    setSelectorContext({ signedIn: false, inbox: [], outbox: [], favorites: [], local: [], blocked: [] });
    relayPool.setSignedIn(false);
  }

  async function publish(event: Event): Promise<void> {
    const relays = writeStack();
    await relayPool.publish(relays, event);
    await cachePutMany([event]);
    rememberEvent(event);
  }

  function rememberEvent(event: Event): void {
    const pk = get({ subscribe }).pubkey;
    if (!pk || event.pubkey.toLowerCase() !== pk) return;
    metadataEvents = mergeRememberedMetadata(metadataEvents, event);
    metadata.set(metadataEvents);
  }

  return {
    subscribe,
    signIn,
    signOut,
    publish,
    rememberEvent,
    metadata,
    getPubkey: () => get({ subscribe }).pubkey,
    getMetadata: () => metadataEvents
  };
}

export const session = createSessionStore();

export const isSignedIn = derived(session, ($s) => !!$s.pubkey);

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent?(event: unknown): Promise<unknown>;
      nip04?: {
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
      nip44?: {
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
    };
  }
}
