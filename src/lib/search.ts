import { KIND, NIP32_READ_LABEL } from './constants';
import { isReadLabelSlug } from './nip32';
import { countReadPublications } from './read-marks';
import { fetchBrainstormNip50Events } from './brainstorm-search';
import { dTagVariants, normalizeDTag } from './dtag';
import { filterDeletedEvents, refreshDeletionsFor } from './deletions';
import { filterRenderableCatalogEvents } from './catalog-visibility';
import { cacheGetSearchSnapshot, cachePutMany, cachePutSearchSnapshot, cacheScanText, searchSnapshotFresh } from './nostr/cache';
import { rememberEvents } from './nostr/event-memory';
import { mercuryFilter, mercuryPublicationSearch, mercurySectionSearch, mercuryWikiSearch, mercurySuggest } from './nostr/mercury';
import { relayPool } from './nostr/pool';
import { relayTagSlug } from './nostr/relay-filters';
import { documentStack, socialStack } from './nostr/selector';
import {
  shouldHideEventByGrapevine,
  type GrapevineTrustContext
} from './grapevine-rank';
import { hasKnownRank } from './nip85-trusted-assertions';
import { hexPubkey, npubFromInput, preferRicherEvent, publicationSectionCount, sortSearchResults } from './metadata';
import { followPubkeysFromMetadata } from './mute';
import { ensureFollowsOfFollows, getFollowsOfFollowsSet } from './follows-of-follows';
import { isTopLevel30040, eventAddress } from './nostr/verify';
import { publicationTargetsFromDirectory } from './bookshelf';
import { fetchByAddresses, fetchByIds } from './nostr/fetch';
import { parseReadingQueue, readingQueueFromMetadata } from './reading-queue';
import { localReadingQueue } from './stores/local-reading-queue';
import { readingPrefs } from './stores/reading-prefs';
import { get } from 'svelte/store';
import { session } from './stores/session';
import { trust } from './stores/trust';
import { trustedAssertions } from './trusted-assertions';
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
  return [...byId.values()];
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

async function finishWithGrapevine(
  key: string,
  live: Event[],
  cached: Event[],
  onUpdate: (r: SearchResult) => void,
  opts?: { exactD?: string }
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
  events = events.slice(0, 100);
  rememberEvents(events);
  void cachePutSearchSnapshot(key, events);
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

async function paintCached(
  key: string,
  onUpdate: (r: SearchResult) => void
): Promise<{ events: Event[]; fresh: boolean }> {
  const snap = await cacheGetSearchSnapshot(key);
  const cached = filterRenderableCatalogEvents(filterDeletedEvents(snap?.events ?? []));
  const fresh = searchSnapshotFresh(snap);
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

  const key = `q:${normalizeSearchKey(q)}`;
  const { events: cached, fresh } = await paintCached(key, onUpdate);

  const profileNpub = npubFromInput(q);
  if (profileNpub) {
    onUpdate({ events: cached, loading: false, done: true });
    return;
  }

  if (fresh) return;

  if (HEX64.test(q)) {
    await finishWithGrapevine(key, await fetchByIdOrAuthor(q), cached, onUpdate);
    return;
  }

  try {
    const decoded = nip19.decode(q);
    if (decoded.type === 'naddr' || decoded.type === 'nevent' || decoded.type === 'note') {
      await finishWithGrapevine(key, await fetchBech32(decoded), cached, onUpdate);
      return;
    }
  } catch {
    /* fan-out */
  }

  await fanOutSearch(q, key, cached, onUpdate);
}

async function fetchByIdOrAuthor(hex: string): Promise<Event[]> {
  const idFilter: Filter = { ids: [hex.toLowerCase()], limit: 100 };
  const authorFilter: Filter = { authors: [hex.toLowerCase()], limit: 100 };
  const [m1, m2, w1, w2, s1, s2] = await Promise.all([
    mercuryFilter(idFilter),
    mercuryFilter(authorFilter),
    relayPool.query(documentStack(), [idFilter]),
    relayPool.query(documentStack(), [authorFilter]),
    relayPool.query(socialStack(), [idFilter]),
    relayPool.query(socialStack(), [authorFilter])
  ]);
  const byId = new Map<string, Event>();
  for (const e of [...m1, ...m2, ...w1, ...w2, ...s1, ...s2]) byId.set(e.id, e);
  const events = [...byId.values()];
  await cachePutMany(events);
  return events;
}

async function fetchBech32(
  decoded: ReturnType<typeof nip19.decode>
): Promise<Event[]> {
  if (decoded.type === 'note' || decoded.type === 'nevent') {
    const id = decoded.type === 'note' ? decoded.data : decoded.data.id;
    return fetchByIdOrAuthor(id);
  }
  if (decoded.type === 'naddr') {
    const { kind, pubkey, identifier } = decoded.data;
    const filter: Filter = {
      kinds: [kind],
      authors: [pubkey],
      '#d': [identifier],
      limit: 100
    };
    const [m, w, s] = await Promise.all([
      mercuryFilter(filter),
      relayPool.query(documentStack(), [filter]),
      relayPool.query(socialStack(), [filter])
    ]);
    const byId = new Map<string, Event>();
    for (const e of [...m, ...w, ...s]) byId.set(e.id, e);
    return [...byId.values()];
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
    ? { kinds: [KIND.PUBLICATION, KIND.SECTION, KIND.WIKI, KIND.SPEC], '#d': dTags.slice(0, 12), limit: 100 }
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
    cacheScanText(q),
    brainstormSearch(q),
    ...(dFilter ? [relayPool.query(relays, [dFilter])] : []),
    relayPool.query(relays, [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC], '#T': [tagSlug], limit: 100 }]),
    relayPool.query(relays, [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC], '#N': [tagSlug], limit: 100 }])
  ];

  const merge = (batch: Event[]) => {
    for (const e of batch) {
      const prev = byId.get(e.id);
      byId.set(e.id, prev ? preferRicherEvent(prev, e) : e);
    }
    const events = rankEvents(filterDeletedEvents([...byId.values()]), grapevineContext());
    onUpdate({ events: events.slice(0, 100), loading: true, done: false });
  };

  await Promise.all(
    tasks.map((t) =>
      t.then((events) => {
        merge(events);
        return events;
      })
    )
  );

  await finishWithGrapevine(key, [...byId.values()], cached, onUpdate);
}

