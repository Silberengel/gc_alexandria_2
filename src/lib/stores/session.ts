import { writable, derived, get } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { KIND, LOGIN_METADATA_KINDS } from '../constants';
import { applyMuteList, clearMute, decryptPrivateMuteTags, newestMuteList, parseMuteList, latestReplaceable, followPubkeysFromMetadata } from '../mute';
import { cachePutMany } from '../nostr/cache';
import { relayPool } from '../nostr/pool';
import { documentStack, profileStack, setSelectorContext, socialStack, viewerOutboxStack, writeStack } from '../nostr/selector';
import { nip65InboxOutbox, relayTagUrls } from '../nostr/nip65';
import { mergeRememberedMetadata } from '../session-metadata';
import { rememberDeletion } from '../deletions';
import { sanitizeStoredBunkerUrl } from '../bunker-auth-url';
import type { BunkerLoginOptions, Signer, SignerType } from '../signer';
import { BunkerSigner } from '../signers/bunker';
import { Nip07Signer, clearNip07PagePubkeyCache } from '../signers/nip07';
import { NostrConnectionSigner } from '../signers/nostr-connection';

/** Kinds that live on social/interaction relays (not Mercury's document index). */
const SOCIAL_LOGIN_KINDS = [
  KIND.CONTACT_LIST,
  KIND.MUTE,
  KIND.BOOKMARK,
  KIND.BLOCKED,
  KIND.FAVORITE,
  KIND.LABEL,
  KIND.DIRECTORY,
  KIND.FOLLOW_SET,
  KIND.STATUS,
  KIND.PAYMENT
] as const;

/** Pinned separately so My shelf / reading queue are not crowded out of the limit:100 batch. */
const SHELF_LOGIN_KINDS = [KIND.BOOKMARK, KIND.DIRECTORY, KIND.READING_QUEUE] as const;

const SESSION_STORAGE_KEY = 'alexandria-session';

type PersistedSession = {
  pubkey: string;
  npub: string;
  signerType: SignerType;
  bunker?: string;
  bunkerClientSecretKey?: string;
};

function readPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PersistedSession>;
    const pubkey = typeof data.pubkey === 'string' ? data.pubkey.toLowerCase() : '';
    const npub = typeof data.npub === 'string' ? data.npub : '';
    if (!/^[0-9a-f]{64}$/.test(pubkey) || !npub.startsWith('npub1')) return null;
    const signerType: SignerType = data.signerType === 'bunker' ? 'bunker' : 'nip07';
    const bunker = typeof data.bunker === 'string' ? data.bunker : undefined;
    const bunkerClientSecretKey =
      typeof data.bunkerClientSecretKey === 'string' ? data.bunkerClientSecretKey : undefined;
    if (signerType === 'bunker' && (!bunker || !bunkerClientSecretKey)) return null;
    return { pubkey, npub, signerType, bunker, bunkerClientSecretKey };
  } catch {
    return null;
  }
}

function writePersistedSession(session: PersistedSession): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
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
  signerType: SignerType | null;
};

