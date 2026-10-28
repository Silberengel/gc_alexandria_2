import { writable, get } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { KIND, LOGIN_METADATA_KINDS } from '../constants';
import { applyMuteList, clearMute, decryptPrivateMuteTags, newestMuteList, parseMuteList, latestReplaceable, followPubkeysFromMetadata } from '../mute';
import { cachePutMany } from '../nostr/cache';
import { cachedViewerIdentity, rememberIdentityEvent } from '../nostr/identity-cache';
import { relayPool, type RelayAuthHandler } from '../nostr/pool';
import {
  documentStack,
  foreignRelaysAllowed,
  getSelectorContext,
  liveChatWriteStack,
  profileStack,
  setSelectorContext,
  socialStack,
  viewerOutboxStack,
  writeStack
} from '../nostr/selector';
import { inboxRelaysForResponse, uniqueRelayUrls } from '../nostr/mailboxes';
import { nip65InboxOutbox, relayTagUrls } from '../nostr/nip65';
import { mergeRememberedMetadata } from '../session-metadata';
import { pruneToLatestReplaceables } from '../nostr/replaceable';
import { rememberDeletion } from '../deletions';
import { sanitizeStoredBunkerUrl } from '../bunker-auth-url';
import type { BunkerLoginOptions, Signer, SignerType } from '../signer';
import { BunkerSigner } from '../signers/bunker';
import { Nip07Signer, clearNip07PagePubkeyCache } from '../signers/nip07';
import { NostrConnectionSigner } from '../signers/nostr-connection';
import { liveChatShield } from './live-chat-shield';

