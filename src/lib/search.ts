import { DOCUMENT_SEARCH_RELAYS, KIND, NIP32_READ_LABEL, SOCIAL_RELAYS } from './constants';
import { isReadLabelSlug } from './nip32';
import { countReadPublications } from './read-marks';
import { fetchBrainstormNip50Events } from './brainstorm-search';
import { dTagVariants, normalizeDTag } from './dtag';
import { filterDeletedEvents, refreshDeletionsFor } from './deletions';
import { filterRenderableCatalogEvents } from './catalog-visibility';
import { ensureMetadata } from './ensure-metadata';
import { lookupNip05Pubkey, splitNip05Identifier } from './nip05';
import { cacheGetSearchSnapshot, cachePutMany, cachePutSearchSnapshot, cacheScanText, searchSnapshotFresh, searchSnapshotMatchesViewer } from './nostr/cache';
import { rememberEvents } from './nostr/event-memory';
import { mercuryFilter, mercuryPublicationSearch, mercurySectionSearch, mercuryWikiSearch, mercurySuggest, MERCURY_DOCUMENT_KINDS } from './nostr/mercury';
import { relayPool } from './nostr/pool';
import { relayTagSlug } from './nostr/relay-filters';
import { documentStack, foreignRelaysAllowed, gitcitadelReadsAllowed, socialStack } from './nostr/selector';
import {
  ADVANCED_SEARCH_MAX_RELAYS,
  advancedSearchCacheKey,
  buildMercurySearchBody,
  clampAdvancedLimit,
  filterHasQueryKeys,
  mercuryHasQuery,
  normalizeAdvancedFilter,
  normalizeMercuryTarget,
  normalizeRelayList,
  defaultAdvancedSearchRelays,
  type AdvancedSearchRequest
} from './advanced-search';
import {
  shouldHideEventByGrapevine,
  type GrapevineTrustContext
} from './grapevine-rank';
import { hasKnownRank } from './nip85-trusted-assertions';
import { parseEventCoordinate } from './library-scope';
import { hexPubkey, npubFromInput, preferRicherEvent, publicationSectionCount, sortSearchResults } from './metadata';
import { followPubkeysFromMetadata, muteState } from './mute';
import { ensureFollowsOfFollows, getFollowsOfFollowsSet } from './follows-of-follows';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { isTopLevel30040, eventAddress } from './nostr/verify';
import {
  MAX_BOOKSHELF_DIRECTORY_ITEMS,
  MY_BOOK_COLLECTION_D_TAG,
  publicationTargetsFromDirectory,
  publicationsNotInDirectory
} from './bookshelf';
import { authorOutbox, withPreferredRelays } from './nostr/mailboxes';
import { fetchByAddress, fetchByAddresses, fetchByIds } from './nostr/fetch';
import {
  fetchFollowReadingQueues,
  groupFollowsReadingByPublication
} from './follows-reading';
import { parseReadingQueue, readingQueueFromMetadata } from './reading-queue';
import { localReadingQueue } from './stores/local-reading-queue';
import { readingPrefs } from './stores/reading-prefs';
import { SessionTtlCache } from './session-ttl-cache';
import { get } from 'svelte/store';
import { session } from './stores/session';
import { trust } from './stores/trust';
import { trustedAssertions } from './trusted-assertions';
import { resolveWikiAliasArticles } from './wiki-redirect';
import { nip19, type Event, type Filter } from 'nostr-tools';

export type SearchResult = {
  events: Event[];
  loading: boolean;
  done: boolean;
};

const HEX64 = /^[0-9a-f]{64}$/i;

/** Brainstorm NIP-50 — all kinds; extensions only on that host. */
function brainstormSearch(query: string, limit = 80): Promise<Event[]> {
  return fetchBrainstormNip50Events({ query, limit });
}

function stripNostr(s: string): string {
  return s.trim().replace(/^nostr:/i, '');
}

