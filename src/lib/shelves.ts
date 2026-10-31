import type { Event } from 'nostr-tools';
import { isRenderableCatalogEvent } from './catalog-visibility';
import { KIND } from './constants';
import { coverImageUrl } from './cover';
import { GITCITADEL_CURATOR_HEX } from './hex';
import { isPublicationLabelEvent, publicationTargets } from './nip32';
import { deprecatedListD } from './nip51-deprecated-lists';
import {
  MY_BOOK_COLLECTION_D_TAG,
  ROOT_DIRECTORY_D_TAG,
  directoryChildrenFromEvent,
  directoryDTag,
  isProtectedDirectoryDTag,
  publicationTargetsFromDirectory
} from './bookshelf';
import { directoryExplorerTitle } from './directory-explorer';
import { isAddressDeleted, isEventDeleted } from './deletions';
import type { LandingShelfChip } from './nostr/cache';
import { isNewerReplaceable, pruneToLatestReplaceables, putNewest } from './nostr/replaceable';
import { firstTag, eventAddress } from './nostr/verify';

function isBookmarkMembershipEvent(event: Event): boolean {
  return event.kind === KIND.BOOKMARK || deprecatedListD(event) === 'bookmark';
}

export type ShelfId = 'mine' | 'follows' | 'guides';

export type Shelf = {
  id: ShelfId;
  title: string;
  events: Event[];
};

/** @deprecated Nested folders are folded into {@link SHELF_TITLES.mine}; kept for tests. */
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
  mine: 'From your bookshelves',
  follows: "From your follows' bookshelves",
  guides: 'From the guides'
};

/** Retired landing rows (cached snapshots / legacy ids) — never paint. */
export function isRetiredLandingShelfId(id: string): boolean {
  return id === 'network' || id === 'gitcitadel';
}

/**
 * Do not open another guides cover track until each row can fill a scrollable shelf.
 * Progressive membership resolve often starts with ~12 curator pubs — splitting those
 * across 3 tracks left arrow-less rows of 4–6 covers.
 */
export const GUIDES_MIN_COVERS_PER_TRACK = 12;

/**
 * How many From the guides cover tracks to open for `coverCount` publications.
 * `desired` is the layout budget (signed-out: 3; signed-in fills empty mine/follows slots).
 */
export function guideCoverTrackCount(coverCount: number, desired: number): number {
  const n = Math.max(1, desired);
  if (coverCount <= 0) return 0;
  const maxUseful = Math.max(1, Math.floor(coverCount / GUIDES_MIN_COVERS_PER_TRACK));
  return Math.min(n, maxUseful, coverCount);
}

/** Core bucket order for assignShelves. */
const SHELF_ORDER: ShelfId[] = ['mine', 'follows', 'guides'];

/**
 * Home / landing row order:
 * 1. Reading now
 * 2. From your bookshelves (mine; legacy folder:* folded in)
 * 3. From your follows' bookshelves
 * 4. From the guides (one or more cover tracks under a single heading)
 */
export function orderLandingShelves<T extends { id: string; title?: string; events?: Event[] }>(
  shelves: T[]
): T[] {
  const readingNow: T[] = [];
  const mine: T[] = [];
  const legacyFolders: T[] = [];
  const follows: T[] = [];
  const guides: T[] = [];
  const other: T[] = [];
  for (const shelf of shelves) {
    if (isRetiredLandingShelfId(shelf.id)) continue;
    if (shelf.id === 'reading-now') readingNow.push(shelf);
    else if (shelf.id === 'mine') mine.push(shelf);
    else if (shelf.id.startsWith('folder:')) legacyFolders.push(shelf);
    else if (shelf.id === 'follows') follows.push(shelf);
    else if (shelf.id === 'guides' || shelf.id.startsWith('guides-')) guides.push(shelf);
    else other.push(shelf);
  }

  const foldEvents = (rows: T[]): Event[] =>
    rows.flatMap((s) => (Array.isArray(s.events) ? (s.events as Event[]) : []));

  // Legacy per-folder rows → one "From your bookshelves" cover row.
  let mineRow: T[] = mine;
  if (legacyFolders.length) {
    const events = [...foldEvents(mine), ...foldEvents(legacyFolders)];
    if (events.length) {
      const base = mine[0];
      mineRow = [
        base
          ? ({ ...base, id: 'mine', title: SHELF_TITLES.mine, events } as T)
          : ({ id: 'mine', title: SHELF_TITLES.mine, events } as unknown as T)
      ];
    } else if (mine.length) {
      mineRow = [{ ...mine[0]!, id: 'mine', title: SHELF_TITLES.mine } as T];
    } else {
      mineRow = [];
    }
  } else if (mine.length > 1 && Array.isArray(mine[0]!.events)) {
    const events = foldEvents(mine);
    mineRow = [{ ...mine[0]!, id: 'mine', title: SHELF_TITLES.mine, events } as T];
  } else if (mine.length) {
    mineRow = mine.map((s) => ({ ...s, title: s.title || SHELF_TITLES.mine }));
  }

  return [...readingNow, ...mineRow, ...follows, ...guides, ...other];
}

