import { KIND } from './constants';
import { dTagVariants, normalizeDTag } from './dtag';
import { cacheGetSearchSnapshot, cachePutMany, cachePutSearchSnapshot, cacheScanText } from './nostr/cache';
import { mercuryFilter, mercuryPublicationSearch, mercurySectionSearch, mercuryWikiSearch, mercurySuggest } from './nostr/mercury';
import { relayPool } from './nostr/pool';
import { relayTagSlug } from './nostr/relay-filters';
import { documentStack, socialStack } from './nostr/selector';
import { hexPubkey, npubFromInput, sortSearchResults } from './metadata';
import { isTopLevel30040 } from './nostr/verify';
import { publicationTargetsFromDirectory } from './bookshelf';
import { fetchByAddresses, fetchByIds } from './nostr/fetch';
import { session } from './stores/session';
import { nip19, type Event, type Filter } from 'nostr-tools';

export type SearchResult = {
  events: Event[];
  loading: boolean;
  done: boolean;
};

const HEX64 = /^[0-9a-f]{64}$/i;

function stripNostr(s: string): string {
  return s.trim().replace(/^nostr:/i, '');
}

export function normalizeSearchKey(input: string): string {
  return input.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

function mergeById(events: Event[]): Event[] {
  const byId = new Map<string, Event>();
  for (const event of events) byId.set(event.id, event);
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
  return event.tags.filter((t) => (t[0] === 'a' || t[0] === 'e') && t[1]).length;
}

export function preferTopLevelPublications(events: Event[]): Event[] {
  const pubs = events.filter((e) => e.kind === KIND.PUBLICATION);
  const hasTop = pubs.some((e) => isTopLevel30040(e, pubs));
  if (!hasTop) return events;
  return events.filter((e) => e.kind !== KIND.PUBLICATION || isTopLevel30040(e, pubs));
}

function rankEvents(events: Event[]): Event[] {
  const counts = new Map(events.map((e) => [e.id, sectionCount(e)]));
  return sortSearchResults(preferTopLevelPublications(events), counts);
}

function preferLive(live: Event[], cached: Event[]): Event[] {
  return live.length ? live : cached;
}

export function isNsec(input: string): boolean {
  try {
    return nip19.decode(stripNostr(input)).type === 'nsec';
  } catch {
    return false;
  }
}

async function paintCached(key: string, onUpdate: (r: SearchResult) => void): Promise<Event[]> {
  const cached = await cacheGetSearchSnapshot(key);
  onUpdate({ events: cached, loading: true, done: false });
  return cached;
}

function finish(key: string, live: Event[], cached: Event[], onUpdate: (r: SearchResult) => void): Event[] {
  const events = rankEvents(preferLive(live, cached)).slice(0, 100);
  void cachePutSearchSnapshot(key, events);
  void cachePutMany(events);
  onUpdate({ events, loading: false, done: true });
  return events;
}

export async function runSearch(query: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const q = stripNostr(query);

  if (isNsec(q)) {
    onUpdate({ events: [], loading: false, done: true });
    return;
  }

  const key = `q:${normalizeSearchKey(q)}`;
  const cached = await paintCached(key, onUpdate);

  const profileNpub = npubFromInput(q);
  if (profileNpub) {
    onUpdate({ events: cached, loading: false, done: true });
    return;
  }

  if (HEX64.test(q)) {
    finish(key, await fetchByIdOrAuthor(q), cached, onUpdate);
    return;
  }

  try {
    const decoded = nip19.decode(q);
    if (decoded.type === 'naddr' || decoded.type === 'nevent' || decoded.type === 'note') {
      finish(key, await fetchBech32(decoded), cached, onUpdate);
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
    ...(dFilter ? [relayPool.query(relays, [dFilter])] : []),
    relayPool.query(relays, [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC], '#T': [tagSlug], limit: 100 }]),
    relayPool.query(relays, [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC], '#N': [tagSlug], limit: 100 }])
  ];

  const merge = (batch: Event[]) => {
    for (const e of batch) {
      if (!byId.has(e.id)) byId.set(e.id, e);
    }
    const events = rankEvents([...byId.values()]);
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

  finish(key, rankEvents([...byId.values()]), cached, onUpdate);
}

export async function runAuthorSearch(author: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `author:${normalizeSearchKey(author)}`;
  const cached = await paintCached(key, onUpdate);
  const slug = relayTagSlug(author);
  const [mercury, wiki, relays] = await Promise.all([
    mercuryPublicationSearch({ author, limit: 100 }),
    mercuryWikiSearch({ author, limit: 100 }),
    relayPool.query(documentStack(), [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC], '#N': [slug], limit: 100 }])
  ]);
  finish(key, mergeById([...mercury, ...wiki, ...relays]), cached, onUpdate);
}

export async function runTitleSearch(title: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `title:${normalizeSearchKey(title)}`;
  const cached = await paintCached(key, onUpdate);
  const slug = relayTagSlug(title);
  const [mercury, wiki, relays] = await Promise.all([
    mercuryPublicationSearch({ title, limit: 100 }),
    mercuryWikiSearch({ title, limit: 100 }),
    relayPool.query(documentStack(), [{ kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC], '#T': [slug], limit: 100 }])
  ]);
  finish(key, mergeById([...mercury, ...wiki, ...relays]), cached, onUpdate);
}

export async function runIdentifierSearch(identifier: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `identifier:${normalizeSearchKey(identifier)}`;
  const cached = await paintCached(key, onUpdate);
  const hints = identifierHints(identifier);
  const ids = hints.length ? hints : [identifier];
  const batches = await Promise.all(
    ids.flatMap((id) => [
      mercuryPublicationSearch({ identifier: id, limit: 100 }),
      mercuryPublicationSearch({ s: id, limit: 100 }),
      mercuryWikiSearch({ identifier: id, limit: 100 }),
      mercuryWikiSearch({ s: id, limit: 100 })
    ])
  );
  finish(key, mergeById(batches.flat()), cached, onUpdate);
}

export async function runLanguageSearch(language: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `language:${normalizeSearchKey(language)}`;
  const cached = await paintCached(key, onUpdate);
  finish(key, await mercuryPublicationSearch({ language, limit: 100 }), cached, onUpdate);
}

export async function runSubjectSearch(subject: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `subject:${normalizeSearchKey(subject)}`;
  const cached = await paintCached(key, onUpdate);
  finish(key, await searchBySubject(subject), cached, onUpdate);
}

export async function runLabelSearch(label: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const key = `label:${normalizeSearchKey(label)}`;
  const cached = await paintCached(key, onUpdate);
  finish(key, await searchByLabel(label), cached, onUpdate);
}

export async function suggestTitles(q: string): Promise<string[]> {
  if (q.length < 2) return [];
  return mercurySuggest(q);
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
  const filter: Filter = { kinds: [KIND.LABEL], '#l': [l], limit: 100 };
  const events = await relayPool.query(socialStack(), [filter]);
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
    if (!pubkey || !d) continue;
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
  const [m, w] = await Promise.all([
    mercuryFilter(filter),
    relayPool.query(documentStack(), [filter])
  ]);
  const dirs = mergeById([...m, ...w]);
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
  const cached = await paintCached(key, onUpdate);
  finish(key, await searchByBookshelf(d, npubOrHex), cached, onUpdate);
}

export { hexPubkey, npubFromInput };