export function normalizeSearchKey(input: string): string {
  return input.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

function mergeById(events: Event[]): Event[] {
  const byId = new Map<string, Event>();
  for (const event of events) {
    const prev = byId.get(event.id);
    byId.set(event.id, prev ? preferRicherEvent(prev, event) : event);
  }
  return pruneToLatestReplaceables([...byId.values()]);
}

export function identifierHints(query: string): string[] {
  const q = query.trim();
  const out: string[] = [];
  const ebook = q.match(/gutenberg\.org\/(?:ebooks|files)\/(\d+)/i);
  const colon = q.match(/^gutenberg:(\d+)/i);
  const pg = q.match(/^pg(\d+)$/i);
  const id = ebook?.[1] ?? colon?.[1] ?? pg?.[1];
  if (id) {
    out.push(`gutenberg:${id}`, id, `pg${id}`);
  } else if (/^\d{1,6}$/.test(q)) {
    out.push(q, `gutenberg:${q}`, `pg${q}`);
  }
  if (/^https?:\/\//i.test(q)) out.push(q);
  return [...new Set(out)];
}

function sectionCount(event: Event): number {
  return publicationSectionCount(event);
}

export function preferTopLevelPublications(events: Event[]): Event[] {
  const pubs = events.filter((e) => e.kind === KIND.PUBLICATION);
  const hasTop = pubs.some((e) => isTopLevel30040(e, pubs));
  if (!hasTop) return events;
  return events.filter((e) => e.kind !== KIND.PUBLICATION || isTopLevel30040(e, pubs));
}

function grapevineContext(): GrapevineTrustContext {
  const snap = trust.snapshot();
  const viewerPubkey = session.getPubkey();
  const followPubkeySet = followPubkeysFromMetadata(session.getMetadata());
  return {
    trustFilterEnabled: snap.enabled,
    rankCutoff: snap.rankMin,
    viewerPubkey,
    followPubkeySet,
    followsOfFollowsSet: getFollowsOfFollowsSet(viewerPubkey),
    getScore: (pk) => trustedAssertions.getScore(pk)
  };
}

function rankEvents(
  events: Event[],
  grapevine?: GrapevineTrustContext | null,
  opts?: { exactD?: string }
): Event[] {
  const counts = new Map(events.map((e) => [e.id, sectionCount(e)]));
  return sortSearchResults(preferTopLevelPublications(events), counts, grapevine, opts);
}

function preferLive(live: Event[], cached: Event[]): Event[] {
  return live.length ? live : cached;
}

/** Kind-0 profiles have no d-tag, so the catalog filter would drop them after they paint. */
function profilePins(events: Event[]): Event[] {
  const byPubkey = new Map<string, Event>();
  for (const event of events) {
    if (event?.kind !== KIND.METADATA || !event.id || !event.pubkey) continue;
    const pk = event.pubkey.toLowerCase();
    const prev = byPubkey.get(pk);
    if (!prev || event.created_at >= prev.created_at) byPubkey.set(pk, event);
  }
  return [...byPubkey.values()];
}

/** Kind-0 events whose content or tags contain the query (about text, NIP-05, name). */
export function profilesMatchingQuery(events: Event[], query: string): Event[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return events.filter((event) => {
    if (event.kind !== KIND.METADATA) return false;
    const hay = `${event.content}\n${event.tags.map((tag) => tag.join('\t')).join('\n')}`.toLowerCase();
    return hay.includes(needle);
  });
}

/**
 * Catalog cards plus matching profiles, in search kind order
 * (library, spec, wiki, profile, article, then the rest).
 */
export function composeSearchResults(events: Event[], pins: Event[] = []): Event[] {
  const kept = pruneToLatestReplaceables(filterDeletedEvents(events));
  const catalog = filterRenderableCatalogEvents(kept);
  const pinned = profilePins(pins);
  const pinIds = new Set(pinned.map((event) => event.id));
  const merged = [...pinned, ...catalog.filter((event) => !pinIds.has(event.id))];
  const counts = new Map(merged.map((event) => [event.id, publicationSectionCount(event)]));
  return sortSearchResults(merged, counts);
}

async function resolveProfileForNip05(query: string): Promise<Event | null> {
  if (!splitNip05Identifier(query)) return null;
  const pubkey = await lookupNip05Pubkey(query);
  if (!pubkey) return null;
  return ensureMetadata(pubkey);
}

async function finishWithGrapevine(
  key: string,
  live: Event[],
  cached: Event[],
  onUpdate: (r: SearchResult) => void,
  opts?: { exactD?: string; pins?: Event[] }
): Promise<Event[]> {
  const merged = preferLive(live, cached);
  try {
    await refreshDeletionsFor(merged);
  } catch {
    /* deletions optional */
  }
  const visible = filterRenderableCatalogEvents(filterDeletedEvents(merged));
  const authors = [...new Set(visible.map((e) => e.pubkey))];
  try {
    await trustedAssertions.resolveProvider(session.getPubkey());
    await trustedAssertions.requestScoresAndWait(authors);
  } catch {
    /* scores optional */
  }
  try {
    const follows = followPubkeysFromMetadata(session.getMetadata());
    await ensureFollowsOfFollows(session.getPubkey(), follows);
  } catch {
    /* FoF optional */
  }
  const ctx = grapevineContext();
  let events = rankEvents(visible, ctx, opts);
  // Deny-by-default only when at least one author score hydrated — otherwise a
  // dead scores relay would wipe Mercury / cache hits for anonymous visitors.
  const anyKnown = authors.some((pk) => hasKnownRank(trustedAssertions.getScore(pk)));
  if (ctx.trustFilterEnabled && anyKnown) {
    events = events.filter((e) => !shouldHideEventByGrapevine(e, ctx));
  }
  events = composeSearchResults(events.slice(0, 100), opts?.pins ?? []).slice(0, 100);
  rememberEvents(events);
  void cachePutSearchSnapshot(key, events, session.getPubkey());
  void cachePutMany(events);
  onUpdate({ events, loading: false, done: true });
  return events;
}

export function isNsec(input: string): boolean {
  try {
    return nip19.decode(stripNostr(input)).type === 'nsec';
  } catch {
    return false;
  }
}

/** note / nevent / naddr / 64-hex / `kind:pubkey[:d]`. Lookups, not catalog text search. */
export function exactEventQuery(
  query: string
): 'hex' | 'note' | 'nevent' | 'naddr' | 'coord' | null {
  const q = stripNostr(query);
  if (HEX64.test(q)) return 'hex';
  if (parseEventCoordinate(q)) return 'coord';
  try {
    const decoded = nip19.decode(q);
    if (decoded.type === 'note' || decoded.type === 'nevent' || decoded.type === 'naddr') return decoded.type;
  } catch {
    return null;
  }
  return null;
}

async function paintCached(
  key: string,
  onUpdate: (r: SearchResult) => void
): Promise<{ events: Event[]; fresh: boolean }> {
  const viewer = session.getPubkey()?.toLowerCase() ?? null;
  const snap = await cacheGetSearchSnapshot(key);
  // Never paint another identity's grapevine/follows-scoped results.
  if (!searchSnapshotMatchesViewer(snap, viewer)) {
    onUpdate({ events: [], loading: true, done: false });
    return { events: [], fresh: false };
  }
  const raw = filterDeletedEvents(snap?.events ?? []);
  const cached = composeSearchResults(
    raw,
    raw.filter((event) => event.kind === KIND.METADATA)
  );
  const fresh = searchSnapshotFresh(snap, undefined, viewer);
  rememberEvents(cached);
  onUpdate({ events: cached, loading: !fresh, done: fresh });
  return { events: cached, fresh };
}

/** Paint from cache; fetch live only when the snapshot is missing or stale. */
async function cachedOrLive(
  key: string,
  onUpdate: (r: SearchResult) => void,
  live: () => Promise<Event[]>,
  opts?: { exactD?: string }
): Promise<void> {
  const { events: cached, fresh } = await paintCached(key, onUpdate);
  if (fresh) return;
  void trustedAssertions.resolveProvider(session.getPubkey());
  await finishWithGrapevine(key, await live(), cached, onUpdate, opts);
}

export async function runSearch(query: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const q = stripNostr(query);

  if (isNsec(q)) {
    onUpdate({ events: [], loading: false, done: true });
    return;
  }

  const exact = exactEventQuery(q);
  if (exact) {
    onUpdate({ events: [], loading: true, done: false });
    try {
      let live: Event[] = [];
      if (exact === 'hex') live = await fetchByIdOrAuthor(q);
      else if (exact === 'coord') live = await fetchCoordinate(q);
      else live = await fetchBech32(nip19.decode(q));
      const events = filterDeletedEvents(live);
      rememberEvents(events);
      void cachePutMany(events);
      onUpdate({ events, loading: false, done: true });
    } catch {
      onUpdate({ events: [], loading: false, done: true });
    }
    return;
  }

  // q2: older q: snapshots dropped matching profiles after they had already painted.
  const key = `q2:${normalizeSearchKey(q)}`;
  const { events: cached, fresh } = await paintCached(key, onUpdate);

  const profileNpub = npubFromInput(q);
  if (profileNpub) {
    onUpdate({ events: cached, loading: false, done: true });
    return;
  }

  if (splitNip05Identifier(q)) {
    if (fresh && cached.some((event) => event.kind === KIND.METADATA)) return;
    if (fresh) {
      const profile = await resolveProfileForNip05(q);
      if (profile) {
        const events = composeSearchResults(cached, [profile]);
        rememberEvents(events);
        void cachePutSearchSnapshot(key, events, session.getPubkey());
        void cachePutMany([profile]);
        onUpdate({ events, loading: false, done: true });
      }
      return;
    }
  }

  if (fresh) return;

  await fanOutSearch(q, key, cached, onUpdate);
}

async function fetchByIdOrAuthor(hex: string): Promise<Event[]> {
  const id = hex.toLowerCase();
  const docKinds = [...MERCURY_DOCUMENT_KINDS];
  const idFilter: Filter = { ids: [id], limit: 100 };
  const authorFilter: Filter = { authors: [id], limit: 100 };
  const [m1, m2, w1, w2, s1, s2] = await Promise.all([
    mercuryFilter({ ...idFilter, kinds: docKinds }),
    mercuryFilter({ ...authorFilter, kinds: docKinds }),
    relayPool.query(documentStack(), [idFilter], 8000, 4, undefined, {
      priority: true,
      includeCooling: true
    }),
    relayPool.query(documentStack(), [authorFilter], 8000, 4, undefined, {
      priority: true,
      includeCooling: true
    }),
    relayPool.query(socialStack(), [idFilter], 8000, 4, undefined, {
      priority: true,
      includeCooling: true
    }),
    relayPool.query(socialStack(), [authorFilter], 8000, 4, undefined, {
      priority: true,
      includeCooling: true
    })
  ]);
  const byId = new Map<string, Event>();
  for (const e of [...m1, ...m2, ...w1, ...w2, ...s1, ...s2]) byId.set(e.id, e);
  const events = pruneToLatestReplaceables([...byId.values()]);
  await cachePutMany(events);
  return events;
}

async function fetchCoordinate(raw: string): Promise<Event[]> {
  const parsed = parseEventCoordinate(stripNostr(raw));
  if (!parsed) return [];
  const coord = parsed.d
    ? `${parsed.kind}:${parsed.pubkey}:${parsed.d}`
    : `${parsed.kind}:${parsed.pubkey}`;
  const hit = await fetchByAddress(coord);
  return hit ? [hit] : [];
}

async function fetchBech32(
  decoded: ReturnType<typeof nip19.decode>
): Promise<Event[]> {
  if (decoded.type === 'note' || decoded.type === 'nevent') {
    const id = decoded.type === 'note' ? decoded.data : decoded.data.id;
    const author = decoded.type === 'nevent' ? decoded.data.author : undefined;
    const hints = decoded.type === 'nevent' ? decoded.data.relays : undefined;
    if (hints?.length || author) {
      const { fetchById } = await import('./nostr/fetch');
      const hit = await fetchById(id, { hintRelays: hints, authorPubkey: author });
      return hit ? [hit] : fetchByIdOrAuthor(id);
    }
    return fetchByIdOrAuthor(id);
  }
  if (decoded.type === 'naddr') {
    const { kind, pubkey, identifier, relays } = decoded.data;
    const hit = await fetchByAddress(`${kind}:${pubkey}:${identifier}`, {
      hintRelays: relays
    });
    return hit ? [hit] : [];
  }
  return [];
}

async function fanOutSearch(
  q: string,
  key: string,
  cached: Event[],
  onUpdate: (r: SearchResult) => void
): Promise<void> {
  const byId = new Map<string, Event>();
  for (const event of cached) byId.set(event.id, event);
  const dTags = dTagVariants(q);
  const relays = documentStack();

  const tagSlug = relayTagSlug(q);
  const dFilter = dTags.length
    ? {
        kinds: [KIND.PUBLICATION, KIND.SECTION, KIND.WIKI, KIND.SPEC, KIND.LONG_FORM],
        '#d': dTags.slice(0, 12),
        limit: 100
      }
    : null;

  // Ensure community / viewer provider is ready so Brainstorm gets the right observer.
  void trustedAssertions.resolveProvider(session.getPubkey());

  const hints = identifierHints(q);
  const tasks = [
    mercuryPublicationSearch({ q, limit: 100 }),
    mercuryPublicationSearch({ d: dTags[0], limit: 100 }),
    mercuryPublicationSearch({ title: q, limit: 100 }),
    mercuryPublicationSearch({ author: q, limit: 100 }),
    mercuryPublicationSearch({ language: q, limit: 100 }),
    mercuryPublicationSearch({ subject: q, limit: 100 }),
    ...hints.flatMap((id) => [
      mercuryPublicationSearch({ identifier: id, limit: 100 }),
      mercuryPublicationSearch({ s: id, limit: 100 })
    ]),
    mercurySectionSearch({ q, limit: 100 }),
    mercuryWikiSearch({ q, limit: 100 }),
    resolveWikiAliasArticles(q, 100).then((r) => r.targets),
    cacheScanText(q),
    brainstormSearch(q),
    ...(dFilter
      ? [
          relayPool.query(relays, [dFilter], 8000, 4, undefined, {
            priority: true,
            includeCooling: true
          })
        ]
      : []),
    relayPool.query(
      relays,
      [
        {
          kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC, KIND.LONG_FORM],
          '#T': [tagSlug],
          limit: 100
        }
      ],
      8000,
      4,
      undefined,
      { priority: true, includeCooling: true }
    ),
    relayPool.query(
      relays,
      [
        {
          kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC, KIND.LONG_FORM],
          '#N': [tagSlug],
          limit: 100
        }
      ],
      8000,
      4,
      undefined,
      { priority: true, includeCooling: true }
    ),
    ...(dTags.length
      ? [mercuryFilter({ kinds: [KIND.LONG_FORM], '#d': dTags.slice(0, 12), limit: 100 })]
      : []),
    mercuryFilter({ kinds: [KIND.LONG_FORM], '#T': [tagSlug], limit: 100 }),
    mercuryFilter({ kinds: [KIND.LONG_FORM], '#N': [tagSlug], limit: 100 })
  ];

  const merge = (batch: Event[]) => {
    for (const e of batch) {
      const prev = byId.get(e.id);
      byId.set(e.id, prev ? preferRicherEvent(prev, e) : e);
    }
    const events = rankEvents(
      filterDeletedEvents(pruneToLatestReplaceables([...byId.values()])),
      grapevineContext()
    );
    onUpdate({ events: events.slice(0, 100), loading: true, done: false });
  };

  const profilePromise = resolveProfileForNip05(q);

  await Promise.all(
    tasks.map((t) =>
      t.then((events) => {
        merge(events);
        return events;
      })
    )
  );

  const profile = await profilePromise;
  if (profile) merge([profile]);
  const pins = profilePins([
    ...(profile ? [profile] : []),
    ...profilesMatchingQuery([...byId.values()], q)
  ]);

  await finishWithGrapevine(key, [...byId.values()], cached, onUpdate, { pins });
}