/**
 * One cover per landing row. Claim priority (lower wins): mine → guides → follows.
 * Guides beats follows so curator classics stay on From the guides instead of
 * being emptied into a follows shelf that lists the same editions.
 * Empty shelves after dedupe are omitted — except chip-only rows (e.g. Guides).
 */
export function dedupeLandingShelfEvents<
  T extends { id: string; title?: string; events: Event[]; chips?: { d: string }[] }
>(shelves: T[]): T[] {
  const ordered = orderLandingShelves(shelves);
  const claimOrder = [...ordered].sort(
    (a, b) => shelfClaimPriority(a.id) - shelfClaimPriority(b.id)
  );
  const ownerByKey = new Map<string, string>();
  for (const shelf of claimOrder) {
    for (const event of pruneToLatestReplaceables(shelf.events ?? []).filter(
      isRenderableCatalogEvent
    )) {
      const key = eventAddress(event) || event.id.toLowerCase();
      if (!ownerByKey.has(key)) ownerByKey.set(key, shelf.id);
    }
  }

  const out: T[] = [];
  for (const shelf of ordered) {
    const listable = pruneToLatestReplaceables(shelf.events ?? []).filter(
      isRenderableCatalogEvent
    );
    const keepChipsOnly = (shelf.chips?.length ?? 0) > 0;
    const events = listable.filter((event) => {
      const key = eventAddress(event) || event.id.toLowerCase();
      return ownerByKey.get(key) === shelf.id;
    });
    if (!events.length) {
      if (keepChipsOnly) out.push({ ...shelf, events: [] });
      continue;
    }
    out.push(events === shelf.events ? shelf : { ...shelf, events });
  }
  return out;
}

/** Claim priority for exclusive covers (lower wins): mine → guides → follows. */
function shelfClaimPriority(id: string): number {
  if (isViewerOwnedShelfId(id)) return -1;
  if (id === 'guides' || id.startsWith('guides-')) return 1;
  if (id === 'follows') return 2;
  return 50;
}

/** Reading now + own bookshelves — not follows/network/guides. */
export function isViewerOwnedShelfId(id: string): boolean {
  return id === 'reading-now' || id === 'mine' || id.startsWith('folder:');
}

/** Mine / follows — must not carry across identities. */
export function isViewerBoundShelfId(id: string): boolean {
  return id === 'mine' || id === 'follows' || id.startsWith('folder:');
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
    const isBookmark = isBookmarkMembershipEvent(event);
    const isLabel = isPublicationLabelEvent(event);
    const isDir = event.kind === KIND.DIRECTORY;
    if (!isBookmark && !isLabel && !isDir) continue;
    const { addresses, eventIds } = targetsFromMembershipEvent(event);
    const d = isDir ? directoryDTag(event) : '';
    const folderD =
      isDir && d && d !== MY_BOOK_COLLECTION_D_TAG && d !== ROOT_DIRECTORY_D_TAG ? d : undefined;
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
): ShelfId | null {
  if (viewer && author === viewer) return 'mine';
  // Curator always paints From the guides — even when followed, so that row
  // is not emptied into follows.
  if (author === GITCITADEL_CURATOR_HEX) return 'guides';
  if (viewer && follows.has(author)) return 'follows';
  // Stranger booklists no longer get a landing row (From the network retired).
  return null;
}

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
    if (event.kind === KIND.PUBLICATION) putNewest(byAddr, eventAddress(event), event);
  }
  const pool = [...byAddr.values()];
  const out = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== KIND.PUBLICATION) continue;
    const top = promoteToTopLevel(event, pool);
    if (!isRenderableCatalogEvent(top)) continue;
    putNewest(out, eventAddress(top), top);
  }
  return collapseSameCoverEditions([...out.values()]);
}

