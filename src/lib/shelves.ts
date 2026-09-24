import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { GITCITADEL_CURATOR_HEX } from './hex';
import { coverImageUrl } from './cover';
import { isPublicationLabelEvent, publicationTargets } from './nip32';
import { publicationTargetsFromDirectory } from './bookshelf';
import { firstTag, eventAddress } from './nostr/verify';

export type ShelfId = 'mine' | 'follows' | 'gitcitadel' | 'network';

export type Shelf = {
  id: ShelfId;
  title: string;
  events: Event[];
};

/** Extra horizontal shelf from a nested 30045 folder (viewer only). */
export type NestedShelf = {
  id: string;
  title: string;
  d: string;
  events: Event[];
};

export type Membership = {
  address?: string;
  eventId?: string;
  author: string;
  created_at: number;
  /** Optional nested folder slug when membership comes from a non-root 30045. */
  folderD?: string;
  folderTitle?: string;
};

export const SHELF_TITLES: Record<ShelfId, string> = {
  mine: 'My shelf',
  follows: 'From follows',
  gitcitadel: 'GitCitadel',
  network: 'From the network'
};

/** Core bucket order for assignShelves (folders are interleaved separately). */
const SHELF_ORDER: ShelfId[] = ['mine', 'gitcitadel', 'follows', 'network'];

/**
 * Home / landing row order:
 * 1. My shelf
 * 2. Viewer's nested folder shelves (A–Z by title)
 * 3. GitCitadel
 * 4. From follows, then From the network
 * Unknown ids stay at the end in input order.
 */
export function orderLandingShelves<T extends { id: string; title?: string }>(shelves: T[]): T[] {
  const mine: T[] = [];
  const folders: T[] = [];
  const gitcitadel: T[] = [];
  const follows: T[] = [];
  const network: T[] = [];
  const other: T[] = [];
  for (const shelf of shelves) {
    if (shelf.id === 'mine') mine.push(shelf);
    else if (shelf.id.startsWith('folder:')) folders.push(shelf);
    else if (shelf.id === 'gitcitadel') gitcitadel.push(shelf);
    else if (shelf.id === 'follows') follows.push(shelf);
    else if (shelf.id === 'network') network.push(shelf);
    else other.push(shelf);
  }
  folders.sort((a, b) => {
    const ta = (a.title ?? a.id).trim();
    const tb = (b.title ?? b.id).trim();
    return ta.localeCompare(tb, undefined, { sensitivity: 'base' });
  });
  return [...mine, ...folders, ...gitcitadel, ...follows, ...network, ...other];
}

/**
 * Drop covers on GitCitadel / follows / network that already appear on a higher row.
 * Viewer-owned shelves (My shelf + nested folders) keep every cover — intentional duplicates stay.
 * Empty curated shelves after dedupe are omitted.
 */
export function dedupeLandingShelfEvents<
  T extends { id: string; title?: string; events: Event[] }
>(shelves: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const shelf of orderLandingShelves(shelves)) {
    const owned = isViewerOwnedShelfId(shelf.id);
    if (owned) {
      for (const event of shelf.events) {
        seen.add(eventAddress(event) || event.id.toLowerCase());
      }
      if (!shelf.events.length) continue;
      out.push(shelf);
      continue;
    }
    const events = shelf.events.filter((event) => {
      const key = eventAddress(event) || event.id.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!events.length) continue;
    out.push(events === shelf.events ? shelf : { ...shelf, events });
  }
  return out;
}

/** My shelf and nested 30045 folders — not follows/GitCitadel/network. */
export function isViewerOwnedShelfId(id: string): boolean {
  return id === 'mine' || id.startsWith('folder:');
}

function targetsFromMembershipEvent(event: Event): {
  addresses: string[];
  eventIds: string[];
} {
  if (event.kind === KIND.DIRECTORY) return publicationTargetsFromDirectory(event);
  return publicationTargets(event);
}

