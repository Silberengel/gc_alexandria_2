import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  DIRECTORY_HOME_D_TAGS,
  MY_BOOK_COLLECTION_D_TAG,
  ROOT_DIRECTORY_D_TAG,
  allocateUniqueFolderDTag,
  canPublishBookshelfReplacement,
  createBookshelfDirectoryDraft,
  createBookshelfDirectoryDraftParts,
  createEmptyBookshelfDirectoryDraft,
  directoryContainsPublication,
  directoryCoordinateFromEvent,
  directoryDraft,
  directoryDTag,
  isProtectedDirectoryDTag,
  listBookshelfShelfOptions,
  membershipTargetFromRef,
  rewriteDirectoryDTag,
  slugifyBookshelfDTag,
  type BookshelfShelfOption
} from './bookshelf';
import { deletionDraft } from './drafts';
import { rememberDeletedTarget } from './deletions';
import { documentStack } from './nostr/selector';
import { relayPool } from './nostr/pool';
import { memoryFindByAddress, rememberEvents } from './nostr/event-memory';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { cacheDeleteEvent } from './nostr/cache';
import { SessionTtlCache } from './session-ttl-cache';
import { contentForPrivateTags, decryptPrivateTagsDetailed } from './private-tags';
import { signAndPublish, type PublishFeedbackOpts } from './sign';

/** Bookshelf flows toast once at the UI layer (DirectoryBrowser / callers). */
const QUIET: PublishFeedbackOpts = { quiet: true };

const directoryPrivateCache = new SessionTtlCache<{
  tags: string[][];
  couldDecrypt: boolean;
  content: string;
}>(5 * 60 * 1000, 120);

async function loadDirectoryPrivateTags(
  event: Event | null | undefined
): Promise<{ tags: string[][]; couldDecrypt: boolean; content: string }> {
  if (!event) return { tags: [], couldDecrypt: true, content: '' };
  const key = `priv:${event.id}`;
  return directoryPrivateCache.getOrLoad(key, async () => {
    const detailed = await decryptPrivateTagsDetailed(event);
    return {
      tags: detailed.tags,
      couldDecrypt: detailed.couldDecrypt,
      content: event.content ?? ''
    };
  });
}

async function publishDirectoryParts(
  parts: { kind: number; tags: string[][]; privateTags: string[][] },
  previous: Event | null | undefined
): Promise<Event | null> {
  const prevPriv = previous ? await loadDirectoryPrivateTags(previous) : null;
  let content = '';
  try {
    content = await contentForPrivateTags({
      privateTags: parts.privateTags,
      previousContent: previous?.content ?? '',
      couldDecryptPrevious: prevPriv?.couldDecrypt ?? true
    });
  } catch {
    return null;
  }
  const published = await signAndPublish(
    { kind: parts.kind, content, tags: parts.tags },
    QUIET
  );
  if (published) {
    directoryPrivateCache.set(`priv:${published.id}`, {
      tags: parts.privateTags,
      couldDecrypt: true,
      content: published.content ?? ''
    });
  }
  return published;
}

/** Replaceable directory lookups — avoid re-REQ on every Directory/bookshelf open. */
const directoryByDCache = new SessionTtlCache<Event | null>(5 * 60 * 1000, 120);

function directoryCacheKey(pubkey: string, d: string): string {
  return `dir:${pubkey.toLowerCase()}:${d}`;
}

async function fetchDirectoryByD(pubkey: string, d: string): Promise<Event | null> {
  const pk = pubkey.toLowerCase();
  const key = directoryCacheKey(pk, d);
  const warm = memoryFindByAddress(KIND.DIRECTORY, pk, d);
  if (warm) {
    directoryByDCache.set(key, warm);
    return warm;
  }
  return directoryByDCache.getOrLoad(key, async () => {
    const filter = { kinds: [KIND.DIRECTORY], authors: [pk], '#d': [d], limit: 1 };
    const hits = await relayPool.query(documentStack(), [filter], 8000, 4, undefined, {
      priority: true,
      includeCooling: true
    });
    const hit = hits[0] ?? null;
    if (hit) rememberEvents([hit]);
    return hit;
  });
}

/**
 * Fetch another (or your own) user's `/root` directory without minting missing
 * folders. Used for read-only Directory browsing by npub/hex.
 */