export async function runAuthorSearch(author: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `author:${normalizeSearchKey(author)}`;
  const slug = relayTagSlug(author);
  await cachedOrLive(key, onUpdate, async () => {
    const [mercury, wiki, relays, brainstorm] = await Promise.all([
      mercuryPublicationSearch({ author, limit: 100 }),
      mercuryWikiSearch({ author, limit: 100 }),
      relayPool.query(documentStack(), [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC], '#N': [slug], limit: 100 }]),
      brainstormSearch(author)
    ]);
    return mergeById([...mercury, ...wiki, ...relays, ...brainstorm]);
  });
}

export async function runTitleSearch(title: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `title:${normalizeSearchKey(title)}`;
  const slug = relayTagSlug(title);
  await cachedOrLive(key, onUpdate, async () => {
    const [mercury, wiki, relays, brainstorm] = await Promise.all([
      mercuryPublicationSearch({ title, limit: 100 }),
      mercuryWikiSearch({ title, limit: 100 }),
      relayPool.query(documentStack(), [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC], '#T': [slug], limit: 100 }]),
      brainstormSearch(title)
    ]);
    return mergeById([...mercury, ...wiki, ...relays, ...brainstorm]);
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
        mercuryPublicationSearch({ s: id, limit: 100 }),
        mercuryWikiSearch({ identifier: id, limit: 100 }),
        mercuryWikiSearch({ s: id, limit: 100 })
      ]),
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
    const [subjects, brainstorm] = await Promise.all([
      searchBySubject(subject),
      brainstormSearch(subject)
    ]);
    return mergeById([...subjects, ...brainstorm]);
  });
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
      3
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

export async function runReadingQueueSearch(
  npubOrHex: string,
  onUpdate: (r: SearchResult) => void
): Promise<void> {
  const hex = hexPubkey(npubOrHex) ?? (HEX64.test(npubOrHex.trim()) ? npubOrHex.trim().toLowerCase() : '');
  const key = `queue:${hex || normalizeSearchKey(npubOrHex)}`;
  if (!hex) {
    await cachedOrLive(key, onUpdate, async () => []);
    return;
  }
  await cachedOrLive(key, onUpdate, () => searchByReadingQueue(hex));
}

