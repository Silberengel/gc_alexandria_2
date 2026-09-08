import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  MY_BOOK_COLLECTION_D_TAG,
  canPublishBookshelfReplacement,
  createBookshelfDirectoryDraft,
  createEmptyBookshelfDirectoryDraft,
  directoryContainsPublication,
  directoryCoordinateFromEvent,
  directoryDTag,
  listBookshelfShelfOptions,
  slugifyBookshelfDTag,
  type BookshelfShelfOption
} from './bookshelf';
import { documentStack } from './nostr/selector';
import { mercuryFilter } from './nostr/mercury';
import { relayPool } from './nostr/pool';
import { signAndPublish } from './sign';

async function fetchDirectoryByD(pubkey: string, d: string): Promise<Event | null> {
  const filter = { kinds: [KIND.DIRECTORY], authors: [pubkey], '#d': [d], limit: 1 };
  const [m, w] = await Promise.all([
    mercuryFilter(filter),
    relayPool.query(documentStack(), [filter])
  ]);
  return m[0] ?? w[0] ?? null;
}

export type BookshelfState = {
  root: Event | null;
  nestedByCoord: Map<string, Event>;
  shelves: BookshelfShelfOption[];
  membershipCoords: Set<string>;
  /** True once we have queried root (even if missing). */
  rootConfirmed: boolean;
};

export async function loadBookshelfState(
  pubkey: string,
  publication: Event
): Promise<BookshelfState> {
  const root = await fetchDirectoryByD(pubkey, MY_BOOK_COLLECTION_D_TAG);
  const nestedByCoord = new Map<string, Event>();
  if (root) {
    const skeleton = listBookshelfShelfOptions(root, () => undefined);
    await Promise.all(
      skeleton
        .filter((o) => !o.isRoot)
        .map(async (o) => {
          const ev = await fetchDirectoryByD(pubkey, o.d);
          if (ev) nestedByCoord.set(o.coordinate, ev);
        })
    );
  }
  const resolve = (coordinate: string) => {
    if (root && directoryCoordinateFromEvent(root) === coordinate) return root;
    return nestedByCoord.get(coordinate);
  };
  const shelves = listBookshelfShelfOptions(root, resolve);
  const membershipCoords = new Set<string>();
  for (const shelf of shelves) {
    const ev = shelf.event ?? resolve(shelf.coordinate);
    if (ev && directoryContainsPublication(ev, publication)) {
      membershipCoords.add(shelf.coordinate);
    }
  }
  return { root, nestedByCoord, shelves, membershipCoords, rootConfirmed: true };
}

export async function toggleBookshelfShelf(
  pubkey: string,
  publication: Event,
  shelf: BookshelfShelfOption,
  state: BookshelfState
): Promise<BookshelfState | { error: string }> {
  if (!canPublishBookshelfReplacement(state.root, state.rootConfirmed) && shelf.isRoot) {
    return { error: 'Bookshelf not ready' };
  }
  const existing =
    shelf.event ??
    (shelf.isRoot ? state.root : state.nestedByCoord.get(shelf.coordinate)) ??
    (await fetchDirectoryByD(pubkey, shelf.d));
  if (!shelf.isRoot && !existing && !state.rootConfirmed) {
    return { error: 'Bookshelf not ready' };
  }
  if (
    !shelf.isRoot &&
    !canPublishBookshelfReplacement(existing, existing === null)
  ) {
    /* nested may be new via create path only */
  }
  const draft = createBookshelfDirectoryDraft(
    existing,
    shelf.d || MY_BOOK_COLLECTION_D_TAG,
    publication
  );
  if ('error' in draft) return { error: 'Bookshelf is full' };
  const published = await signAndPublish(draft);
  if (!published) return { error: 'Publish failed' };

  const next: BookshelfState = {
    root: state.root,
    nestedByCoord: new Map(state.nestedByCoord),
    shelves: state.shelves,
    membershipCoords: new Set(state.membershipCoords),
    rootConfirmed: true
  };
  if (shelf.isRoot || shelf.d === MY_BOOK_COLLECTION_D_TAG) {
    next.root = published;
  } else {
    next.nestedByCoord.set(directoryCoordinateFromEvent(published), published);
  }
  const resolve = (coordinate: string) => {
    if (next.root && directoryCoordinateFromEvent(next.root) === coordinate) return next.root;
    return next.nestedByCoord.get(coordinate);
  };
  next.shelves = listBookshelfShelfOptions(next.root, resolve);
  next.membershipCoords = new Set();
  for (const s of next.shelves) {
    const ev = s.event ?? resolve(s.coordinate);
    if (ev && directoryContainsPublication(ev, publication)) {
      next.membershipCoords.add(s.coordinate);
    }
  }
  return next;
}

export async function addNewBookshelf(
  pubkey: string,
  publication: Event,
  name: string,
  state: BookshelfState
): Promise<BookshelfState | { error: string }> {
  const d = slugifyBookshelfDTag(name);
  if (!d) return { error: 'Invalid bookshelf name' };
  if (!canPublishBookshelfReplacement(state.root, state.rootConfirmed)) {
    return { error: 'Bookshelf not ready' };
  }
  const emptyDraft = createEmptyBookshelfDirectoryDraft(d);
  const nested = await signAndPublish(emptyDraft);
  if (!nested) return { error: 'Publish failed' };

  let rootEv = state.root ?? (await fetchDirectoryByD(pubkey, MY_BOOK_COLLECTION_D_TAG));
  const linkDraft = createBookshelfDirectoryDraft(rootEv, MY_BOOK_COLLECTION_D_TAG, nested);
  if ('error' in linkDraft) return { error: 'Bookshelf is full' };
  rootEv = await signAndPublish(linkDraft);
  if (!rootEv) return { error: 'Publish failed' };

  const withBook = createBookshelfDirectoryDraft(
    nested,
    directoryDTag(nested) || d,
    publication
  );
  let updatedNested = nested;
  if (!('error' in withBook)) {
    const published = await signAndPublish(withBook);
    if (published) updatedNested = published;
  }

  const nestedByCoord = new Map(state.nestedByCoord);
  nestedByCoord.set(directoryCoordinateFromEvent(updatedNested), updatedNested);
  const resolve = (coordinate: string) => {
    if (directoryCoordinateFromEvent(rootEv!) === coordinate) return rootEv!;
    return nestedByCoord.get(coordinate);
  };
  const shelves = listBookshelfShelfOptions(rootEv, resolve);
  const membershipCoords = new Set<string>();
  for (const s of shelves) {
    const ev = s.event ?? resolve(s.coordinate);
    if (ev && directoryContainsPublication(ev, publication)) {
      membershipCoords.add(s.coordinate);
    }
  }
  return {
    root: rootEv,
    nestedByCoord,
    shelves,
    membershipCoords,
    rootConfirmed: true
  };
}