export async function loadUserDirectoryRoot(pubkey: string): Promise<Event | null> {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return null;
  const root = await fetchDirectoryByD(pk, ROOT_DIRECTORY_D_TAG);
  if (root) rememberEvents([root]);
  return root;
}

export type UserHomeDirectories = {
  /** Kind 30045 with `d=root`. */
  root: Event;
  /** Kind 30045 with `d=my-book-collection`. */
  books: Event;
  /** Other directories owned by the user (latest per d). */
  others: Event[];
};

const homeDirectoriesCache = new SessionTtlCache<UserHomeDirectories>(5 * 60 * 1000, 8);

function invalidateDirectoryCaches(pubkey: string): void {
  const pk = pubkey.toLowerCase();
  directoryByDCache.invalidate(`dir:${pk}:`);
  homeDirectoriesCache.invalidate(`home:${pk}`);
  directoryPrivateCache.invalidate('priv:');
}

/**
 * Load the viewer's directories and mint `/root` plus `/root/my-book-collection`
 * when either is missing (empty 30045, Android-safe: no title tag). Always nests
 * `my-book-collection` under `root` so `/root` stays the filesystem top.
 */
export async function ensureUserHomeDirectories(pubkey: string): Promise<UserHomeDirectories> {
  const pk = pubkey.toLowerCase();
  return homeDirectoriesCache.getOrLoad(`home:${pk}`, () => ensureUserHomeDirectoriesUncached(pk));
}

async function ensureUserHomeDirectoriesUncached(pk: string): Promise<UserHomeDirectories> {
  const hits = await relayPool.query(
    documentStack(),
    [{ kinds: [KIND.DIRECTORY], authors: [pk], limit: 80 }],
    5000,
    4,
    undefined,
    { priority: true, includeCooling: true }
  );
  rememberEvents(hits);
  const latest = pruneToLatestReplaceables(hits).filter((e) => e.kind === KIND.DIRECTORY);
  const byD = new Map<string, Event>();
  for (const ev of latest) {
    const d = directoryDTag(ev);
    if (d) {
      byD.set(d, ev);
      directoryByDCache.set(directoryCacheKey(pk, d), ev);
    }
  }

  async function ensureD(d: string): Promise<Event> {
    const existing = byD.get(d) ?? (await fetchDirectoryByD(pk, d));
    if (existing) {
      byD.set(d, existing);
      return existing;
    }
    const published = await signAndPublish(createEmptyBookshelfDirectoryDraft(d), QUIET);
    if (!published) {
      throw new Error(`Could not create /${d}`);
    }
    rememberEvents([published]);
    byD.set(d, published);
    directoryByDCache.set(directoryCacheKey(pk, d), published);
    return published;
  }

  let root = await ensureD(ROOT_DIRECTORY_D_TAG);
  const books = await ensureD(MY_BOOK_COLLECTION_D_TAG);

  // `/root` is always the filesystem top: nest my-book-collection under it when missing.
  if (!directoryContainsPublication(root, books)) {
    const draft = createBookshelfDirectoryDraft(root, ROOT_DIRECTORY_D_TAG, books);
    if (!('error' in draft)) {
      const published = await signAndPublish(draft, QUIET);
      if (published) {
        rememberEvents([published]);
        byD.set(ROOT_DIRECTORY_D_TAG, published);
        directoryByDCache.set(directoryCacheKey(pk, ROOT_DIRECTORY_D_TAG), published);
        root = published;
      }
    }
  }

  const home = new Set<string>(DIRECTORY_HOME_D_TAGS);
  const others = [...byD.values()]
    .filter((e) => !home.has(directoryDTag(e)))
    .sort((a, b) => b.created_at - a.created_at);

  return { root, books, others };
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
  await Promise.all(
    shelves.map(async (shelf) => {
      const ev = shelf.event ?? resolve(shelf.coordinate);
      if (!ev) return;
      const priv = await loadDirectoryPrivateTags(ev);
      if (directoryContainsPublication(ev, publication, priv.tags)) {
        membershipCoords.add(shelf.coordinate);
      }
    })
  );
  return { root, nestedByCoord, shelves, membershipCoords, rootConfirmed: true };
}