export async function runAuthorSearch(author: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `author:${normalizeSearchKey(author)}`;
  const slug = relayTagSlug(author);
  await cachedOrLive(key, onUpdate, async () => {
    const batches = await Promise.all([
      mercuryPublicationSearch({ author, limit: 100 }),
      author.trim().length >= 2
        ? mercuryWikiSearch({ q: author, limit: 100 })
        : Promise.resolve([] as Event[]),
      relayPool.query(
        documentStack(),
        [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC, KIND.LONG_FORM], '#N': [slug], limit: 100 }],
        8000,
        4,
        undefined,
        { priority: true, includeCooling: true }
      ),
      mercuryFilter({ kinds: [KIND.LONG_FORM], '#N': [slug], limit: 100 }),
      brainstormSearch(author)
    ]);
    return mergeById(batches.flat());
  });
}

export async function runTitleSearch(title: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `title:${normalizeSearchKey(title)}`;
  const slug = relayTagSlug(title);
  await cachedOrLive(key, onUpdate, async () => {
    const batches = await Promise.all([
      mercuryPublicationSearch({ title, limit: 100 }),
      title.trim().length >= 2
        ? mercuryWikiSearch({ q: title, title, limit: 100 })
        : Promise.resolve([] as Event[]),
      resolveWikiAliasArticles(title, 100).then((r) => r.targets),
      relayPool.query(
        documentStack(),
        [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC, KIND.LONG_FORM], '#T': [slug], limit: 100 }],
        8000,
        4,
        undefined,
        { priority: true, includeCooling: true }
      ),
      mercuryFilter({ kinds: [KIND.LONG_FORM], '#T': [slug], limit: 100 }),
      brainstormSearch(title)
    ]);
    return mergeById(batches.flat());
  });
}