export function membershipsFromEvents(labelsBookmarksAndDirs: Event[]): Membership[] {
  const out: Membership[] = [];
  for (const event of labelsBookmarksAndDirs) {
    const isBookmark = event.kind === KIND.BOOKMARK;
    const isLabel = isPublicationLabelEvent(event);
    const isDir = event.kind === KIND.DIRECTORY;
    if (!isBookmark && !isLabel && !isDir) continue;
    const { addresses, eventIds } = targetsFromMembershipEvent(event);
    const folderD =
      isDir && event.tags.find((t) => t[0] === 'd')?.[1] !== 'my-book-collection'
        ? event.tags.find((t) => t[0] === 'd')?.[1]
        : undefined;
    for (const address of addresses) {
      out.push({
        address,
        author: event.pubkey.toLowerCase(),
        created_at: event.created_at,
        folderD,
        folderTitle: folderD
      });
    }
    for (const eventId of eventIds) {
      out.push({
        eventId,
        author: event.pubkey.toLowerCase(),
        created_at: event.created_at,
        folderD,
        folderTitle: folderD
      });
    }
  }
  return out;
}

function shelfForAuthor(
  author: string,
  viewer: string | null,
  follows: Set<string>
): ShelfId {
  if (viewer && author === viewer) return 'mine';
  if (viewer && follows.has(author)) return 'follows';
  if (author === GITCITADEL_CURATOR_HEX) return 'gitcitadel';
  return 'network';
}

/** Membership win priority when a pub appears on multiple lists (lower wins). Matches Home row order. */
const PRIORITY: Record<ShelfId, number> = {
  mine: 0,
  gitcitadel: 1,
  follows: 2,
  network: 3
};

/**
 * Walk up a-tag parents within `known` until the root edition.
 * When the parent is not in `known`, returns the event unchanged.
 */
export function promoteToTopLevel(event: Event, known: Event[]): Event {
  if (event.kind !== KIND.PUBLICATION) return event;
  const byAddr = new Map<string, Event>();
  for (const e of known) {
    if (e.kind === KIND.PUBLICATION) byAddr.set(eventAddress(e), e);
  }
  const pool = [...byAddr.values()];
  let addr = eventAddress(event);
  for (let i = 0; i < 8; i++) {
    const parent = pool.find((p) => p.tags.some((t) => t[0] === 'a' && t[1] === addr));
    if (!parent) break;
    addr = eventAddress(parent);
  }
  return byAddr.get(addr) ?? event;
}

/**
 * When parents are missing from the pool, sibling chapters still look "top-level".
 * Collapse same-author pubs that share a cover image — keep the shortest d-tag
 * (edition roots are shorter than `…-ch-7` style nested indexes).
 */
export function collapseSameCoverEditions(events: Event[]): Event[] {
  const groups = new Map<string, Event[]>();
  for (const event of events) {
    if (event.kind !== KIND.PUBLICATION) continue;
    const img = coverImageUrl(event)?.trim();
    if (!img) continue;
    const key = `${event.pubkey.toLowerCase()}|${img}`;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  const drop = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const addrs = new Set(group.map((e) => eventAddress(e)));
    const score = (e: Event): number => {
      const childHits = e.tags.filter((t) => t[0] === 'a' && t[1] && addrs.has(t[1])).length;
      const d = firstTag(e, 'd') ?? '';
      // Prefer pubs that a-tag siblings (true parents), then shorter d-tags.
      return childHits * 10_000 - d.length;
    };
    const ranked = [...group].sort((a, b) => score(b) - score(a));
    for (const loser of ranked.slice(1)) drop.add(eventAddress(loser));
  }
  return events.filter((e) => e.kind !== KIND.PUBLICATION || !drop.has(eventAddress(e)));
}

/**
 * Shelf covers are top-level 30040 editions only.
 * Nested chapter/section indexes promote to a parent when that parent is in `known`,
 * then same-cover siblings collapse when parents are still unknown.
 */
export function topLevelShelfEvents(events: Event[], known: Event[] = events): Event[] {
  const byAddr = new Map<string, Event>();
  for (const event of [...known, ...events]) {
    if (event.kind === KIND.PUBLICATION) byAddr.set(eventAddress(event), event);
  }
  const pool = [...byAddr.values()];
  const out = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== KIND.PUBLICATION) continue;
    const top = promoteToTopLevel(event, pool);
    out.set(eventAddress(top), top);
  }
  return collapseSameCoverEditions([...out.values()]);
}

