import { nip19, type Event, type Filter } from 'nostr-tools';
import { KIND } from './constants';
import { dTagVariants, normalizeDTag } from './dtag';
import { cachePutMany, cacheScanByKind } from './nostr/cache';
import { mercuryFilter, mercuryPublicationSearch, mercurySectionSearch, mercuryWikiSearch, mercurySuggest } from './nostr/mercury';
import { relayPool } from './nostr/pool';
import { relayTagSlug } from './nostr/relay-filters';
import { documentStack } from './nostr/selector';
import { hexPubkey, npubFromInput, sortSearchResults } from './metadata';

export type SearchResult = {
  events: Event[];
  loading: boolean;
  done: boolean;
};

const HEX64 = /^[0-9a-f]{64}$/i;

function stripNostr(s: string): string {
  return s.trim().replace(/^nostr:/i, '');
}

export function isNsec(input: string): boolean {
  try {
    return nip19.decode(stripNostr(input)).type === 'nsec';
  } catch {
    return false;
  }
}

export async function runSearch(query: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const q = stripNostr(query);
  onUpdate({ events: [], loading: true, done: false });

  if (isNsec(q)) {
    onUpdate({ events: [], loading: false, done: true });
    return;
  }

  const profileNpub = npubFromInput(q);
  if (profileNpub) {
    onUpdate({ events: [], loading: false, done: true });
    return;
  }

  if (HEX64.test(q)) {
    const events = await fetchByIdOrAuthor(q);
    onUpdate({ events, loading: false, done: true });
    return;
  }

  try {
    const decoded = nip19.decode(q);
    if (decoded.type === 'naddr' || decoded.type === 'nevent' || decoded.type === 'note') {
      const events = await fetchBech32(decoded);
      onUpdate({ events, loading: false, done: true });
      return;
    }
  } catch {
    /* fan-out */
  }

  await fanOutSearch(q, onUpdate);
}

async function fetchByIdOrAuthor(hex: string): Promise<Event[]> {
  const idFilter: Filter = { ids: [hex.toLowerCase()], limit: 100 };
  const authorFilter: Filter = { authors: [hex.toLowerCase()], limit: 100 };
  const [m1, m2, w1, w2] = await Promise.all([
    mercuryFilter(idFilter),
    mercuryFilter(authorFilter),
    relayPool.query(documentStack(), [idFilter]),
    relayPool.query(documentStack(), [authorFilter])
  ]);
  const byId = new Map<string, Event>();
  for (const e of [...m1, ...m2, ...w1, ...w2]) byId.set(e.id, e);
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
    const [m, w] = await Promise.all([
      mercuryFilter(filter),
      relayPool.query(documentStack(), [filter])
    ]);
    const byId = new Map<string, Event>();
    for (const e of [...m, ...w]) byId.set(e.id, e);
    return [...byId.values()];
  }
  return [];
}

async function fanOutSearch(q: string, onUpdate: (r: SearchResult) => void): Promise<void> {
  const byId = new Map<string, Event>();
  const dTags = dTagVariants(q);
  const relays = documentStack();

  const tagSlug = relayTagSlug(q);
  const dFilter = dTags.length
    ? { kinds: [KIND.PUBLICATION, KIND.SECTION, KIND.WIKI, KIND.SPEC], '#d': dTags.slice(0, 12), limit: 100 }
    : null;

  const tasks = [
    mercuryPublicationSearch({ q, limit: 100 }),
    mercuryPublicationSearch({ d: dTags[0], limit: 100 }),
    mercurySectionSearch({ q, limit: 100 }),
    mercuryWikiSearch({ q, limit: 100 }),
    ...(dFilter ? [relayPool.query(relays, [dFilter])] : []),
    relayPool.query(relays, [{ kinds: [KIND.PUBLICATION], '#T': [tagSlug], limit: 100 }]),
    relayPool.query(relays, [{ kinds: [KIND.PUBLICATION], '#N': [tagSlug], limit: 100 }])
  ];

  const merge = (batch: Event[]) => {
    for (const e of batch) {
      if (!byId.has(e.id)) byId.set(e.id, e);
    }
    const events = sortSearchResults([...byId.values()], new Map());
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

  const final = sortSearchResults([...byId.values()], new Map()).slice(0, 100);
  await cachePutMany(final);
  onUpdate({ events: final, loading: false, done: true });
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
  return mercuryPublicationSearch({ subject: t, limit: 100 });
}

export async function searchByLabel(l: string): Promise<Event[]> {
  const filter: Filter = { kinds: [KIND.LABEL], '#l': [l], limit: 100 };
  const events = await relayPool.query(documentStack(), [filter]);
  const pubIds = new Set<string>();
  for (const label of events) {
    for (const tag of label.tags) {
      if (tag[0] === 'a' && tag[1]?.startsWith(`${KIND.PUBLICATION}:`)) {
        const parts = tag[1].split(':');
        if (parts.length >= 3) pubIds.add(`${parts[1]}:${parts[2]}`);
      }
    }
  }
  const results: Event[] = [];
  for (const key of pubIds) {
    const [pubkey, d] = key.split(':');
    const f: Filter = { kinds: [KIND.PUBLICATION], authors: [pubkey], '#d': [d], limit: 1 };
    const [m, w] = await Promise.all([mercuryFilter(f), relayPool.query(documentStack(), [f])]);
    const hit = m[0] ?? w[0];
    if (hit) results.push(hit);
  }
  return results;
}

export { hexPubkey, npubFromInput };