export async function runIdentifierSearch(identifier: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `identifier:${normalizeSearchKey(identifier)}`;
  const hints = identifierHints(identifier);
  const ids = hints.length ? hints : [identifier];
  await cachedOrLive(key, onUpdate, async () => {
    const batches = await Promise.all([
      ...ids.flatMap((id) => [
        mercuryPublicationSearch({ identifier: id, limit: 100 }),
        mercuryPublicationSearch({ i: id, limit: 100 }),
        mercuryPublicationSearch({ s: id, limit: 100 }),
        id.trim().length >= 2
          ? mercuryWikiSearch({ q: id, i: id, limit: 100 })
          : Promise.resolve([] as Event[]),
        id.trim().length >= 2
          ? mercuryWikiSearch({ q: id, s: id, limit: 100 })
          : Promise.resolve([] as Event[])
      ]),
      resolveWikiAliasArticles(identifier, 100).then((r) => r.targets),
      brainstormSearch(identifier)
    ]);
    return mergeById(batches.flat());
  });
}

export async function runLanguageSearch(language: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `language:${normalizeSearchKey(language)}`;
  await cachedOrLive(key, onUpdate, async () => {
    const [mercury, brainstorm] = await Promise.all([
      mercuryPublicationSearch({ language, limit: 100 }),
      brainstormSearch(language)
    ]);
    return mergeById([...mercury, ...brainstorm]);
  });
}

export async function runSubjectSearch(subject: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `subject:${normalizeSearchKey(subject)}`;
  await cachedOrLive(key, onUpdate, async () => {
    const [subjects, aliases, brainstorm] = await Promise.all([
      searchBySubject(subject),
      resolveWikiAliasArticles(subject, 100).then((r) => r.targets),
      brainstormSearch(subject)
    ]);
    return mergeById([...subjects, ...aliases, ...brainstorm]);
  });
}