export async function suggestTitles(q: string): Promise<string[]> {
  if (q.length < 2) return [];
  return mercurySuggest(q);
}

export async function runDTagSearch(d: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const slug = normalizeDTag(d);
  const key = `d:${normalizeSearchKey(slug || d)}`;
  if (!slug) {
    await cachedOrLive(key, onUpdate, async () => []);
    return;
  }
  const variants = dTagVariants(d);
  const kinds = [KIND.PUBLICATION, KIND.SECTION, KIND.WIKI, KIND.SPEC, KIND.DIRECTORY];
  const filter: Filter = { kinds, '#d': variants.slice(0, 12), limit: 100 };
  await cachedOrLive(
    key,
    onUpdate,
    async () => {
      const [mercuryPubs, mercuryWiki, relays, filtered, brainstorm] = await Promise.all([
        mercuryPublicationSearch({ d: slug, limit: 100 }),
        mercuryWikiSearch({ d: slug, limit: 100 }),
        relayPool.query(documentStack(), [filter]),
        mercuryFilter(filter),
        brainstormSearch(slug)
      ]);
      return mergeById([...mercuryPubs, ...mercuryWiki, ...relays, ...filtered, ...brainstorm]);
    },
    { exactD: slug }
  );
}

export async function searchByDTag(d: string): Promise<Event[]> {
  const slug = normalizeDTag(d);
  const filter: Filter = { kinds: [KIND.PUBLICATION], '#d': [slug], limit: 100 };
  const [m, w] = await Promise.all([
    mercuryFilter(filter),
    relayPool.query(documentStack(), [filter])
  ]);
  const byId = new Map<string, Event>();
  for (const e of [...m, ...w]) byId.set(e.id, e);
  return [...byId.values()];
}

export async function searchBySubject(t: string): Promise<Event[]> {
  const [pubs, tagged] = await Promise.all([
    mercuryPublicationSearch({ subject: t, limit: 100 }),
    mercuryFilter({ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC], '#t': [t], limit: 100 })
  ]);
  return mergeById([...pubs, ...tagged]);
}

export async function searchByLabel(l: string): Promise<Event[]> {
  if (isReadLabelSlug(l)) return [];
  const filter: Filter = { kinds: [KIND.LABEL], '#l': [l], limit: 100 };
  const events = await relayPool.query(socialStack(), [filter]);
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
    4
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
  return [...results.values()];
}

/** Explicit 30045 bookshelf lookup — no fan-out. Optional `npub` scopes to one author. */
export async function searchByBookshelf(d: string, npubOrHex?: string): Promise<Event[]> {
  const slug = normalizeDTag(d) || d.trim();
  if (!slug) return [];
  const authors: string[] = [];
  if (npubOrHex) {
    const hex = hexPubkey(npubOrHex);
    if (hex) authors.push(hex);
  } else {
    const me = session.getPubkey();
    if (me) authors.push(me);
  }
  const filter: Filter = {
    kinds: [KIND.DIRECTORY],
    '#d': [slug],
    limit: authors.length ? 5 : 20,
    ...(authors.length ? { authors } : {})
  };
  const dirs = mergeById(await relayPool.query(documentStack(), [filter]));
  if (!dirs.length) return [];
  const addresses = new Set<string>();
  const eventIds = new Set<string>();
  for (const dir of dirs) {
    const t = publicationTargetsFromDirectory(dir);
    for (const a of t.addresses) addresses.add(a);
    for (const id of t.eventIds) eventIds.add(id);
  }
  const byAddr = await fetchByAddresses([...addresses].slice(0, 80));
  const byId = await fetchByIds([...eventIds].slice(0, 40));
  return preferTopLevelPublications(
    mergeById([
      ...byAddr.filter((e) => e.kind === KIND.PUBLICATION),
      ...byId.filter((e) => e.kind === KIND.PUBLICATION)
    ])
  );
}

export async function runBookshelfSearch(
  d: string,
  onUpdate: (r: SearchResult) => void,
  npubOrHex?: string
): Promise<void> {
  const key = `bookshelf:${normalizeSearchKey(d)}:${npubOrHex ?? ''}`;
  await cachedOrLive(key, onUpdate, () => searchByBookshelf(d, npubOrHex));
}

export { hexPubkey, npubFromInput };