function createSessionStore() {
  const { subscribe, set, update } = writable<SessionState>({
    pubkey: null,
    npub: null,
    loading: false,
    signerType: null
  });

  let metadataEvents: Event[] = [];
  const metadata = writable<Event[]>([]);
  let activeSigner: Signer | null = null;
  let activeSignerType: SignerType | null = null;
  let bunkerUrl: string | undefined;
  let bunkerClientSecretKey: string | undefined;

  async function applyMuteFromMetadata(events: Event[]): Promise<void> {
    const muteEvent = newestMuteList(events);
    if (!muteEvent) {
      applyMuteList(parseMuteList(null, []));
      return;
    }
    const extra = await decryptPrivateMuteTags(muteEvent);
    applyMuteList(parseMuteList(muteEvent, extra));
  }

  async function applyRelayContextFromEvents(events: Event[]): Promise<void> {
    const relayList = latestReplaceable(events, KIND.RELAY_LIST);
    const favoriteList = latestReplaceable(events, KIND.FAVORITE);
    const blockedList = latestReplaceable(events, KIND.BLOCKED);
    const localList = latestReplaceable(events, KIND.LOCAL);
    const { inbox, outbox } = nip65InboxOutbox(relayList);
    setSelectorContext({
      signedIn: true,
      inbox,
      outbox,
      favorites: relayTagUrls(favoriteList),
      local: relayTagUrls(localList),
      blocked: relayTagUrls(blockedList)
    });
  }

  async function loadMetadata(pubkey: string): Promise<void> {
    // Login lists / kind 0 are not on Mercury (document kinds only).
    // 1985/10003 live on the social stack — document-only REQs miss most bookmarks/labels.
    const listKinds = LOGIN_METADATA_KINDS.filter((k) => k !== KIND.METADATA);
    const listFilter = { authors: [pubkey], kinds: listKinds, limit: 100 };
    const socialFilter = {
      authors: [pubkey],
      kinds: [...SOCIAL_LOGIN_KINDS],
      limit: 100
    };
    const profileFilter = { authors: [pubkey], kinds: [KIND.METADATA], limit: 1 };
    // Bookmarks + directories + reading queue must not compete with dozens of 1985s in the
    // multi-kind limit:100 batch — otherwise My shelf never appears.
    const shelfFilter = {
      authors: [pubkey],
      kinds: [...SHELF_LOGIN_KINDS],
      limit: 40
    };
    try {
      // Phase 1: NIP-65 / favorites so subsequent shelf REQs include the viewer's outboxes.
      const bootKinds = [KIND.RELAY_LIST, KIND.FAVORITE, KIND.BLOCKED, KIND.LOCAL];
      const [bootSocial, bootProfile] = await Promise.allSettled([
        relayPool.query(
          socialStack(),
          [{ authors: [pubkey], kinds: bootKinds, limit: 20 }],
          2500
        ),
        relayPool.query(profileStack(), [profileFilter], 2500)
      ]);
      const bootEvents = [
        ...(bootSocial.status === 'fulfilled' ? bootSocial.value : []),
        ...(bootProfile.status === 'fulfilled' ? bootProfile.value : [])
      ];
      await applyRelayContextFromEvents(bootEvents);

      // Phase 2: full lists — social + document stacks now prepend inbox/outbox.
      const outboxSocial = viewerOutboxStack();
      const [docResult, socialResult, profileResult, shelfResult, dirResult, outboxShelf] =
        await Promise.allSettled([
          relayPool.query(documentStack(), [listFilter], 4000),
          relayPool.query(socialStack(), [socialFilter], 4000),
          relayPool.query(profileStack(), [profileFilter], 4000),
          relayPool.query(socialStack(), [shelfFilter], 4000),
          relayPool.query(
            documentStack(),
            [{ authors: [pubkey], kinds: [KIND.DIRECTORY], limit: 40 }],
            4000
          ),
          // Explicit outbox pass for bookmarks/dirs — Jumble-style “my lists live on my writes”.
          // Cap at 2 relays: personal write hosts are often rate-limited (e.g. 12 msg/min).
          relayPool.query(outboxSocial, [shelfFilter], 4000, 2)
        ]);
      const doc = docResult.status === 'fulfilled' ? docResult.value : [];
      const social = socialResult.status === 'fulfilled' ? socialResult.value : [];
      const profiles = profileResult.status === 'fulfilled' ? profileResult.value : [];
      const shelf = shelfResult.status === 'fulfilled' ? shelfResult.value : [];
      const dirs = dirResult.status === 'fulfilled' ? dirResult.value : [];
      const outboxLists = outboxShelf.status === 'fulfilled' ? outboxShelf.value : [];
      const byId = new Map<string, Event>();
      for (const e of [...bootEvents, ...doc, ...social, ...profiles, ...shelf, ...dirs, ...outboxLists]) {
        byId.set(e.id, e);
      }
      metadataEvents = [...byId.values()];
      metadata.set(metadataEvents);
      const kindCounts: Record<string, number> = {};
      for (const e of metadataEvents) {
        const k = String(e.kind);
        kindCounts[k] = (kindCounts[k] ?? 0) + 1;
      }
      console.info('[alexandria:session] login metadata', {
        pubkey: pubkey.slice(0, 8),
        total: metadataEvents.length,
        bookmarks: kindCounts[String(KIND.BOOKMARK)] ?? 0,
        directories: kindCounts[String(KIND.DIRECTORY)] ?? 0,
        labels: kindCounts[String(KIND.LABEL)] ?? 0,
        readingQueue: kindCounts[String(KIND.READING_QUEUE)] ?? 0,
        shelfQueryEvents: shelf.length,
        dirQueryEvents: dirs.length,
        outboxShelfEvents: outboxLists.length,
        kindCounts
      });
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

      await applyRelayContextFromEvents(metadataEvents);
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

  async function adoptSigner(
    signer: Signer,
    pubkeyRaw: string,
    opts: {
      signerType: SignerType;
      bunker?: string;
      bunkerClientSecretKey?: string;
      waitMetadata?: boolean;
    }
  ): Promise<void> {
    const pubkey = pubkeyRaw.toLowerCase();
    const { nip19 } = await import('nostr-tools');
    const npub = nip19.npubEncode(pubkey);
    activeSigner = signer;
    activeSignerType = opts.signerType;
    bunkerUrl = opts.bunker;
    bunkerClientSecretKey = opts.bunkerClientSecretKey;
    set({ pubkey, npub, loading: true, signerType: opts.signerType });
    writePersistedSession({
      pubkey,
      npub,
      signerType: opts.signerType,
      bunker: opts.bunker,
      bunkerClientSecretKey: opts.bunkerClientSecretKey
    });
    relayPool.setSignedIn(true);
    metadataEvents = [];
    metadata.set([]);
    const meta = loadMetadata(pubkey).finally(() => update((s) => ({ ...s, loading: false })));
    if (opts.waitMetadata !== false) await meta;
  }

  /** NIP-07 browser extension sign-in. */
  async function signIn(): Promise<boolean> {
    update((s) => ({ ...s, loading: true }));
    try {
      const ext = (await waitForNostr(1500)) ?? window.nostr;
      if (!ext?.getPublicKey) {
        update((s) => ({ ...s, loading: false }));
        return false;
      }
      const signer = new Nip07Signer();
      const pubkey = await signer.getPublicKey();
      await adoptSigner(signer, pubkey, { signerType: 'nip07' });
      return true;
    } catch {
      update((s) => ({ ...s, loading: false }));
      return false;
    }
  }

  /** Paste or scan a `bunker://` URI (Amber / nsec.app / Pomegranate). */
  async function bunkerLogin(bunker: string, options?: BunkerLoginOptions): Promise<boolean> {
    update((s) => ({ ...s, loading: true }));
    try {
      const signer = new BunkerSigner();
      const pubkey = await signer.login(bunker, true, options);
      await adoptSigner(signer, pubkey, {
        signerType: 'bunker',
        bunker: sanitizeStoredBunkerUrl(bunker),
        bunkerClientSecretKey: signer.getClientSecretKey()
      });
      return true;
    } catch (err) {
      update((s) => ({ ...s, loading: false }));
      throw err;
    }
  }

  /** Amber / NostrConnect — wait for remote ack on `nostrconnect://`. */
  async function nostrConnectionLogin(
    clientSecretKey: Uint8Array,
    connectionString: string,
    abortSignal?: AbortSignal
  ): Promise<boolean> {
    update((s) => ({ ...s, loading: true }));
    try {
      const signer = new NostrConnectionSigner(clientSecretKey, connectionString);
      const result = await signer.login(abortSignal);
      await adoptSigner(signer, result.pubkey, {
        signerType: 'bunker',
        bunker: result.bunkerString ? sanitizeStoredBunkerUrl(result.bunkerString) : undefined,
        bunkerClientSecretKey: signer.getClientSecretKey()
      });
      return true;
    } catch (err) {
      update((s) => ({ ...s, loading: false }));
      throw err;
    }
  }

  /**
   * Re-attach identity after reload only when a session was persisted (explicit sign-in).
   * Paint immediately from localStorage — window.nostr is often injected late.
   * Never call getPublicKey() when localStorage is empty — that would re-login after sign-out.
   */
  async function restore(): Promise<boolean> {
    if (get({ subscribe }).pubkey) return true;

    const persisted = readPersistedSession();
    if (!persisted) {
      update((s) => ({ ...s, loading: false }));
      return false;
    }

    set({
      pubkey: persisted.pubkey,
      npub: persisted.npub,
      loading: true,
      signerType: persisted.signerType
    });
    relayPool.setSignedIn(true);
    metadataEvents = [];
    metadata.set([]);
    void confirmRestoredSession(persisted);
    return true;
  }

  async function confirmRestoredSession(persisted: PersistedSession): Promise<void> {
    if (persisted.signerType === 'bunker' && persisted.bunker && persisted.bunkerClientSecretKey) {
      try {
        const signer = new BunkerSigner(persisted.bunkerClientSecretKey);
        const pubkey = await signer.login(persisted.bunker, false);
        activeSigner = signer;
        activeSignerType = 'bunker';
        bunkerUrl = persisted.bunker;
        bunkerClientSecretKey = persisted.bunkerClientSecretKey;
        if (pubkey.toLowerCase() !== persisted.pubkey) {
          await adoptSigner(signer, pubkey, {
            signerType: 'bunker',
            bunker: persisted.bunker,
            bunkerClientSecretKey: persisted.bunkerClientSecretKey,
            waitMetadata: false
          });
          return;
        }
        void loadMetadata(persisted.pubkey).finally(() => update((s) => ({ ...s, loading: false })));
      } catch {
        // Keep painted identity; signing may fail until ensureBunkerSigner / re-login.
        void loadMetadata(persisted.pubkey).finally(() => update((s) => ({ ...s, loading: false })));
      }
      return;
    }

    const ext = await waitForNostr(4000);
    if (!ext?.getPublicKey) {
      void loadMetadata(persisted.pubkey).finally(() => update((s) => ({ ...s, loading: false })));
      return;
    }
    try {
      const signer = new Nip07Signer();
      const pubkey = await signer.getPublicKey();
      if (pubkey !== persisted.pubkey) {
        await adoptSigner(signer, pubkey, { signerType: 'nip07', waitMetadata: false });
        return;
      }
      activeSigner = signer;
      activeSignerType = 'nip07';
      void loadMetadata(pubkey).finally(() => update((s) => ({ ...s, loading: false })));
    } catch {
      // Some extensions need a user gesture for getPublicKey — keep persisted identity.
      void loadMetadata(persisted.pubkey).finally(() => update((s) => ({ ...s, loading: false })));
    }
  }

  function signOut(): void {
    const previousPubkey = get({ subscribe }).pubkey;
    const previousSigner = activeSigner;
    clearPersistedSession();
    clearNip07PagePubkeyCache();
    activeSigner = null;
    activeSignerType = null;
    bunkerUrl = undefined;
    bunkerClientSecretKey = undefined;
    set({ pubkey: null, npub: null, loading: false, signerType: null });
    metadataEvents = [];
    metadata.set([]);
    clearMute();
    setSelectorContext({ signedIn: false, inbox: [], outbox: [], favorites: [], local: [], blocked: [] });
    relayPool.setSignedIn(false);
    if (previousSigner && 'close' in previousSigner && typeof previousSigner.close === 'function') {
      void (previousSigner as { close: () => Promise<void> }).close();
    }
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

  /**
   * Rebuild the Amber/bunker signer from persisted credentials.
   * Call before signing when restore left a painted pubkey without a live signer,
   * or after mobile sleep killed the NIP-46 websocket.
   */
  async function ensureBunkerSigner(): Promise<boolean> {
    const persisted = readPersistedSession();
    const bunker =
      bunkerUrl ??
      (persisted?.signerType === 'bunker' ? persisted.bunker : undefined);
    const secret =
      bunkerClientSecretKey ??
      (persisted?.signerType === 'bunker' ? persisted.bunkerClientSecretKey : undefined);
    if (!bunker || !secret) return false;
    if (activeSigner && activeSignerType === 'bunker' && 'ensureConnected' in activeSigner) {
      try {
        await (activeSigner as BunkerSigner).ensureConnected();
        return true;
      } catch {
        /* fall through to full rebuild */
      }
    }
    try {
      const previous = activeSigner;
      const signer = new BunkerSigner(secret);
      const pubkey = await signer.login(bunker, false);
      activeSigner = signer;
      activeSignerType = 'bunker';
      bunkerUrl = bunker;
      bunkerClientSecretKey = secret;
      if (previous && previous !== signer && 'close' in previous) {
        void (previous as { close: () => Promise<void> }).close();
      }
      const current = get({ subscribe }).pubkey;
      if (current && pubkey.toLowerCase() !== current.toLowerCase()) {
        await adoptSigner(signer, pubkey, {
          signerType: 'bunker',
          bunker,
          bunkerClientSecretKey: secret,
          waitMetadata: false
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  async function publish(event: Event): Promise<void> {
    const relays = writeStack();
    await relayPool.publish(relays, event);
    await cachePutMany([event]);
    rememberEvent(event);
  }

  function rememberEvent(event: Event): void {
    if (event.kind === KIND.DELETION) rememberDeletion(event);
    const pk = get({ subscribe }).pubkey;
    if (!pk || event.pubkey.toLowerCase() !== pk) return;
    metadataEvents = mergeRememberedMetadata(metadataEvents, event);
    metadata.set(metadataEvents);
  }

  return {
    subscribe,
    signIn,
    bunkerLogin,
    nostrConnectionLogin,
    restore,
    signOut,
    publish,
    rememberEvent,
    ensureBunkerSigner,
    metadata,
    getPubkey: () => get({ subscribe }).pubkey,
    getMetadata: () => metadataEvents,
    getSigner: () => activeSigner,
    getSignerType: () => activeSignerType
  };
}

export const session = createSessionStore();

export const isSignedIn = derived(session, ($s) => !!$s.pubkey);

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent?(event: unknown): Promise<unknown>;
      enable?(): Promise<void>;
      nip04?: {
        encrypt?(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
      nip44?: {
        encrypt?(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
      _pubkey?: string | null;
    };
  }
}