/** Specs (30817) and wikis (30818) that declare this event kind via a `k` tag. Specs first. */
export async function runKindTagSearch(kind: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const raw = kind.trim();
  const key = `k2:${normalizeSearchKey(raw)}`;
  if (!/^\d+$/.test(raw)) {
    await cachedOrLive(key, onUpdate, async () => []);
    return;
  }
  await cachedOrLive(key, onUpdate, () => searchByKindTag(raw));
}

export async function searchByKindTag(kind: string): Promise<Event[]> {
  const value = kind.trim();
  if (!/^\d+$/.test(value)) return [];
  const filter: Filter = { kinds: [KIND.SPEC, KIND.WIKI], '#k': [value], limit: 100 };
  const [mercury, relays] = await Promise.all([
    mercuryFilter(filter),
    relayPool.query(documentStack(), [filter], 8000, 4, undefined, {
      priority: true,
      includeCooling: true
    })
  ]);
  // composeSearchResults / searchKindTier lists specs (30817) before wikis (30818).
  return mergeById([...mercury, ...relays]);
}

export async function runLabelSearch(label: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  if (isReadLabelSlug(label)) {
    onUpdate({ events: [], loading: false, done: true });
    return;
  }
  const key = `label:${normalizeSearchKey(label)}`;
  await cachedOrLive(key, onUpdate, async () => {
    const [labels, brainstorm] = await Promise.all([
      searchByLabel(label),
      brainstormSearch(`label:${label}`)
    ]);
    return mergeById([...labels, ...brainstorm]);
  });
}

/** Author-scoped books marked read — not a public label search. */
export async function runReadSearch(
  npubOrHex: string,
  onUpdate: (r: SearchResult) => void
): Promise<void> {
  const hex = hexPubkey(npubOrHex) ?? (HEX64.test(npubOrHex.trim()) ? npubOrHex.trim().toLowerCase() : '');
  const key = `read:${hex || normalizeSearchKey(npubOrHex)}`;
  if (!hex) {
    await cachedOrLive(key, onUpdate, async () => []);
    return;
  }
  await cachedOrLive(key, onUpdate, () => searchByReadAuthor(hex));
}

/**
 * Publications on one author's reading queue (kind 16374), in queue order.
 * Own profile + local-only uses the on-device queue.
 */
export async function searchByReadingQueue(pubkeyHex: string): Promise<Event[]> {
  const hex = pubkeyHex.toLowerCase();
  if (!HEX64.test(hex)) return [];

  const me = session.getPubkey()?.toLowerCase();
  const localOnly = Boolean(me && me === hex && get(readingPrefs).localOnly);
  let entries = localOnly
    ? get(localReadingQueue)
    : me && me === hex
      ? readingQueueFromMetadata(session.getMetadata())
      : [];

  if (!entries.length && !localOnly) {
    const queues = await relayPool.query(
      socialStack(),
      [{ kinds: [KIND.READING_QUEUE], authors: [hex], limit: 5 }],
      4000,
      3,
      undefined,
      { priority: true, includeCooling: true }
    );
    const newest = queues.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
    entries = parseReadingQueue(newest);
  }

  if (!entries.length) return [];
  const pubs = await fetchByAddresses(entries.map((e) => e.a).slice(0, 80));
  const byExact = new Map(pubs.map((e) => [eventAddress(e), e]));
  const ordered: Event[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const hit = byExact.get(entry.a);
    if (!hit || seen.has(hit.id)) continue;
    seen.add(hit.id);
    ordered.push(hit);
  }
  return ordered.filter((e) => e.kind === KIND.PUBLICATION);
}

/**
 * Publications on follows' active reading queues, ordered by how many follows are reading each.
 */
export async function searchByFollowsReadingQueue(): Promise<Event[]> {
  const follows = [...followPubkeysFromMetadata(session.getMetadata())];
  if (!follows.length) return [];
  const mutePubkeys = get(muteState).pubkeys;
  const concurrent = get(readingPrefs).concurrent;
  const queues = await fetchFollowReadingQueues(follows, mutePubkeys);
  const grouped = groupFollowsReadingByPublication(queues, {
    concurrent,
    excludePubkey: session.getPubkey()
  }).slice(0, 80);
  if (!grouped.length) return [];
  const pubs = await fetchByAddresses(grouped.map((g) => g.address));
  const byAddr = new Map(pubs.map((e) => [eventAddress(e), e]));
  const ordered: Event[] = [];
  const seen = new Set<string>();
  for (const g of grouped) {
    const hit = byAddr.get(g.address);
    if (!hit || hit.kind !== KIND.PUBLICATION || seen.has(hit.id)) continue;
    seen.add(hit.id);
    ordered.push(hit);
  }
  return ordered;
}

export async function runReadingQueueSearch(
  npubOrHex: string,
  onUpdate: (r: SearchResult) => void
): Promise<void> {
  const raw = npubOrHex.trim();
  if (raw.toLowerCase() === 'follows') {
    const viewer = session.getPubkey()?.toLowerCase() ?? 'anon';
    await cachedOrLive(`queue:follows:${viewer}`, onUpdate, () => searchByFollowsReadingQueue());
    return;
  }
  const hex = hexPubkey(raw) ?? (HEX64.test(raw) ? raw.toLowerCase() : '');
  const key = `queue:${hex || normalizeSearchKey(npubOrHex)}`;
  if (!hex) {
    await cachedOrLive(key, onUpdate, async () => []);
    return;
  }
  await cachedOrLive(key, onUpdate, () => searchByReadingQueue(hex));
}

const suggestTitlesCache = new SessionTtlCache<string[]>(90_000, 40);

export async function suggestTitles(q: string): Promise<string[]> {
  if (q.length < 2) return [];
  const key = `suggest:${q.trim().toLowerCase()}`;
  return suggestTitlesCache.getOrLoad(key, () => mercurySuggest(q));
}