export function assignShelves(
  memberships: Membership[],
  publications: Map<string, Event>,
  viewer: string | null,
  follows: Set<string>
): Shelf[] {
  type Acc = { event: Event; created_at: number };
  const buckets: Record<ShelfId, Map<string, Acc>> = {
    mine: new Map(),
    follows: new Map(),
    guides: new Map()
  };
  const knownPubs = [...publications.values()];

  for (const membership of memberships) {
    const address = membership.address;
    if (!address) continue;
    const pub = publications.get(address);
    if (!pub) continue;
    const top = promoteToTopLevel(pub, knownPubs);
    if (!isRenderableCatalogEvent(top)) continue;
    const topAddr = eventAddress(top);
    const shelf = shelfForAuthor(membership.author, viewer, follows);
    if (!shelf) continue;
    if (!viewer && (shelf === 'mine' || shelf === 'follows')) continue;

    if (shelf === 'mine') {
      const prev = buckets.mine.get(topAddr);
      if (!prev || membership.created_at > prev.created_at) {
        buckets.mine.set(topAddr, { event: top, created_at: membership.created_at });
      }
      buckets.follows.delete(topAddr);
      buckets.guides.delete(topAddr);
      continue;
    }

    if (buckets.mine.has(topAddr)) continue;

    if (shelf === 'guides') {
      const prev = buckets.guides.get(topAddr);
      if (!prev || membership.created_at > prev.created_at) {
        buckets.guides.set(topAddr, { event: top, created_at: membership.created_at });
      }
      // Guides beat follows on overlap so curator covers are not emptied into follows.
      buckets.follows.delete(topAddr);
      continue;
    }

    // follows — skip if guides already claimed this edition
    if (buckets.guides.has(topAddr)) continue;
    const prev = buckets.follows.get(topAddr);
    if (!prev || membership.created_at > prev.created_at) {
      buckets.follows.set(topAddr, { event: top, created_at: membership.created_at });
    }
  }

  const shelves: Shelf[] = [];
  for (const id of SHELF_ORDER) {
    if (!viewer && (id === 'mine' || id === 'follows')) continue;
    const items = [...buckets[id].values()];
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

function bookshelfChipHref(d: string, ownerNpub: string): string {
  return `/search?bookshelf=${encodeURIComponent(d)}&npub=${encodeURIComponent(ownerNpub)}`;
}

function humanizeBookshelfDTag(d: string): string {
  const parts = d.split('-').filter(Boolean);
  if (!parts.length) return d;
  return parts
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function bookshelfChipTitle(d: string, dir?: Event): string {
  if (d === MY_BOOK_COLLECTION_D_TAG) return 'My bookshelf';
  const titled = dir
    ? firstTag(dir, 'title')?.trim() || directoryExplorerTitle(dir).trim()
    : '';
  // Explorer falls back to the raw d-tag — humanize that for chip labels.
  if (titled && titled !== d) return titled;
  return humanizeBookshelfDTag(d);
}

/**
 * Guides-style chips for an owner's directory folders (skips `/root`).
 * Prefer membership order under `my-book-collection` (plus "My bookshelf");
 * otherwise list every owned folder alphabetically.
 * NIP-09 tombstoned folders are omitted.
 */
export function bookshelfChipsFromDirectories(
  directories: Event[],
  ownerHex: string,
  ownerNpub: string
): LandingShelfChip[] {
  const pk = ownerHex.toLowerCase();
  const byD = new Map<string, Event>();
  for (const dir of directories) {
    if (dir.kind !== KIND.DIRECTORY) continue;
    if (dir.pubkey.toLowerCase() !== pk) continue;
    if (isEventDeleted(dir)) continue;
    const d = directoryDTag(dir);
    if (!d || d === ROOT_DIRECTORY_D_TAG) continue;
    const prev = byD.get(d);
    if (!prev || isNewerReplaceable(dir, prev)) byD.set(d, dir);
  }

  const collection = byD.get(MY_BOOK_COLLECTION_D_TAG);
  if (collection) {
    const chips: LandingShelfChip[] = [
      {
        d: MY_BOOK_COLLECTION_D_TAG,
        title: 'My bookshelf',
        href: bookshelfChipHref(MY_BOOK_COLLECTION_D_TAG, ownerNpub)
      }
    ];
    const seen = new Set<string>([MY_BOOK_COLLECTION_D_TAG]);
    for (const child of directoryChildrenFromEvent(collection)) {
      if (!child.isFolder || !child.identifier) continue;
      const d = child.identifier.trim();
      if (!d || seen.has(d) || isProtectedDirectoryDTag(d)) continue;
      const ev = byD.get(d);
      if (ev) {
        if (isEventDeleted(ev)) continue;
      } else if (isAddressDeleted(KIND.DIRECTORY, pk, d)) {
        continue;
      }
      seen.add(d);
      chips.push({
        d,
        title: bookshelfChipTitle(d, ev),
        href: bookshelfChipHref(d, ownerNpub)
      });
    }
    return chips;
  }

  const chips: LandingShelfChip[] = [];
  for (const [d, dir] of byD) {
    chips.push({
      d,
      title: bookshelfChipTitle(d, dir),
      href: bookshelfChipHref(d, ownerNpub)
    });
  }
  chips.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  return chips;
}

/**
 * @deprecated Prefer folding nested pubs into mine via {@link assignShelves}.
 * Kept for publication-interactions tests.
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
    if (!d || d === MY_BOOK_COLLECTION_D_TAG || d === ROOT_DIRECTORY_D_TAG) continue;
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

export { withBookmarkTag } from './bookmark-actions';
