import { writable, derived, get } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { KIND, LOGIN_METADATA_KINDS } from '../constants';
import { applyMuteList, clearMute, decryptPrivateMuteTags, newestMuteList, parseMuteList, latestReplaceable, followPubkeysFromMetadata } from '../mute';
import { cachePutMany } from '../nostr/cache';
import { relayPool } from '../nostr/pool';
import { documentStack, profileStack, setSelectorContext, socialStack, writeStack } from '../nostr/selector';
import { nip65InboxOutbox, relayTagUrls } from '../nostr/nip65';
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

/**
 * Clear page-level NIP-07 pubkey caches (notably nos2x-fox `window.nostr._pubkey`).
 * Without this, getPublicKey() keeps returning the first authorized key after sign-out.
 */
function clearNip07PagePubkeyCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const n = window.nostr as { _pubkey?: string | null } | undefined;
    if (n && '_pubkey' in n) n._pubkey = null;
  } catch {
    /* ignore */
  }
}

/** Extensions inject window.nostr after DOMContentLoaded — poll briefly. */
async function waitForNostr(timeoutMs = 4000): Promise<NonNullable<Window['nostr']> | null> {
  if (typeof window === 'undefined') return null;
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
    if (!muteEvent) {
      applyMuteList(parseMuteList(null, []));
      return;
    }
    const extra = await decryptPrivateMuteTags(muteEvent);
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
      // Public mute tags now; private decrypt is deferred so huge NIP-44 lists do not
      // starve landing relays / freeze the page on first paint.
      const muteEvent = newestMuteList(metadataEvents);
      applyMuteList(parseMuteList(muteEvent, []));
      const defer = typeof window !== 'undefined' ? window.setTimeout.bind(window) : setTimeout;
      defer(() => {
        void applyMuteFromMetadata(metadataEvents).catch(() => {});
      }, 3500);

      const relayList = latestReplaceable(metadataEvents, KIND.RELAY_LIST);
      const favoriteList = latestReplaceable(metadataEvents, KIND.FAVORITE);
      const blockedList = latestReplaceable(metadataEvents, KIND.BLOCKED);
      const localList = latestReplaceable(metadataEvents, KIND.LOCAL);
      const { inbox, outbox } = nip65InboxOutbox(relayList);

      setSelectorContext({
        signedIn: true,
        inbox,
        outbox,
        favorites: relayTagUrls(favoriteList),
        local: relayTagUrls(localList),
        blocked: relayTagUrls(blockedList)
      });
      void import('../trusted-assertions').then(({ trustedAssertions }) => {
        trustedAssertions.resetForViewer(pubkey);
        void trustedAssertions.resolveProvider(pubkey);
      });
      // FoF can be large — wait until after the first landing paint window.
      const deferFof = typeof window !== 'undefined' ? window.setTimeout.bind(window) : setTimeout;
      deferFof(() => {
        void import('../follows-of-follows').then(({ resetFollowsOfFollows, ensureFollowsOfFollows }) => {
          resetFollowsOfFollows(pubkey);
          const follows = followPubkeysFromMetadata(metadataEvents);
          void ensureFollowsOfFollows(pubkey, follows);
        });
      }, 3500);
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
    // loading=true before metadata clear so Home skips the empty-list notify.
    set({ pubkey, npub, loading: true });
    writePersistedSession(pubkey, npub);
    relayPool.setSignedIn(true);
    metadataEvents = [];
    metadata.set([]);
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
      clearNip07PagePubkeyCache();
      const pubkey = (await ext.getPublicKey()).toLowerCase();
      await applyPubkey(pubkey, true);
      return true;
    } catch {
      update((s) => ({ ...s, loading: false }));
      return false;
    }
  }

  /**
   * Re-attach identity after reload only when a session was persisted (explicit sign-in).
   * Paint immediately from localStorage — window.nostr is often injected late.
   * Confirm against NIP-07 in the background when the extension appears.
   * Never call getPublicKey() when localStorage is empty — that would re-login after sign-out.
   */
  async function restore(): Promise<boolean> {
    if (get({ subscribe }).pubkey) return true;

    const persisted = readPersistedSession();
    if (persisted) {
      set({ pubkey: persisted.pubkey, npub: persisted.npub, loading: true });
      relayPool.setSignedIn(true);
      metadataEvents = [];
      metadata.set([]);
      void confirmRestoredSession(persisted);
      return true;
    }

    update((s) => ({ ...s, loading: false }));
    return false;
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
    const previousPubkey = get({ subscribe }).pubkey;
    clearPersistedSession();
    clearNip07PagePubkeyCache();
    set({ pubkey: null, npub: null, loading: false });
    metadataEvents = [];
    metadata.set([]);
    clearMute();
    setSelectorContext({ signedIn: false, inbox: [], outbox: [], favorites: [], local: [], blocked: [] });
    relayPool.setSignedIn(false);
    void import('../trusted-assertions').then(({ trustedAssertions }) => {
      trustedAssertions.resetForViewer(null);
      void trustedAssertions.resolveProvider(null);
    });
    void import('../follows-of-follows').then(({ resetFollowsOfFollows }) => {
      resetFollowsOfFollows();
    });
    void import('../nostr/cache').then(({ cacheClearLandingSnapshot }) => {
      void cacheClearLandingSnapshot();
    });
    if (previousPubkey) {
      try {
        localStorage.removeItem(`alexandria.nip85.provider.${previousPubkey.toLowerCase()}`);
      } catch {
        /* ignore */
      }
    }
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