export async function runDTagSearch(d: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const slug = normalizeDTag(d);
  const key = `d:${normalizeSearchKey(slug || d)}`;
  if (!slug) {
    await cachedOrLive(key, onUpdate, async () => []);
    return;
  }
  const variants = dTagVariants(d);
  const kinds = [KIND.PUBLICATION, KIND.SECTION, KIND.WIKI, KIND.SPEC, KIND.LONG_FORM, KIND.DIRECTORY];
  const filter: Filter = { kinds, '#d': variants.slice(0, 12), limit: 100 };
  await cachedOrLive(
    key,
    onUpdate,
    async () => {
      const batches = await Promise.all([
        mercuryPublicationSearch({ d: slug, limit: 100 }),
        slug.length >= 2
          ? mercuryWikiSearch({ q: slug, d: slug, limit: 100 })
          : Promise.resolve([] as Event[]),
        resolveWikiAliasArticles(slug || d, 100).then((r) => r.targets),
        relayPool.query(documentStack(), [filter], 8000, 4, undefined, {
          priority: true,
          includeCooling: true
        }),
        mercuryFilter(filter),
        brainstormSearch(slug)
      ]);
      return mergeById(batches.flat());
    },
    { exactD: slug }
  );
}

export async function searchByDTag(d: string): Promise<Event[]> {
  const slug = normalizeDTag(d);
  const filter: Filter = { kinds: [KIND.PUBLICATION], '#d': [slug], limit: 100 };
  const [m, w] = await Promise.all([
    mercuryFilter(filter),
    relayPool.query(documentStack(), [filter], 8000, 4, undefined, {
      priority: true,
      includeCooling: true
    })
  ]);
  const byId = new Map<string, Event>();
  for (const e of [...m, ...w]) byId.set(e.id, e);
  return pruneToLatestReplaceables([...byId.values()]);
}

export async function searchBySubject(t: string): Promise<Event[]> {
  const [pubs, tagged] = await Promise.all([
    mercuryPublicationSearch({ subject: t, limit: 100 }),
    mercuryFilter({ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC, KIND.LONG_FORM], '#t': [t], limit: 100 })
  ]);
  return mergeById([...pubs, ...tagged]);
}

export async function searchByLabel(l: string): Promise<Event[]> {
  if (isReadLabelSlug(l)) return [];
  const filter: Filter = { kinds: [KIND.LABEL], '#l': [l], limit: 100 };
  const events = await relayPool.query(socialStack(), [filter], 8000, 4, undefined, {
    priority: true,
    includeCooling: true
  });
  try {
    await refreshDeletionsFor(events);
  } catch {
    /* deletions optional */
  }
  return resolvePublicationsFromLabelEvents(filterDeletedEvents(events));
}

/** Publications one author marked with `l=read`. */
export async function searchByReadAuthor(pubkeyHex: string): Promise<Event[]> {
  const hex = pubkeyHex.toLowerCase();
  if (!HEX64.test(hex)) return [];
  const events = await relayPool.query(
    socialStack(),
    [{ kinds: [KIND.LABEL], authors: [hex], '#l': [NIP32_READ_LABEL], limit: 100 }],
    5000,
    4,
    undefined,
    { priority: true, includeCooling: true }
  );
  try {
    await refreshDeletionsFor(events);
  } catch {
    /* deletions optional */
  }
  return resolvePublicationsFromLabelEvents(filterDeletedEvents(events));
}

export async function countReadsByAuthor(pubkeyHex: string): Promise<number> {
  const hex = pubkeyHex.toLowerCase();
  if (!HEX64.test(hex)) return 0;
  const events = await relayPool.query(
    socialStack(),
    [{ kinds: [KIND.LABEL], authors: [hex], '#l': [NIP32_READ_LABEL], limit: 100 }],
    4000,
    2
  );
  try {
    await refreshDeletionsFor(events);
  } catch {
    /* deletions optional */
  }
  return countReadPublications(filterDeletedEvents(events));
}

async function resolvePublicationsFromLabelEvents(events: Event[]): Promise<Event[]> {
  const addresses = new Set<string>();
  const eventIds = new Set<string>();
  for (const label of events) {
    for (const tag of label.tags) {
      if (tag[0] === 'a' && tag[1]?.startsWith(`${KIND.PUBLICATION}:`)) {
        addresses.add(tag[1]);
      }
      if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
        eventIds.add(tag[1].toLowerCase());
      }
    }
  }
  const results = new Map<string, Event>();
  for (const coord of addresses) {
    const parts = coord.split(':');
    const pubkey = parts[1];
    const d = parts.slice(2).join(':');
    if (!pubkey || !d?.trim()) continue;
    const f: Filter = { kinds: [KIND.PUBLICATION], authors: [pubkey], '#d': [d], limit: 1 };
    const [m, w] = await Promise.all([mercuryFilter(f), relayPool.query(documentStack(), [f])]);
    const hit = m[0] ?? w[0];
    if (hit) results.set(hit.id, hit);
  }
  for (const id of eventIds) {
    const f: Filter = { ids: [id], kinds: [KIND.PUBLICATION], limit: 1 };
    const [m, w] = await Promise.all([mercuryFilter(f), relayPool.query(documentStack(), [f])]);
    const hit = m[0] ?? w[0];
    if (hit) results.set(hit.id, hit);
  }
  return pruneToLatestReplaceables([...results.values()]);
}

function bookshelfDirectoryAuthors(npubOrHex?: string): string[] {
  if (npubOrHex) {
    const hex = hexPubkey(npubOrHex);
    return hex ? [hex] : [];
  }
  const me = session.getPubkey();
  return me ? [me] : [];
}

/**
 * Hard library hosts for kind-30045 shelves. Must not depend on the viewer's
 * GitCitadel / Outboxes toggles — curated guides live here even when personal
 * stacks omit them. Never put flaky third-party outbox URLs (nostr21, sovbit)
 * ahead of these.
 */
function libraryBookshelfRelays(): string[] {
  return [
    ...SOCIAL_RELAYS.filter((u) => /theforest|thecitadel/i.test(u)),
    ...DOCUMENT_SEARCH_RELAYS.filter((u) => /thecitadel|theforest/i.test(u))
  ];
}