/** Kinds that live on social/interaction relays (not Mercury's document index). */
const SOCIAL_LOGIN_KINDS = [
  KIND.CONTACT_LIST,
  KIND.MUTE,
  KIND.PIN,
  KIND.BOOKMARK,
  KIND.COMMUNITIES,
  KIND.BLOCKED,
  KIND.FAVORITE,
  KIND.LABEL,
  KIND.DIRECTORY,
  KIND.FOLLOW_SET,
  KIND.DEPRECATED_CATEGORIZED_LIST,
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

  /** Sign NIP-42 AUTH challenges with the live session signer. */
  function wireRelayAuth(): void {
    if (!activeSigner) {
      relayPool.setAuthHandler(null);
      return;
    }
    const signer = activeSigner;
    const handler: RelayAuthHandler = async (evt) => {
      // NIP-42 examples use a trailing slash; several AUTH-strict relays require it
      // even when the WebSocket URL was normalized without one.
      const tags = (evt.tags ?? []).map((tag) => {
        if (tag[0] !== 'relay' || !tag[1]) return tag;
        const url = tag[1].endsWith('/') ? tag[1] : `${tag[1]}/`;
        return ['relay', url];
      });
      const signed = await signer.signEvent({
        kind: evt.kind,
        content: evt.content ?? '',
        tags,
        created_at: evt.created_at
      });
      return signed as Awaited<ReturnType<RelayAuthHandler>>;
    };
    relayPool.setAuthHandler(handler);
  }

  async function applyMuteFromMetadata(events: Event[]): Promise<void> {
    const muteEvent = newestMuteList(events);
    if (!muteEvent) {
      applyMuteList(parseMuteList(null, []));
      return;
    }
    const extra = await decryptPrivateMuteTags(muteEvent);
    applyMuteList(parseMuteList(muteEvent, extra));
  }

  async function applyRelayContextFromEvents(events: Event[], viewerPubkey: string): Promise<void> {
    const relayList = latestReplaceable(events, KIND.RELAY_LIST);
    const favoriteList = latestReplaceable(events, KIND.FAVORITE);
    const blockedList = latestReplaceable(events, KIND.BLOCKED);
    const localList = latestReplaceable(events, KIND.LOCAL);
    const { inbox, outbox } = nip65InboxOutbox(relayList);
    setSelectorContext({
      signedIn: true,
      viewerPubkey,
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
    // Keep events authored this session (e.g. a just-signed 16374) across the replace below.
    const priorLocal = metadataEvents;
    try {
      // Phase 1: NIP-65 / favorites so subsequent shelf REQs include the viewer's outboxes.
      // A first wave often dies while the browser is still opening sockets. Retry before
      // the feed decides this account has no inboxes and stays on theforest.
      const bootKinds = [
        KIND.RELAY_LIST,
        KIND.FAVORITE,
        KIND.BLOCKED,
        KIND.LOCAL,
        KIND.PRIVATE_RELAY_LIST
      ];
      const bootFilter = [{ authors: [pubkey], kinds: bootKinds, limit: 20 }];
      let bootEvents: Event[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (get({ subscribe }).pubkey?.toLowerCase() !== pubkey.toLowerCase()) return;
        const [bootSocial, bootProfile] = await Promise.allSettled([
          relayPool.query(socialStack(), bootFilter, attempt === 0 ? 2500 : 5000, 4, undefined, {
            priority: true,
            includeCooling: attempt > 0
          }),
          relayPool.query(profileStack(), [profileFilter], attempt === 0 ? 2500 : 5000, 4, undefined, {
            priority: true,
            includeCooling: attempt > 0
          })
        ]);
        bootEvents = [
          ...(bootSocial.status === 'fulfilled' ? bootSocial.value : []),
          ...(bootProfile.status === 'fulfilled' ? bootProfile.value : [])
        ];
        if (bootEvents.some((event) => event.kind === KIND.RELAY_LIST || event.kind === KIND.FAVORITE)) {
          break;
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      const hadCachedLists =
        getSelectorContext().inbox.length > 0 || getSelectorContext().favorites.length > 0;
      const gotFreshLists = bootEvents.some(
        (event) => event.kind === KIND.RELAY_LIST || event.kind === KIND.FAVORITE
      );
      if (gotFreshLists || !hadCachedLists) await applyRelayContextFromEvents(bootEvents, pubkey);

      // Phase 2: full lists — social + document stacks now prepend inbox/outbox.
      const outboxSocial = viewerOutboxStack();
      const [docResult, socialResult, profileResult, outboxShelf] =
        await Promise.allSettled([
          relayPool.query(
            documentStack(),
            [listFilter, { authors: [pubkey], kinds: [KIND.DIRECTORY], limit: 40 }],
            4000
          ),
          relayPool.query(socialStack(), [socialFilter, shelfFilter], 4000),
          relayPool.query(profileStack(), [profileFilter], 4000),
          relayPool.query(outboxSocial, [shelfFilter], 4000, 2)
        ]);
      const doc = docResult.status === 'fulfilled' ? docResult.value : [];
      const social = socialResult.status === 'fulfilled' ? socialResult.value : [];
      const profiles = profileResult.status === 'fulfilled' ? profileResult.value : [];
      const dirs = doc.filter((e) => e.kind === KIND.DIRECTORY);
      const shelf = social.filter((e) =>
        (SHELF_LOGIN_KINDS as readonly number[]).includes(e.kind)
      );
      const outboxLists = outboxShelf.status === 'fulfilled' ? outboxShelf.value : [];
      const byId = new Map<string, Event>();
      for (const e of [...bootEvents, ...doc, ...social, ...profiles, ...outboxLists]) {
        byId.set(e.id, e);
      }
      let merged = [...byId.values()];
      // Prefer a newer local kind 16374 / shelf / label over a stale relay copy.
      for (const local of priorLocal) {
        if (local.pubkey.toLowerCase() !== pubkey.toLowerCase()) continue;
        merged = mergeRememberedMetadata(merged, local);
      }
      // One NIP-01 winner per replaceable/addressable coord (mute, relays, queue, dirs, …).
      metadataEvents = pruneToLatestReplaceables(merged);
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
      for (const event of metadataEvents) rememberIdentityEvent(event);
      // Public mute tags now; private decrypt is deferred so huge NIP-44 lists do not
      // starve landing relays / freeze the page on first paint.
      const muteEvent = newestMuteList(metadataEvents);
      applyMuteList(parseMuteList(muteEvent, []));
      const defer = typeof window !== 'undefined' ? window.setTimeout.bind(window) : setTimeout;
      defer(() => {
        void applyMuteFromMetadata(metadataEvents).catch(() => {});
      }, 3500);

      await applyRelayContextFromEvents(metadataEvents, pubkey);
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
      // Do not wipe a queue the user just signed while relays failed.
      metadataEvents = priorLocal;
      metadata.set(metadataEvents);
      setSelectorContext({
        signedIn: true,
        viewerPubkey: pubkey,
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
    const previousPubkey = get({ subscribe }).pubkey?.toLowerCase() ?? null;
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
    wireRelayAuth();
    metadataEvents = [];
    metadata.set([]);
    if (previousPubkey && previousPubkey !== pubkey) {
      void import('../nostr/cache').then(({ cacheClearLandingSnapshot }) => {
        void cacheClearLandingSnapshot();
      });
      void import('../trusted-assertions').then(({ trustedAssertions }) => {
        trustedAssertions.resetForViewer(previousPubkey);
      });
      void import('../follows-of-follows').then(({ resetFollowsOfFollows }) => {
        resetFollowsOfFollows(previousPubkey);
      });
    }
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
      await adoptSigner(signer as Signer, result.pubkey, {
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
    const seeded = cachedViewerIdentity(persisted.pubkey);
    metadataEvents = seeded;
    metadata.set(seeded);
    if (seeded.length) {
      void applyRelayContextFromEvents(seeded, persisted.pubkey);
      const muteEvent = newestMuteList(seeded);
      if (muteEvent) applyMuteList(parseMuteList(muteEvent, []));
    }
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
        wireRelayAuth();
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
      wireRelayAuth();
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
    setSelectorContext({
      signedIn: false,
      viewerPubkey: '',
      inbox: [],
      outbox: [],
      favorites: [],
      local: [],
      blocked: []
    });
    relayPool.setSignedIn(false);
    relayPool.setAuthHandler(null);
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
      void import('../compose-drafts').then(({ clearComposeDraftsForPubkey }) => {
        clearComposeDraftsForPubkey(previousPubkey);
      });
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
      wireRelayAuth();
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

  /**
   * Cache + remember, then publish only to the given relays (no outbox fan-out).
   * Pass `bypassConstrain` for NIP-37 private-storage URLs that are intentionally
   * outside the viewer's NIP-65 allowlist.
   */
  async function publishToRelays(
    event: Event,
    relays: string[],
    opts?: { bypassConstrain?: boolean }
  ): Promise<boolean> {
    try {
      await cachePutMany([event]);
    } catch {
      /* private mode / quota */
    }
    rememberEvent(event);
    const urls = uniqueRelayUrls(relays);
    if (!urls.length) return false;
    let timer = 0;
    const timeout = new Promise<boolean>((resolve) => {
      timer = window.setTimeout(() => resolve(false), 8_000);
    });
    try {
      return await Promise.race([
        relayPool
          .publish(urls, event, { bypassConstrain: opts?.bypassConstrain === true })
          .then((accepted) => accepted > 0),
        timeout
      ]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** True when at least one write relay accepts the event. */
  async function publish(event: Event): Promise<boolean> {
    // Cache + session metadata first so a confirmed publish can paint from cache
    // without another relay round-trip. Callers decide whether zero accepts is failure.
    try {
      await cachePutMany([event]);
    } catch {
      /* private mode / quota */
    }
    rememberEvent(event);
    // Own relays start immediately. The other person's inbox is added when Outboxes
    // is on, without holding the like or comment until that lookup finishes.
    const own = writeStack();
    const ownKeys = new Set(own.map((url) => url.replace(/\/+$/, '').toLowerCase()));
    const ownWrite = relayPool.publish(own, event).then((accepted) => accepted > 0);
    const extraWrite = (
      foreignRelaysAllowed()
        ? inboxRelaysForResponse(event).catch(() => [] as string[])
        : Promise.resolve([] as string[])
    ).then(async (extra) => {
      const more = uniqueRelayUrls(extra).filter(
        (url) => !ownKeys.has(url.replace(/\/+$/, '').toLowerCase())
      );
      if (!more.length) return false;
      return (await relayPool.publish(more, event)) > 0;
    });
    // Live chat / presence always fan out to the public lane (and blocked hosts when open).
    const liveKinds = event.kind === KIND.LIVE_CHAT || event.kind === KIND.ROOM_PRESENCE;
    const liveWrite = liveKinds
      ? (() => {
          const lane = liveChatWriteStack({ respectBlocked: liveChatShield.get() }).filter(
            (url) => !ownKeys.has(url.replace(/\/+$/, '').toLowerCase())
          );
          if (!lane.length) return Promise.resolve(false);
          return relayPool.publish(lane, event).then((accepted) => accepted > 0);
        })()
      : Promise.resolve(false);
    let timer = 0;
    const timeout = new Promise<boolean>((resolve) => {
      timer = window.setTimeout(() => resolve(false), 8_000);
    });
    try {
      return await Promise.race([firstRelayAccept([ownWrite, extraWrite, liveWrite]), timeout]);
    } finally {
      window.clearTimeout(timer);
    }
  }

  function rememberEvent(event: Event): void {
    if (event.kind === KIND.DELETION) rememberDeletion(event);
    rememberIdentityEvent(event);
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
    publishToRelays,
    rememberEvent,
    ensureBunkerSigner,
    metadata,
    getPubkey: () => get({ subscribe }).pubkey,
    getMetadata: () => metadataEvents,
    getSigner: () => activeSigner,
    /** Prefer live signer type; fall back to painted/persisted session type. */
    getSignerType: () => activeSignerType ?? get({ subscribe }).signerType
  };
}

/** Resolve on the first success. A later inbox publish still runs. */
function firstRelayAccept(jobs: Promise<boolean>[]): Promise<boolean> {
  return new Promise((resolve) => {
    if (!jobs.length) {
      resolve(false);
      return;
    }
    let pending = jobs.length;
    let accepted = false;
    for (const job of jobs) {
      void job
        .then((ok) => {
          if (!ok) return;
          accepted = true;
          resolve(true);
        })
        .catch(() => {
          /* one path failing still leaves the other */
        })
        .finally(() => {
          pending -= 1;
          if (pending <= 0) resolve(accepted);
        });
    }
  });
}

export const session = createSessionStore();

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