export async function toggleBookshelfShelf(
  pubkey: string,
  publication: Event,
  shelf: BookshelfShelfOption,
  state: BookshelfState,
  opts?: { private?: boolean }
): Promise<BookshelfState | { error: string }> {
  const existing =
    shelf.event ??
    (shelf.isRoot ? state.root : state.nestedByCoord.get(shelf.coordinate)) ??
    (await fetchDirectoryByD(pubkey, shelf.d));

  if (shelf.isRoot) {
    // Root may be created on first add once load confirmed it missing.
    if (!canPublishBookshelfReplacement(existing ?? state.root, state.rootConfirmed)) {
      return { error: 'Bookshelf not ready' };
    }
  } else if (!existing) {
    // Nested toggle must replace a loaded directory; new folders use addNewBookshelf only.
    // Publishing with existing=null would mint a sparse 30045 and can wipe unseen memberships.
    return { error: 'Bookshelf not ready' };
  }

  const existingPriv = await loadDirectoryPrivateTags(existing);
  const wasMember = directoryContainsPublication(existing ?? { tags: [] }, publication, existingPriv.tags);
  const parts = createBookshelfDirectoryDraftParts(
    existing,
    existingPriv.tags,
    shelf.d || MY_BOOK_COLLECTION_D_TAG,
    publication,
    { addAsPrivate: !wasMember && opts?.private === true }
  );
  if ('error' in parts) return { error: 'Bookshelf is full' };
  const published = await publishDirectoryParts(parts, existing);
  if (!published) return { error: 'Publish failed' };
  invalidateDirectoryCaches(pubkey);
  directoryByDCache.set(directoryCacheKey(pubkey, directoryDTag(published) || shelf.d), published);

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
    if (!ev) continue;
    const priv =
      ev.id === published.id
        ? { tags: parts.privateTags }
        : await loadDirectoryPrivateTags(ev);
    if (directoryContainsPublication(ev, publication, priv.tags)) {
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
  const nested = await signAndPublish(emptyDraft, QUIET);
  if (!nested) return { error: 'Publish failed' };

  let rootEv = state.root ?? (await fetchDirectoryByD(pubkey, MY_BOOK_COLLECTION_D_TAG));
  const linkDraft = createBookshelfDirectoryDraft(rootEv, MY_BOOK_COLLECTION_D_TAG, nested);
  if ('error' in linkDraft) return { error: 'Bookshelf is full' };
  rootEv = await signAndPublish(linkDraft, QUIET);
  if (!rootEv) return { error: 'Publish failed' };

  const withBook = createBookshelfDirectoryDraft(
    nested,
    directoryDTag(nested) || d,
    publication
  );
  let updatedNested = nested;
  if (!('error' in withBook)) {
    const published = await signAndPublish(withBook, QUIET);
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
  invalidateDirectoryCaches(pubkey);
  directoryByDCache.set(directoryCacheKey(pubkey, MY_BOOK_COLLECTION_D_TAG), rootEv);
  directoryByDCache.set(directoryCacheKey(pubkey, directoryDTag(updatedNested) || d), updatedNested);
  return {
    root: rootEv,
    nestedByCoord,
    shelves,
    membershipCoords,
    rootConfirmed: true
  };
}

/** Latest owned kind-30045 directories for the viewer (for Add to folder pickers). */
export async function listOwnedDirectories(pubkey: string): Promise<Event[]> {
  const pk = pubkey.toLowerCase();
  const hits = await relayPool.query(
    documentStack(),
    [{ kinds: [KIND.DIRECTORY], authors: [pk], limit: 120 }],
    5000
  );
  rememberEvents(hits);
  return pruneToLatestReplaceables(hits)
    .filter((e) => e.kind === KIND.DIRECTORY)
    .sort((a, b) => {
      const da = directoryDTag(a);
      const db = directoryDTag(b);
      if (da === ROOT_DIRECTORY_D_TAG) return -1;
      if (db === ROOT_DIRECTORY_D_TAG) return 1;
      if (da === MY_BOOK_COLLECTION_D_TAG) return -1;
      if (db === MY_BOOK_COLLECTION_D_TAG) return 1;
      return b.created_at - a.created_at;
    });
}

/**
 * Create an empty nested folder under `parent` and link it (Android-safe tags).
 * Replaces the parent 30045 with the new membership.
 */
export async function createFolderInParent(
  parent: Event,
  name: string,
  occupiedDTags: Iterable<string> = []
): Promise<{ folder: Event; parent: Event } | { error: string }> {
  if (parent.kind !== KIND.DIRECTORY) return { error: 'Not a folder' };
  const d = allocateUniqueFolderDTag(name, occupiedDTags);
  if (!d) return { error: 'Invalid folder name' };
  if (!canPublishBookshelfReplacement(parent, false)) {
    return { error: 'Folder not ready' };
  }

  const nested = await signAndPublish(createEmptyBookshelfDirectoryDraft(d), QUIET);
  if (!nested) return { error: 'Could not create folder' };

  const linkDraft = createBookshelfDirectoryDraft(
    parent,
    directoryDTag(parent) || ROOT_DIRECTORY_D_TAG,
    nested
  );
  if ('error' in linkDraft) return { error: 'Folder is full' };
  const nextParent = await signAndPublish(linkDraft, QUIET);
  if (!nextParent) return { error: 'Could not link folder' };
  rememberEvents([nested, nextParent]);
  invalidateDirectoryCaches(parent.pubkey);
  directoryByDCache.set(directoryCacheKey(parent.pubkey, directoryDTag(nested) || d), nested);
  directoryByDCache.set(
    directoryCacheKey(parent.pubkey, directoryDTag(nextParent) || ROOT_DIRECTORY_D_TAG),
    nextParent
  );
  return { folder: nested, parent: nextParent };
}

/** Add (or no-op if already present) a member event under `parent`. */
export async function addMemberToDirectory(
  parent: Event,
  member: Event,
  opts?: { private?: boolean }
): Promise<Event | { error: string }> {
  if (parent.kind !== KIND.DIRECTORY) return { error: 'Not a folder' };
  if (
    member.kind === KIND.DIRECTORY &&
    directoryCoordinateFromEvent(parent) === directoryCoordinateFromEvent(member)
  ) {
    return { error: 'Cannot add a folder to itself' };
  }
  const existingPriv = await loadDirectoryPrivateTags(parent);
  if (directoryContainsPublication(parent, member, existingPriv.tags)) return parent;
  if (!canPublishBookshelfReplacement(parent, false)) {
    return { error: 'Folder not ready' };
  }
  const parts = createBookshelfDirectoryDraftParts(
    parent,
    existingPriv.tags,
    directoryDTag(parent) || ROOT_DIRECTORY_D_TAG,
    member,
    { addAsPrivate: opts?.private === true && member.kind !== KIND.DIRECTORY }
  );
  if ('error' in parts) return { error: 'Folder is full' };
  const published = await publishDirectoryParts(parts, parent);
  if (!published) return { error: 'Publish failed' };
  rememberEvents([published]);
  invalidateDirectoryCaches(parent.pubkey);
  directoryByDCache.set(
    directoryCacheKey(parent.pubkey, directoryDTag(published) || ROOT_DIRECTORY_D_TAG),
    published
  );
  return published;
}

/** Remove a member (by event or coordinate/id ref) from `parent`. */
export async function removeMemberFromDirectory(
  parent: Event,
  memberRef: {
    coordinate?: string;
    eventId?: string;
    event?: Event | null;
  }
): Promise<Event | { error: string }> {
  if (parent.kind !== KIND.DIRECTORY) return { error: 'Not a folder' };
  const target = membershipTargetFromRef(memberRef);
  if (!target) return { error: 'Nothing to remove' };
  if (!canPublishBookshelfReplacement(parent, false)) {
    return { error: 'Folder not ready' };
  }
  const existingPriv = await loadDirectoryPrivateTags(parent);
  if (!directoryContainsPublication(parent, target, existingPriv.tags)) {
    return parent;
  }
  const parts = createBookshelfDirectoryDraftParts(
    parent,
    existingPriv.tags,
    directoryDTag(parent) || ROOT_DIRECTORY_D_TAG,
    target
  );
  if ('error' in parts) return { error: 'Folder is full' };
  const published = await publishDirectoryParts(parts, parent);
  if (!published) return { error: 'Publish failed' };
  rememberEvents([published]);
  invalidateDirectoryCaches(parent.pubkey);
  directoryByDCache.set(
    directoryCacheKey(parent.pubkey, directoryDTag(published) || ROOT_DIRECTORY_D_TAG),
    published
  );
  return published;
}

/** Decrypt private membership tags for an owned directory (cached). */
export async function directoryPrivateMembershipTags(
  event: Event | null | undefined
): Promise<string[][]> {
  const loaded = await loadDirectoryPrivateTags(event);
  return loaded.tags;
}

/**
 * Unlink `folder` from `parent`, then NIP-09 delete the folder replaceable
 * (unless it is a protected home d-tag).
 */
export async function deleteFolderFromParent(
  parent: Event,
  folder: Event
): Promise<{ parent: Event } | { error: string }> {
  if (parent.kind !== KIND.DIRECTORY || folder.kind !== KIND.DIRECTORY) {
    return { error: 'Not a folder' };
  }
  const folderD = directoryDTag(folder);
  if (isProtectedDirectoryDTag(folderD) || directoryDTag(parent) === folderD) {
    return { error: 'That system folder cannot be deleted' };
  }
  if (parent.pubkey.toLowerCase() !== folder.pubkey.toLowerCase()) {
    return { error: 'You can only delete your own folders' };
  }

  const unlinked = await removeMemberFromDirectory(parent, { event: folder });
  if ('error' in unlinked) return unlinked;

  const deleted = await signAndPublish(deletionDraft(folder), QUIET);
  if (deleted) {
    rememberDeletedTarget(folder, deleted);
    void cacheDeleteEvent(folder.id).catch(() => {});
  }
  invalidateDirectoryCaches(parent.pubkey);
  directoryByDCache.set(
    directoryCacheKey(parent.pubkey, directoryDTag(unlinked) || ROOT_DIRECTORY_D_TAG),
    unlinked
  );
  return { parent: unlinked };
}

/**
 * Rename a nested folder: publish a new d-tag with the same children, relink
 * the parent once, then NIP-09 the old replaceable (replaceable rewrite).
 */
export async function renameFolderInParent(
  parent: Event,
  folder: Event,
  newName: string,
  occupiedDTags: Iterable<string> = []
): Promise<{ folder: Event; parent: Event } | { error: string }> {
  if (parent.kind !== KIND.DIRECTORY || folder.kind !== KIND.DIRECTORY) {
    return { error: 'Not a folder' };
  }
  const folderD = directoryDTag(folder);
  if (isProtectedDirectoryDTag(folderD)) {
    return { error: 'That system folder cannot be renamed' };
  }
  if (parent.pubkey.toLowerCase() !== folder.pubkey.toLowerCase()) {
    return { error: 'You can only rename your own folders' };
  }
  if (!canPublishBookshelfReplacement(parent, false)) {
    return { error: 'Folder not ready' };
  }

  const nextD = allocateUniqueFolderDTag(
    newName,
    [...occupiedDTags].filter((d) => d.trim().toLowerCase() !== folderD.toLowerCase())
  );
  if (!nextD) return { error: 'Invalid folder name' };
  if (nextD === folderD) {
    return { folder, parent };
  }

  const rewritten = await signAndPublish(rewriteDirectoryDTag(folder, nextD), QUIET);
  if (!rewritten) return { error: 'Could not create renamed folder' };

  const parentD = directoryDTag(parent) || ROOT_DIRECTORY_D_TAG;
  const unlinked = togglePublicationInDirectoryTags(parent, parentD, folder);
  if (!unlinked.ok) return { error: 'Folder is full' };
  const relinked = togglePublicationInDirectoryTags({ tags: unlinked.tags }, parentD, rewritten);
  if (!relinked.ok) return { error: 'Folder is full' };
  const nextParent = await signAndPublish(directoryDraft(relinked.tags), QUIET);
  if (!nextParent) return { error: 'Could not update parent folder' };

  const deleted = await signAndPublish(deletionDraft(folder), QUIET);
  if (deleted) {
    rememberDeletedTarget(folder, deleted);
    void cacheDeleteEvent(folder.id).catch(() => {});
  }

  rememberEvents([rewritten, nextParent]);
  invalidateDirectoryCaches(parent.pubkey);
  directoryByDCache.set(directoryCacheKey(parent.pubkey, nextD), rewritten);
  directoryByDCache.set(
    directoryCacheKey(parent.pubkey, directoryDTag(nextParent) || ROOT_DIRECTORY_D_TAG),
    nextParent
  );
  return { folder: rewritten, parent: nextParent };
}