/** Newest matching kind-30045 for a bookshelf slug (optional author scope). */
export async function fetchBookshelfDirectory(
  d: string,
  npubOrHex?: string
): Promise<Event | null> {
  const slug = normalizeDTag(d) || d.trim();
  if (!slug) return null;
  const authors = bookshelfDirectoryAuthors(npubOrHex);
  const filter: Filter = {
    kinds: [KIND.DIRECTORY],
    '#d': [slug],
    limit: authors.length ? 5 : 20,
    ...(authors.length ? { authors } : {})
  };
  // Kind 30045 is not a Mercury document kind — documentStack alone often misses
  // shelves that live on social hosts (theforest) / curator outboxes.
  const library = libraryBookshelfRelays();
  const base = [...new Set([...library, ...socialStack(), ...documentStack()])];
  let outbox: string[] = [];
  const curator = authors[0];
  if (curator && foreignRelaysAllowed()) {
    try {
      // After library hosts — curator NIP-65 lists often lead with dead sockets.
      outbox = (await authorOutbox(curator))
        .filter((u) => !/nostr21|sovbit/i.test(u))
        .slice(0, 4);
    } catch {
      /* stay on library + stacks */
    }
  }
  const preferred = [...library, ...outbox];
  const scope = withPreferredRelays(base, preferred, 4, 6);
  const dirs = pruneToLatestReplaceables(
    mergeById(
      await relayPool.query(scope.relays, [filter], 12_000, Math.min(scope.maxRelays, 8), undefined, {
        // Shelves must still resolve when GitCitadel preset / Outboxes are off.
        bypassConstrain: true,
        includeCooling: true,
        priority: true
      })
    )
  ).filter((e) => e.kind === KIND.DIRECTORY);
  if (!dirs.length) return null;
  if (authors.length) {
    const want = authors[0]!.toLowerCase();
    return dirs.find((e) => e.pubkey.toLowerCase() === want) ?? dirs[0] ?? null;
  }
  return dirs[0] ?? null;
}

/** Resolve shelf members from an already-fetched 30045. */
export async function publicationsFromBookshelfDirectory(
  dir: Event | null | undefined
): Promise<Event[]> {
  if (!dir) return [];
  const t = publicationTargetsFromDirectory(dir);
  // a- and e-tag memberships share one directory budget (MAX_BOOKSHELF_DIRECTORY_ITEMS).
  // Fetch both up to that cap — a lower e-id slice would truncate valid shelves.
  const byAddr = await fetchByAddresses(
    [...t.addresses].slice(0, MAX_BOOKSHELF_DIRECTORY_ITEMS),
    6
  );
  const byId = await fetchByIds([...t.eventIds].slice(0, MAX_BOOKSHELF_DIRECTORY_ITEMS), 6);
  return preferTopLevelPublications(
    mergeById([
      ...byAddr.filter((e) => e.kind === KIND.PUBLICATION),
      ...byId.filter((e) => e.kind === KIND.PUBLICATION)
    ])
  );
}

/**
 * One directory fetch for both the catalog grid and Edit — avoids a second
 * lookup returning null while members already painted.
 */
export async function loadBookshelfCatalog(
  d: string,
  npubOrHex?: string
): Promise<{ directory: Event | null; events: Event[] }> {
  const directory = await fetchBookshelfDirectory(d, npubOrHex);
  const events = await publicationsFromBookshelfDirectory(directory);
  return { directory, events };
}

/** Explicit 30045 bookshelf lookup — no fan-out. Optional `npub` scopes to one author. */
export async function searchByBookshelf(d: string, npubOrHex?: string): Promise<Event[]> {
  const { events } = await loadBookshelfCatalog(d, npubOrHex);
  return events;
}

/** Own kind-30040 editions for the viewer (top-level only). */
export async function fetchAuthorPublications(pubkey: string): Promise<Event[]> {
  const hex = hexPubkey(pubkey)?.toLowerCase();
  if (!hex) return [];
  const batches = await Promise.all([
    relayPool.query(documentStack(), [
      { kinds: [KIND.PUBLICATION], authors: [hex], limit: 100 }
    ]),
    mercuryFilter({ kinds: [KIND.PUBLICATION], authors: [hex], limit: 100 }).catch(
      () => [] as Event[]
    )
  ]);
  return preferTopLevelPublications(
    mergeById(batches.flat()).filter(
      (e) => e.kind === KIND.PUBLICATION && e.pubkey.toLowerCase() === hex
    )
  );
}

/**
 * Own `my-book-collection` catalog: publications the curator authored that are not
 * already listed on that bookshelf.
 */
export async function fetchOwnPublishedNotOnBookshelf(
  directory: Event | null | undefined,
  authorPubkey: string
): Promise<Event[]> {
  const pubs = await fetchAuthorPublications(authorPubkey);
  return publicationsNotInDirectory(pubs, directory);
}

export function isOwnMyBookCollectionBookshelf(d: string): boolean {
  return normalizeDTag(d) === MY_BOOK_COLLECTION_D_TAG;
}

export async function runBookshelfSearch(
  d: string,
  onUpdate: (r: SearchResult) => void,
  npubOrHex?: string
): Promise<void> {
  const key = `bookshelf:${normalizeSearchKey(d)}:${npubOrHex ?? ''}`;
  await cachedOrLive(key, onUpdate, () => searchByBookshelf(d, npubOrHex));
}

function mercuryResultKinds(target: ReturnType<typeof normalizeMercuryTarget>): number[] {
  if (target === 'sections') return [KIND.SECTION];
  if (target === 'wiki') return [KIND.WIKI];
  return [KIND.PUBLICATION];
}

/**
 * Advanced `adv=` results are a raw NIP-01/Mercury dump — keep notes, highlights,
 * and other non-catalog kinds. Catalog search still uses {@link finishWithGrapevine}.
 */
