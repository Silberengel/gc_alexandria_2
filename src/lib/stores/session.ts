import { writable, derived, get } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { KIND, LOGIN_METADATA_KINDS } from '../constants';
import { applyMuteList, clearMute, decryptPrivateMuteTags, newestMuteList, parseMuteList } from '../mute';
import { cachePutMany } from '../nostr/cache';
import { relayPool } from '../nostr/pool';
import { webSocketRelays } from '../nostr/relay-filters';
import { documentStack, profileStack, setSelectorContext, socialStack, writeStack } from '../nostr/selector';
import { mercuryFilter } from '../nostr/mercury';
import { mergeRememberedMetadata } from '../session-metadata';

/** Kinds that live on social/interaction relays (not Mercury's document index). */
const SOCIAL_LOGIN_KINDS = [
  KIND.CONTACT_LIST,
  KIND.MUTE,
  KIND.BOOKMARK,
  KIND.BLOCKED,
  KIND.FAVORITE,
  KIND.LABEL,
  KIND.FOLLOW_SET,
  KIND.STATUS,
  KIND.PAYMENT
] as const;

const SESSION_STORAGE_KEY = 'alexandria-session';

type PersistedSession = { pubkey: string; npub: string };

function readPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PersistedSession>;
    const pubkey = typeof data.pubkey === 'string' ? data.pubkey.toLowerCase() : '';
    const npub = typeof data.npub === 'string' ? data.npub : '';
    if (!/^[0-9a-f]{64}$/.test(pubkey) || !npub.startsWith('npub1')) return null;
    return { pubkey, npub };
  } catch {
    return null;
  }
}

function writePersistedSession(pubkey: string, npub: string): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ pubkey, npub }));
  } catch {
    /* private mode / quota */
  }
}

function clearPersistedSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Extensions inject window.nostr after DOMContentLoaded — poll briefly. */
async function waitForNostr(timeoutMs = 4000): Promise<NonNullable<Window['nostr']> | null> {
  const existing = window.nostr;
  if (existing?.getPublicKey) return existing;
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const ext = window.nostr;
      if (ext?.getPublicKey) {
        resolve(ext);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(tick, 50);
    };
    setTimeout(tick, 0);
  });
}

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
    // 1985/10003 live on the social stack — document-only REQs miss most bookmarks/labels.
    const listKinds = LOGIN_METADATA_KINDS.filter((k) => k !== KIND.METADATA);
    const listFilter = { authors: [pubkey], kinds: listKinds, limit: 100 };
    const socialFilter = {
      authors: [pubkey],
      kinds: [...SOCIAL_LOGIN_KINDS],
      limit: 100
    };
    const profileFilter = { authors: [pubkey], kinds: [KIND.METADATA], limit: 1 };
    try {
      const [mercuryResult, docResult, socialResult, profileResult] = await Promise.allSettled([
        mercuryFilter(listFilter),
        relayPool.query(documentStack(), [listFilter], 4000),
        relayPool.query(socialStack(), [socialFilter], 4000),
        relayPool.query(profileStack(), [profileFilter], 4000)
      ]);
      const mercury = mercuryResult.status === 'fulfilled' ? mercuryResult.value : [];
      const doc = docResult.status === 'fulfilled' ? docResult.value : [];
      const social = socialResult.status === 'fulfilled' ? socialResult.value : [];
      const profiles = profileResult.status === 'fulfilled' ? profileResult.value : [];
      const byId = new Map<string, Event>();
      for (const e of [...mercury, ...doc, ...social, ...profiles]) byId.set(e.id, e);
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

  async function applyPubkey(pubkey: string, waitMetadata = true): Promise<void> {
    const { nip19 } = await import('nostr-tools');
    const npub = nip19.npubEncode(pubkey);
    // Drop prior identity's lists before the new pubkey is visible to the UI.
    // Keep loading=true until metadata finishes so Home does not refresh twice.
    metadataEvents = [];
    metadata.set([]);
    set({ pubkey, npub, loading: true });
    writePersistedSession(pubkey, npub);
    relayPool.setSignedIn(true);
    const meta = loadMetadata(pubkey).finally(() => update((s) => ({ ...s, loading: false })));
    if (waitMetadata) await meta;
  }

  async function signIn(): Promise<boolean> {
    update((s) => ({ ...s, loading: true }));
    try {
      const ext = (await waitForNostr(1500)) ?? window.nostr;
      if (!ext?.getPublicKey) {
        update((s) => ({ ...s, loading: false }));
        return false;
      }
      const pubkey = (await ext.getPublicKey()).toLowerCase();
      await applyPubkey(pubkey, true);
      return true;
    } catch {
      update((s) => ({ ...s, loading: false }));
      return false;
    }
  }

  /**
   * Re-attach identity after reload.
   * Paint immediately from localStorage — window.nostr is often injected late.
   * Confirm against NIP-07 in the background when the extension appears.
   */
  async function restore(): Promise<boolean> {
    if (get({ subscribe }).pubkey) return true;

    const persisted = readPersistedSession();
    if (persisted) {
      metadataEvents = [];
      metadata.set([]);
      set({ pubkey: persisted.pubkey, npub: persisted.npub, loading: true });
      relayPool.setSignedIn(true);
      void confirmRestoredSession(persisted);
      return true;
    }

    // No local session — briefly wait for an already-authorized extension.
    const ext = await waitForNostr(1500);
    if (!ext?.getPublicKey) {
      update((s) => ({ ...s, loading: false }));
      return false;
    }
    try {
      const pubkey = (await ext.getPublicKey()).toLowerCase();
      await applyPubkey(pubkey, false);
      return true;
    } catch {
      update((s) => ({ ...s, loading: false }));
      return false;
    }
  }

  async function confirmRestoredSession(persisted: PersistedSession): Promise<void> {
    const ext = await waitForNostr(4000);
    if (!ext?.getPublicKey) {
      void loadMetadata(persisted.pubkey).finally(() => update((s) => ({ ...s, loading: false })));
      return;
    }
    try {
      const pubkey = (await ext.getPublicKey()).toLowerCase();
      if (pubkey !== persisted.pubkey) {
        await applyPubkey(pubkey, false);
        return;
      }
      void loadMetadata(pubkey).finally(() => update((s) => ({ ...s, loading: false })));
    } catch {
      // Some extensions need a user gesture for getPublicKey — keep persisted identity.
      void loadMetadata(persisted.pubkey).finally(() => update((s) => ({ ...s, loading: false })));
    }
  }

  function signOut(): void {
    clearPersistedSession();
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
    restore,
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
