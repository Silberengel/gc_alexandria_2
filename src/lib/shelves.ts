import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { GITCITADEL_CURATOR_HEX } from './hex';
import { isPublicationLabelEvent, publicationTargets } from './nip32';
import { publicationTargetsFromDirectory } from './bookshelf';
import { eventAddress } from './nostr/verify';

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

const SHELF_ORDER: ShelfId[] = ['mine', 'follows', 'gitcitadel', 'network'];

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

const PRIORITY: Record<ShelfId, number> = {
  mine: 0,
  follows: 1,
  gitcitadel: 2,
  network: 3
};

export function assignShelves(
  memberships: Membership[],
  publications: Map<string, Event>,
  viewer: string | null,
  follows: Set<string>
): Shelf[] {
  type Acc = { shelf: ShelfId; created_at: number };
  const best = new Map<string, Acc>();

  for (const membership of memberships) {
    const address = membership.address;
    if (!address) continue;
    const pub = publications.get(address);
    if (!pub) continue;
    const shelf = shelfForAuthor(membership.author, viewer, follows);
    if (!viewer && (shelf === 'mine' || shelf === 'follows')) continue;
    const prev = best.get(address);
    if (!prev) {
      best.set(address, { shelf, created_at: membership.created_at });
      continue;
    }
    if (PRIORITY[shelf] < PRIORITY[prev.shelf]) {
      best.set(address, { shelf, created_at: membership.created_at });
    } else if (shelf === prev.shelf && membership.created_at > prev.created_at) {
      best.set(address, { shelf, created_at: membership.created_at });
    }
  }

  const buckets: Record<ShelfId, { event: Event; created_at: number }[]> = {
    mine: [],
    follows: [],
    gitcitadel: [],
    network: []
  };

  for (const [address, acc] of best) {
    const event = publications.get(address);
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
    shelves.push({ id, title: SHELF_TITLES[id], events: items.map((i) => i.event) });
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
    const events: Event[] = [];
    const seen = new Set<string>();
    for (const address of addresses) {
      const pub = publications.get(address);
      if (pub && !seen.has(address)) {
        seen.add(address);
        events.push(pub);
      }
    }
    for (const eventId of eventIds) {
      for (const [addr, pub] of publications) {
        if (pub.id.toLowerCase() === eventId && !seen.has(addr)) {
          seen.add(addr);
          events.push(pub);
        }
      }
    }
    if (!events.length) continue;
    events.sort((a, b) => b.created_at - a.created_at);
    out.push({
      id: `folder:${d}`,
      title: d,
      d,
      events
    });
  }
  return out;
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