async function finishAdvancedSearch(
  key: string,
  live: Event[],
  cached: Event[],
  onUpdate: (r: SearchResult) => void
): Promise<Event[]> {
  const merged = preferLive(live, cached);
  try {
    await refreshDeletionsFor(merged);
  } catch {
    /* deletions optional */
  }
  let events = pruneToLatestReplaceables(filterDeletedEvents(merged));
  events = [...events].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  events = events.slice(0, 100);
  const authors = [...new Set(events.map((e) => e.pubkey))];
  try {
    await trustedAssertions.resolveProvider(session.getPubkey());
    await trustedAssertions.requestScoresAndWait(authors);
  } catch {
    /* scores optional — Search resultScope still works once hydrated */
  }
  rememberEvents(events);
  void cachePutSearchSnapshot(key, events, session.getPubkey());
  void cachePutMany(events);
  onUpdate({ events, loading: false, done: true });
  return events;
}

async function liveAdvancedSearch(req: AdvancedSearchRequest): Promise<Event[]> {
  const filter = normalizeAdvancedFilter(req.filter);
  filter.limit = clampAdvancedLimit(filter.limit ?? 100);
  const hasFilter = filterHasQueryKeys(filter);
  const hasMercury = mercuryHasQuery(req.mercury);
  const mercuryOk = gitcitadelReadsAllowed();
  const mercuryOnly = hasMercury && !hasFilter;

  const batches: Promise<Event[]>[] = [];

  // Relays mode: NIP-01 REQ against the chosen relay list (honour every URL the form listed).
  if (hasFilter) {
    let relays = normalizeRelayList(req.relays);
    if (!relays.length) relays = defaultAdvancedSearchRelays(filter);
    batches.push(
      relayPool.query(
        relays,
        [filter],
        12_000,
        Math.min(Math.max(relays.length, 1), ADVANCED_SEARCH_MAX_RELAYS),
        undefined,
        { bypassConstrain: true, priority: true, includeCooling: true }
      )
    );
  }

  // Mercury mode: one typed endpoint (publications / sections / wiki), not a relay REQ.
  let mercuryTarget: ReturnType<typeof normalizeMercuryTarget> | null = null;
  if (mercuryOk && hasMercury && req.mercury) {
    const typed = buildMercurySearchBody(req.mercury, filter.limit);
    if (typed) {
      mercuryTarget = normalizeMercuryTarget(req.mercury.target);
      if (mercuryTarget === 'sections') batches.push(mercurySectionSearch(typed));
      else if (mercuryTarget === 'wiki') {
        batches.push(mercuryWikiSearch(typed));
        // Alias redirects (30819) for every wiki search field the user filled.
        const aliasQueries = [
          req.mercury.q,
          req.mercury.title,
          req.mercury.d,
          req.mercury.T,
          req.mercury.s,
          req.mercury.i
        ]
          .map((v) => v?.trim())
          .filter((v): v is string => !!v);
        for (const aq of [...new Set(aliasQueries)]) {
          batches.push(resolveWikiAliasArticles(aq, filter.limit).then((r) => r.targets));
        }
      } else batches.push(mercuryPublicationSearch(typed));
    }
  }

  // Cache scan + generic wiki-alias fan-out are for relays / free-text only.
  // Mixing them into Mercury typed searches leaks prior section/pub hits across endpoints.
  if (!mercuryOnly) {
    // Prefer NIP-50 search; if only Mercury `q` was filled (combined mode), still cache-scan it.
    const qText = filter.search?.trim() || (hasMercury ? req.mercury?.q?.trim() : '');
    if (qText) {
      batches.push(cacheScanText(qText, filter.limit));
      batches.push(resolveWikiAliasArticles(qText, filter.limit).then((r) => r.targets));
    }
    const dTags = filter['#d'];
    if (dTags?.length) {
      for (const d of dTags.slice(0, 6)) {
        if (d?.trim()) {
          batches.push(resolveWikiAliasArticles(d.trim(), filter.limit).then((r) => r.targets));
        }
      }
    }
  }

  if (!batches.length) return [];
  const settled = await Promise.all(batches);
  let hits = mergeById(settled.flat());
  if (mercuryOnly && mercuryTarget) {
    const kinds = new Set(mercuryResultKinds(mercuryTarget));
    hits = hits.filter((e) => kinds.has(e.kind));
  }
  return hits;
}

/** NIP-01 (+ Mercury typed) advanced search from a shareable `adv=` payload. */
export async function runAdvancedSearch(
  req: AdvancedSearchRequest,
  onUpdate: (r: SearchResult) => void
): Promise<void> {
  const filter = normalizeAdvancedFilter(req.filter);
  filter.limit = clampAdvancedLimit(filter.limit ?? 100);
  let relays = normalizeRelayList(req.relays);
  if (!relays.length) relays = defaultAdvancedSearchRelays(filter);
  const normalized: AdvancedSearchRequest = {
    filter,
    mercury: req.mercury,
    relays
  };
  const key = advancedSearchCacheKey(normalized);
  // Do not use paintCached/composeSearchResults — that drops non-catalog kinds
  // (highlights, notes, …) then treats the raw snapshot as "fresh" and skips REQ.
  const viewer = session.getPubkey()?.toLowerCase() ?? null;
  const snap = await cacheGetSearchSnapshot(key);
  let cached: Event[] = [];
  if (searchSnapshotMatchesViewer(snap, viewer)) {
    cached = pruneToLatestReplaceables(filterDeletedEvents(snap?.events ?? []));
    const fresh = searchSnapshotFresh(snap, undefined, viewer);
    rememberEvents(cached);
    onUpdate({ events: cached, loading: !fresh, done: fresh });
    if (fresh) return;
  } else {
    onUpdate({ events: [], loading: true, done: false });
  }
  void trustedAssertions.resolveProvider(session.getPubkey());
  await finishAdvancedSearch(key, await liveAdvancedSearch(normalized), cached, onUpdate);
}

export { hexPubkey, npubFromInput };
