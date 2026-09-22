import {
  GRAPEVINE_FALLBACK_OBSERVER_PUBKEY,
  GRAPEVINE_FALLBACK_SERVICE_PUBKEY,
  GRAPEVINE_SCORES_RELAY_URL,
  GRAPEVINE_SCORES_STAGING_RELAY_URL,
  KIND,
  PROFILE_RELAYS
} from './constants';
import {
  isValidPubkey,
  parseNip85ProviderFrom10040,
  parseTrustedAssertionScore,
  trustedAssertionCacheKey,
  type Nip85ProviderRef,
  type TrustedAssertionScore
} from './nip85-trusted-assertions';
import { normalizeWebSocketRelay } from './nostr/relay-filters';
import { relayPool } from './nostr/pool';
import type { Event, Filter } from 'nostr-tools';

export type TrustedAssertionsSource = 'viewer' | 'fallback' | 'builtin' | 'none';

export type TrustedAssertionsProviderState = {
  source: TrustedAssertionsSource;
  observerPubkey: string;
  provider: Nip85ProviderRef | null;
  isPersonalized: boolean;
  grapevineReady: boolean;
};

type ScoreCacheEntry = {
  score: TrustedAssertionScore | null;
  definiteMiss: boolean;
  updatedAt: number;
};

const SCORE_LRU_MAX = 8_000;
const KIND_10040_TIMEOUT_MS = 4_000;
const REQUEST_COALESCE_MS = 50;
const SCORE_FETCH_TIMEOUT_MS = 12_000;
const SUBJECT_D_BATCH = 40;
const SCORE_MISS_TTL_MS = 30_000;
const PROVIDER_LS_PREFIX = 'alexandria.nip85.provider.';

function communityFallbackProvider(): Nip85ProviderRef {
  return {
    metric: '30382:rank',
    servicePubkey: GRAPEVINE_FALLBACK_SERVICE_PUBKEY,
    relayUrl: GRAPEVINE_SCORES_RELAY_URL
  };
}