export function assignShelves(
  memberships: Membership[],
  publications: Map<string, Event>,
  viewer: string | null,
  follows: Set<string>
): Shelf[] {
  type Acc = { shelf: ShelfId; created_at: number };
  const best = new Map<string, Acc>();
  const knownPubs = [...publications.values()];

  for (const membership of memberships) {
    const address = membership.address;
    if (!address) continue;
    const pub = publications.get(address);
    if (!pub) continue;
    const top = promoteToTopLevel(pub, knownPubs);
    const topAddr = eventAddress(top);
    const shelf = shelfForAuthor(membership.author, viewer, follows);
    if (!viewer && (shelf === 'mine' || shelf === 'follows')) continue;
    const prev = best.get(topAddr);
    if (!prev) {
      best.set(topAddr, { shelf, created_at: membership.created_at });
      continue;
    }
    if (PRIORITY[shelf] < PRIORITY[prev.shelf]) {
      best.set(topAddr, { shelf, created_at: membership.created_at });
    } else if (shelf === prev.shelf && membership.created_at > prev.created_at) {
      best.set(topAddr, { shelf, created_at: membership.created_at });
    }
  }

  const buckets: Record<ShelfId, { event: Event; created_at: number }[]> = {
    mine: [],
    follows: [],
    gitcitadel: [],
    network: []
  };

  for (const [address, acc] of best) {
    const event = publications.get(address) ?? knownPubs.find((e) => eventAddress(e) === address);
    if (!event) continue;
    buckets[acc.shelf].push({ event, created_at: acc.created_at });
  }

  const shelves: Shelf[] = [];
  for (const id of SHELF_ORDER) {
    if (!viewer && (id === 'mine' || id === 'follows')) continue;
    const items = buckets[id];
    if (!items.length) continue;
    items.sort((a, b) => {
      if (b.created_at !== a.created_at) return b.created_at - a.created_at;
      return eventAddress(a.event).localeCompare(eventAddress(b.event));
    });
    const events = collapseSameCoverEditions(items.map((i) => i.event));
    shelves.push({ id, title: SHELF_TITLES[id], events });
  }
  return shelves;
}

/**
 * Viewer's nested 30045 folders as extra home rows (root my-book-collection excluded —
 * those pubs already appear on "My shelf").
 */
export function nestedShelvesForViewer(
  directories: Event[],
  publications: Map<string, Event>,
  viewer: string
): NestedShelf[] {
  const out: NestedShelf[] = [];
  for (const dir of directories) {
    if (dir.kind !== KIND.DIRECTORY) continue;
    if (dir.pubkey.toLowerCase() !== viewer) continue;
    const d = dir.tags.find((t) => t[0] === 'd')?.[1]?.trim() ?? '';
    if (!d || d === 'my-book-collection') continue;
    const { addresses, eventIds } = publicationTargetsFromDirectory(dir);
    const raw: Event[] = [];
    const seen = new Set<string>();
    for (const address of addresses) {
      const pub = publications.get(address);
      if (pub && !seen.has(address)) {
        seen.add(address);
        raw.push(pub);
      }
    }
    for (const eventId of eventIds) {
      for (const [addr, pub] of publications) {
        if (pub.id.toLowerCase() === eventId && !seen.has(addr)) {
          seen.add(addr);
          raw.push(pub);
        }
      }
    }
    const events = topLevelShelfEvents(raw, [...publications.values()]);
    if (!events.length) continue;
    events.sort((a, b) => b.created_at - a.created_at);
    out.push({
      id: `folder:${d}`,
      title: d,
      d,
      events
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

/** Mine, follows, and nested 30045 folder rows — must not carry across identities. */
export function isViewerBoundShelfId(id: string): boolean {
  return id === 'mine' || id === 'follows' || id.startsWith('folder:');
}

export function bookmarkHasPublication(bookmark: Event | null, publication: Event): boolean {
  if (!bookmark) return false;
  const { addresses, eventIds } = publicationTargets(bookmark);
  if (eventIds.includes(publication.id.toLowerCase())) return true;
  const addr = eventAddress(publication);
  return addresses.includes(addr);
}

export function withBookmarkTag(
  bookmark: Event | null,
  publication: Event,
  add: boolean
): string[][] {
  const addr = eventAddress(publication);
  const existing = bookmark?.tags ?? [];
  const without = existing.filter((t) => {
    if (t[0] === 'a' && t[1] === addr) return false;
    if (t[0] === 'e' && t[1]?.toLowerCase() === publication.id.toLowerCase()) return false;
    return true;
  });
  if (!add) return without;
  return [...without, ['a', addr]];
}