function createTrustedAssertions() {
  const memoryScores = new Map<string, ScoreCacheEntry>();
  let providerState: TrustedAssertionsProviderState = {
    source: 'none',
    observerPubkey: GRAPEVINE_FALLBACK_OBSERVER_PUBKEY,
    provider: null,
    isPersonalized: false,
    grapevineReady: false
  };
  let resetViewerKey: string | null = null;
  let scoreVersion = 0;
  let resolvePromise: Promise<TrustedAssertionsProviderState> | null = null;
  let resolvedCacheKey: string | null = null;
  let resolveInFlightKey: string | null = null;
  const listeners = new Set<() => void>();
  const pendingSubjects = new Set<string>();
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;

  function notify(): void {
    for (const l of listeners) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  }

  function bumpScores(): void {
    scoreVersion += 1;
    notify();
  }

  function setProviderState(next: TrustedAssertionsProviderState): boolean {
    const prev = providerState;
    const same =
      prev.source === next.source &&
      prev.observerPubkey === next.observerPubkey &&
      prev.isPersonalized === next.isPersonalized &&
      prev.grapevineReady === next.grapevineReady &&
      prev.provider?.servicePubkey === next.provider?.servicePubkey &&
      prev.provider?.relayUrl === next.provider?.relayUrl &&
      prev.provider?.metric === next.provider?.metric;
    if (same) return false;
    providerState = next;
    notify();
    return true;
  }

  function persistedProviderKey(observerPubkey: string): string {
    return `${PROVIDER_LS_PREFIX}${observerPubkey.toLowerCase()}`;
  }

  function readPersistedProvider(observerPubkey: string): Nip85ProviderRef | null {
    try {
      const raw = localStorage.getItem(persistedProviderKey(observerPubkey));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<Nip85ProviderRef>;
      const servicePubkey = parsed.servicePubkey?.trim().toLowerCase();
      const relayUrl = parsed.relayUrl?.trim();
      const metric = parsed.metric?.trim();
      if (!servicePubkey || !isValidPubkey(servicePubkey) || !relayUrl) return null;
      const norm = normalizeWebSocketRelay(relayUrl) || relayUrl;
      if (!norm.startsWith('ws')) return null;
      return { metric: metric || '30382:rank', servicePubkey, relayUrl: norm };
    } catch {
      return null;
    }
  }

  function writePersistedProvider(observerPubkey: string, provider: Nip85ProviderRef): void {
    try {
      localStorage.setItem(
        persistedProviderKey(observerPubkey),
        JSON.stringify({
          metric: provider.metric,
          servicePubkey: provider.servicePubkey,
          relayUrl: provider.relayUrl
        })
      );
    } catch {
      /* quota */
    }
  }

  function applyResolvedProvider(
    provider: Nip85ProviderRef | null,
    source: TrustedAssertionsSource,
    observerPubkey: string,
    opts?: { persist?: boolean }
  ): void {
    const prevService = providerState.provider?.servicePubkey;
    const prevRelay = providerState.provider?.relayUrl;
    const nextService = provider?.servicePubkey;
    if (
      (prevService && nextService && prevService !== nextService) ||
      (prevRelay &&
        provider?.relayUrl &&
        (normalizeWebSocketRelay(prevRelay) || prevRelay) !==
          (normalizeWebSocketRelay(provider.relayUrl) || provider.relayUrl))
    ) {
      memoryScores.clear();
      scoreVersion += 1;
    }
    const changed = setProviderState({
      source,
      observerPubkey,
      provider,
      isPersonalized: source === 'viewer',
      grapevineReady: true
    });
    if (provider) {
      if (opts?.persist !== false) writePersistedProvider(observerPubkey, provider);
      if (changed && pendingSubjects.size > 0) requestScores([...pendingSubjects]);
    }
  }

  function readCachedProvider(viewer: string | null): {
    provider: Nip85ProviderRef | null;
    source: TrustedAssertionsSource;
    observerPubkey: string;
  } {
    let provider: Nip85ProviderRef | null = null;
    let source: TrustedAssertionsSource = 'none';
    let observerPubkey = GRAPEVINE_FALLBACK_OBSERVER_PUBKEY;

    if (viewer && isValidPubkey(viewer)) {
      const persistedViewer = readPersistedProvider(viewer);
      if (persistedViewer) {
        provider = persistedViewer;
        source = 'viewer';
        observerPubkey = viewer;
      }
    }
    if (!provider) {
      const persistedFallback = readPersistedProvider(GRAPEVINE_FALLBACK_OBSERVER_PUBKEY);
      if (persistedFallback) {
        provider = persistedFallback;
        source = 'fallback';
        observerPubkey = GRAPEVINE_FALLBACK_OBSERVER_PUBKEY;
      }
    }
    if (
      !provider &&
      providerState.provider &&
      providerState.source !== 'builtin' &&
      providerState.source !== 'none'
    ) {
      provider = providerState.provider;
      source = providerState.source;
      observerPubkey = providerState.observerPubkey;
    }
    return { provider, source, observerPubkey };
  }

  async function fetchKind10040(pubkey: string): Promise<Event | null> {
    const filter: Filter = {
      kinds: [KIND.NIP85_PREFS],
      authors: [pubkey],
      limit: 1
    };
    try {
      const events = await relayPool.query([...PROFILE_RELAYS], [filter], KIND_10040_TIMEOUT_MS);
      const best = events
        .filter((e) => e.kind === KIND.NIP85_PREFS && e.pubkey.toLowerCase() === pubkey)
        .sort((a, b) => b.created_at - a.created_at)[0];
      return best ?? null;
    } catch {
      return null;
    }
  }

  async function resolveProviderInner(
    viewer: string | null,
    opts?: { allowNetwork?: boolean }
  ): Promise<TrustedAssertionsProviderState> {
    const cached = readCachedProvider(viewer);

    if (opts?.allowNetwork === false) {
      if (cached.provider) {
        applyResolvedProvider(cached.provider, cached.source, cached.observerPubkey);
        return providerState;
      }
      applyResolvedProvider(communityFallbackProvider(), 'builtin', cached.observerPubkey, {
        persist: false
      });
      return providerState;
    }

    if (viewer && isValidPubkey(viewer)) {
      const viewer10040 = await fetchKind10040(viewer);
      const parsed = parseNip85ProviderFrom10040(viewer10040);
      if (parsed) {
        applyResolvedProvider(parsed, 'viewer', viewer);
        return providerState;
      }
    }

    if (viewer !== GRAPEVINE_FALLBACK_OBSERVER_PUBKEY) {
      const fallback10040 = await fetchKind10040(GRAPEVINE_FALLBACK_OBSERVER_PUBKEY);
      const parsedFallback = parseNip85ProviderFrom10040(fallback10040);
      if (parsedFallback) {
        applyResolvedProvider(parsedFallback, 'fallback', GRAPEVINE_FALLBACK_OBSERVER_PUBKEY);
        return providerState;
      }
    }

    if (cached.provider) {
      applyResolvedProvider(cached.provider, cached.source, cached.observerPubkey);
      return providerState;
    }

    applyResolvedProvider(communityFallbackProvider(), 'builtin', cached.observerPubkey, {
      persist: false
    });
    return providerState;
  }

  async function resolveProvider(
    viewerPubkey?: string | null,
    opts?: { allowNetwork?: boolean }
  ): Promise<TrustedAssertionsProviderState> {
    const viewer = viewerPubkey?.trim().toLowerCase() || null;
    const cacheKey = viewer ?? 'anon';
    const allowNetwork = opts?.allowNetwork !== false;

    if (!allowNetwork) {
      return resolveProviderInner(viewer, { allowNetwork: false });
    }

    if (resolvedCacheKey === cacheKey && resolvePromise) return resolvePromise;
    if (resolveInFlightKey === cacheKey && resolvePromise) return resolvePromise;

    resolveInFlightKey = cacheKey;
    resolvePromise = resolveProviderInner(viewer, { allowNetwork: true })
      .then((state) => {
        resolvedCacheKey = cacheKey;
        return state;
      })
      .finally(() => {
        if (resolveInFlightKey === cacheKey) resolveInFlightKey = null;
      });
    return resolvePromise;
  }

  function reset(): void {
    memoryScores.clear();
    pendingSubjects.clear();
    if (coalesceTimer != null) {
      clearTimeout(coalesceTimer);
      coalesceTimer = null;
    }
    flushPromise = null;
    resolvePromise = null;
    resolvedCacheKey = null;
    resolveInFlightKey = null;
    scoreVersion += 1;
    setProviderState({
      source: 'none',
      observerPubkey: GRAPEVINE_FALLBACK_OBSERVER_PUBKEY,
      provider: null,
      isPersonalized: false,
      grapevineReady: false
    });
  }

  function resetForViewer(viewerPubkey?: string | null): void {
    const key = viewerPubkey?.trim().toLowerCase() || 'anon';
    if (resetViewerKey === key) return;
    if (resetViewerKey === 'anon' && key !== 'anon') {
      resolvedCacheKey = null;
      resolveInFlightKey = null;
      resetViewerKey = key;
      return;
    }
    reset();
    resetViewerKey = key;
  }

  function scoreRelayDialOrder(primary: string): string[] {
    const prod = (normalizeWebSocketRelay(GRAPEVINE_SCORES_RELAY_URL) || GRAPEVINE_SCORES_RELAY_URL).toLowerCase();
    const staging = GRAPEVINE_SCORES_STAGING_RELAY_URL;
    const primaryKey = (normalizeWebSocketRelay(primary) || primary).toLowerCase();
    const out: string[] = [];
    const add = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const key = (normalizeWebSocketRelay(trimmed) || trimmed).toLowerCase();
      if (out.some((u) => (normalizeWebSocketRelay(u) || u).toLowerCase() === key)) return;
      out.push(trimmed);
    };
    if (primaryKey === prod) {
      add(staging);
    } else {
      add(primary);
      add(staging);
    }
    return out;
  }

  function ingestScoreEvent(
    provider: Nip85ProviderRef,
    ev: Event,
    now: number
  ): TrustedAssertionScore | null {
    if (ev.pubkey.toLowerCase() !== provider.servicePubkey.toLowerCase()) return null;
    const score = parseTrustedAssertionScore(ev);
    if (!score) return null;
    const cacheKey = trustedAssertionCacheKey(provider.servicePubkey, score.subjectPubkey);
    const prev = memoryScores.get(cacheKey);
    const prevCreated = prev?.score?.event?.created_at ?? 0;
    if (prev?.score && prevCreated >= ev.created_at) return null;
    // Cap memory size (simple LRU-ish: delete oldest keys when over max).
    if (memoryScores.size >= SCORE_LRU_MAX && !memoryScores.has(cacheKey)) {
      const first = memoryScores.keys().next().value;
      if (first) memoryScores.delete(first);
    }
    memoryScores.set(cacheKey, { score, definiteMiss: false, updatedAt: now });
    return score;
  }

  async function fetchSubjectScores(
    provider: Nip85ProviderRef,
    subjects: readonly string[]
  ): Promise<number> {
    const relays = scoreRelayDialOrder(provider.relayUrl);
    if (relays.length === 0) return 0;
    const now = Date.now();
    let ingested = 0;
    for (let i = 0; i < subjects.length; i += SUBJECT_D_BATCH) {
      const batch = subjects.slice(i, i + SUBJECT_D_BATCH);
      const remaining = new Set(batch);
      for (const url of relays) {
        if (remaining.size === 0) break;
        const filter: Filter = {
          kinds: [KIND.NIP85_SCORE],
          authors: [provider.servicePubkey],
          '#d': [...remaining],
          limit: remaining.size
        };
        const events = await relayPool.query([url], [filter], SCORE_FETCH_TIMEOUT_MS);
        for (const ev of events) {
          const parsed = parseTrustedAssertionScore(ev);
          if (!parsed || !remaining.has(parsed.subjectPubkey)) continue;
          remaining.delete(parsed.subjectPubkey);
          if (ingestScoreEvent(provider, ev, now)) ingested += 1;
        }
      }
      for (const pk of remaining) {
        const key = trustedAssertionCacheKey(provider.servicePubkey, pk);
        if (memoryScores.get(key)?.score) continue;
        memoryScores.set(key, { score: null, definiteMiss: true, updatedAt: now });
      }
    }
    return ingested;
  }

  async function awaitProviderResolve(): Promise<void> {
    if (providerState.grapevineReady) return;
    const inFlight = resolvePromise;
    if (inFlight) {
      await Promise.race([inFlight, new Promise((r) => setTimeout(r, 500))]);
    }
  }

  async function requestScoresInner(pubkeys: readonly string[]): Promise<void> {
    await awaitProviderResolve();
    const active = providerState.provider;
    if (!active) {
      if (!providerState.grapevineReady) {
        for (const p of pubkeys) {
          const pk = p.trim().toLowerCase();
          if (isValidPubkey(pk)) pendingSubjects.add(pk);
        }
      }
      return;
    }

    const unique = [
      ...new Set(pubkeys.map((p) => p.trim().toLowerCase()).filter((p) => isValidPubkey(p)))
    ];
    if (unique.length === 0) return;

    const now = Date.now();
    const stillMissing = unique.filter((pk) => {
      const key = trustedAssertionCacheKey(active.servicePubkey, pk);
      const mem = memoryScores.get(key);
      if (mem?.score) return false;
      if (mem?.definiteMiss && now - mem.updatedAt < SCORE_MISS_TTL_MS) return false;
      return true;
    });

    let loaded = 0;
    if (stillMissing.length > 0) {
      loaded += await fetchSubjectScores(active, stillMissing);
    }
    if (loaded > 0) bumpScores();
  }

  async function flushPendingScores(): Promise<void> {
    if (flushPromise) {
      await flushPromise;
      if (pendingSubjects.size > 0 && providerState.provider) {
        return flushPendingScores();
      }
      return;
    }

    const subjects = [...pendingSubjects];
    pendingSubjects.clear();
    if (subjects.length === 0) return;

    flushPromise = requestScoresInner(subjects).finally(() => {
      flushPromise = null;
    });
    await flushPromise;
    if (pendingSubjects.size > 0 && providerState.provider) {
      await flushPendingScores();
    }
  }

  function requestScores(pubkeys: readonly string[]): void {
    for (const p of pubkeys) {
      const pk = p.trim().toLowerCase();
      if (isValidPubkey(pk)) pendingSubjects.add(pk);
    }
    if (pendingSubjects.size === 0) return;
    if (coalesceTimer != null) return;
    coalesceTimer = setTimeout(() => {
      coalesceTimer = null;
      void flushPendingScores();
    }, REQUEST_COALESCE_MS);
  }

  /** Await coalesced score hydrate (for search finish). */
  async function requestScoresAndWait(pubkeys: readonly string[]): Promise<void> {
    requestScores(pubkeys);
    if (coalesceTimer != null) {
      clearTimeout(coalesceTimer);
      coalesceTimer = null;
    }
    await flushPendingScores();
  }

  function getScore(pubkey: string): TrustedAssertionScore | null {
    const pk = pubkey.trim().toLowerCase();
    if (!pk || !isValidPubkey(pk)) return null;
    const provider = providerState.provider;
    if (!provider) return null;
    const key = trustedAssertionCacheKey(provider.servicePubkey, pk);
    return memoryScores.get(key)?.score ?? null;
  }

  // Boot with builtin so anonymous Brainstorm search has an observer immediately.
  applyResolvedProvider(communityFallbackProvider(), 'builtin', GRAPEVINE_FALLBACK_OBSERVER_PUBKEY, {
    persist: false
  });

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getProviderState: () => providerState,
    getScoreVersion: () => scoreVersion,
    getScore,
    resolveProvider,
    resetForViewer,
    requestScores,
    requestScoresAndWait
  };
}

export const trustedAssertions = createTrustedAssertions();
