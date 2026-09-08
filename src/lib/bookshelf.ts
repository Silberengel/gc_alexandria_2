import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { normalizeDTag } from './dtag';
import { eventAddress, firstTag } from './nostr/verify';
import { parseAddress } from './library-scope';

/** Android Bookshelf My Books replaceable `d` tag. */
export const MY_BOOK_COLLECTION_D_TAG = 'my-book-collection';

/** Android BookshelfDirectoryRules max `a`/`e` children. */
export const MAX_BOOKSHELF_DIRECTORY_ITEMS = 500;

export const MAX_BOOKSHELF_DEPTH = 8;

const ALLOWED_BOOKSHELF_TAG_NAMES = new Set(['d', 'a', 'e']);

function isEventIdHex(value: string | undefined): boolean {
  return !!value && /^[0-9a-f]{64}$/i.test(value);
}

function isRelayUrl(value: string | undefined): boolean {
  return !!value && /^(wss?|https?):\/\//i.test(value);
}

/** NIP-54 style slug for a new nested bookshelf `d` tag. */
export function slugifyBookshelfDTag(name: string): string {
  return normalizeDTag(name.trim()) || 'bookshelf';
}

export function bookshelfPublicationCoordinate(
  publication: Pick<Event, 'kind' | 'pubkey' | 'tags'>
): string {
  return eventAddress(publication as Event);
}

/**
 * Android-safe `a` tag: coordinate, optional relay (may be empty), 4th field = 64-hex event id.
 * No human label in the 4th field.
 */
export function buildBookshelfMembershipATag(
  target: Pick<Event, 'id' | 'kind' | 'pubkey' | 'tags'>,
  relayHint = ''
): string[] {
  const coordinate = bookshelfPublicationCoordinate(target);
  const relay = relayHint.trim();
  const id = isEventIdHex(target.id) ? target.id.toLowerCase() : '';
  return ['a', coordinate, relay, id];
}

export function assertAndroidSafeBookshelfTags(tags: readonly string[][]): boolean {
  if (!tags.some((t) => t[0] === 'd' && typeof t[1] === 'string' && t[1].length > 0)) return false;
  let items = 0;
  for (const tag of tags) {
    const name = tag[0];
    if (!name || !ALLOWED_BOOKSHELF_TAG_NAMES.has(name)) return false;
    if (name === 'a' || name === 'e') {
      items += 1;
      if (items > MAX_BOOKSHELF_DIRECTORY_ITEMS) return false;
    }
    if (name === 'a') {
      const fourth = tag[3]?.trim();
      if (fourth && !isEventIdHex(fourth) && !isRelayUrl(fourth)) return false;
    }
  }
  return true;
}

function filterAndroidSafeTags(tags: readonly string[][]): string[][] {
  return tags
    .filter((t) => t[0] && ALLOWED_BOOKSHELF_TAG_NAMES.has(t[0]))
    .map((t) => {
      if (t[0] !== 'a') return [...t];
      const coordinate = t[1] ?? '';
      const relay = isRelayUrl(t[2]) ? t[2]! : '';
      const id = isEventIdHex(t[3])
        ? t[3]!.toLowerCase()
        : isEventIdHex(t[2])
          ? t[2]!.toLowerCase()
          : '';
      return ['a', coordinate, relay, id];
    });
}

function membershipItemCount(tags: readonly string[][]): number {
  return tags.filter((t) => t[0] === 'a' || t[0] === 'e').length;
}

export function directoryContainsPublicationCoordinate(
  directory: Pick<Event, 'tags'>,
  coordinate: string
): boolean {
  const needle = coordinate.trim();
  if (!needle) return false;
  return directory.tags.some((t) => t[0] === 'a' && (t[1]?.trim() ?? '') === needle);
}

export function directoryContainsPublication(
  directory: Pick<Event, 'tags'>,
  publication: Pick<Event, 'kind' | 'pubkey' | 'tags' | 'id'>
): boolean {
  const coordinate = bookshelfPublicationCoordinate(publication);
  if (directoryContainsPublicationCoordinate(directory, coordinate)) return true;
  const id = publication.id?.toLowerCase();
  if (!id) return false;
  return directory.tags.some(
    (t) =>
      (t[0] === 'e' && t[1]?.toLowerCase() === id) ||
      (t[0] === 'a' && t[3]?.toLowerCase() === id)
  );
}

export type ToggleBookshelfMembershipResult =
  | { ok: true; tags: string[][]; added: boolean }
  | { ok: false; error: 'full' };

/**
 * Toggle a publication (or nested 30045) `a` tag on an existing directory's tags.
 * Preserves Android allowlist only (`d`/`a`/`e`).
 */
export function togglePublicationInDirectoryTags(
  existing: Pick<Event, 'tags'> | null | undefined,
  d: string,
  membershipTarget: Pick<Event, 'id' | 'kind' | 'pubkey' | 'tags'>,
  relayHint = ''
): ToggleBookshelfMembershipResult {
  const dTag = d.trim() || MY_BOOK_COLLECTION_D_TAG;
  const coordinate = bookshelfPublicationCoordinate(membershipTarget);
  const base = filterAndroidSafeTags(existing?.tags ?? []);
  const withoutD = base.filter((t) => t[0] !== 'd');
  const withoutTarget = withoutD.filter((t) => {
    if (t[0] === 'a' && (t[1]?.trim() ?? '') === coordinate) return false;
    if (
      t[0] === 'e' &&
      isEventIdHex(membershipTarget.id) &&
      t[1]?.toLowerCase() === membershipTarget.id.toLowerCase()
    ) {
      return false;
    }
    return true;
  });
  const already = withoutD.length !== withoutTarget.length;
  if (already) {
    return { ok: true, tags: [['d', dTag], ...withoutTarget], added: false };
  }
  if (membershipItemCount(withoutTarget) >= MAX_BOOKSHELF_DIRECTORY_ITEMS) {
    return { ok: false, error: 'full' };
  }
  const aTag = buildBookshelfMembershipATag(membershipTarget, relayHint);
  return { ok: true, tags: [['d', dTag], ...withoutTarget, aTag], added: true };
}

export function directoryDraft(
  tags: string[][],
  content = ''
): { kind: number; content: string; tags: string[][] } {
  return { kind: KIND.DIRECTORY, content, tags };
}

export function createBookshelfDirectoryDraft(
  existing: Pick<Event, 'tags'> | null | undefined,
  d: string,
  membershipTarget: Pick<Event, 'id' | 'kind' | 'pubkey' | 'tags'>,
  relayHint = ''
): { kind: number; content: string; tags: string[][] } | { error: 'full' } {
  const toggled = togglePublicationInDirectoryTags(existing, d, membershipTarget, relayHint);
  if (!toggled.ok) return { error: 'full' };
  return directoryDraft(toggled.tags);
}

/** Empty nested shelf (no title — Android rejects it). */
export function createEmptyBookshelfDirectoryDraft(
  d: string
): { kind: number; content: string; tags: string[][] } {
  const dTag = slugifyBookshelfDTag(d);
  return directoryDraft([['d', dTag]]);
}

export function directoryDTag(event: Pick<Event, 'tags'>): string {
  return firstTag(event as Event, 'd')?.trim() || '';
}

export function directoryCoordinateFromEvent(
  event: Pick<Event, 'kind' | 'pubkey' | 'tags'>
): string {
  return eventAddress(event as Event);
}

export type DirectoryChildRef = {
  coordinate: string;
  identifier: string;
  isFolder: boolean;
  parentLabel?: string;
  parentD?: string;
};

/** Children of a 30045: nested directories (kind 30045) and publication memberships. */
export function directoryChildrenFromEvent(dir: Pick<Event, 'tags'>): DirectoryChildRef[] {
  const out: DirectoryChildRef[] = [];
  for (const tag of dir.tags) {
    if (tag[0] !== 'a' || !tag[1]) continue;
    const parsed = parseAddress(tag[1]);
    if (!parsed) continue;
    const isFolder = parsed.kind === KIND.DIRECTORY;
    out.push({
      coordinate: tag[1],
      identifier: parsed.d,
      isFolder,
      parentD: parsed.d
    });
  }
  return out;
}

export function directoryEntryDisplayName(opts: {
  event?: Pick<Event, 'tags'> | null;
  parentLabel?: string;
  parentD?: string;
}): string {
  const title = opts.event ? firstTag(opts.event as Event, 'title')?.trim() : undefined;
  if (title) return title;
  const label = opts.parentLabel?.trim();
  if (label) return label;
  const d = opts.parentD?.trim() || (opts.event ? directoryDTag(opts.event) : undefined);
  if (d) return d;
  return '';
}

export type BookshelfShelfOption = {
  coordinate: string;
  d: string;
  depth: number;
  label: string;
  event?: Event;
  isRoot: boolean;
};

/** Root first, then nested 30045 folders (depth-limited). */
export function listBookshelfShelfOptions(
  root: Event | null | undefined,
  resolveDirectory: (coordinate: string) => Event | undefined,
  maxDepth = MAX_BOOKSHELF_DEPTH
): BookshelfShelfOption[] {
  if (!root || root.kind !== KIND.DIRECTORY) return [];
  const rootCoord = directoryCoordinateFromEvent(root);
  const rootD = directoryDTag(root) || MY_BOOK_COLLECTION_D_TAG;
  const out: BookshelfShelfOption[] = [
    {
      coordinate: rootCoord,
      d: rootD,
      depth: 0,
      label: rootD === MY_BOOK_COLLECTION_D_TAG ? 'My bookshelf' : directoryEntryDisplayName({
        event: root,
        parentD: rootD
      }),
      event: root,
      isRoot: true
    }
  ];
  const walk = (dir: Event, depth: number, path: Set<string>) => {
    if (depth >= maxDepth) return;
    for (const child of directoryChildrenFromEvent(dir)) {
      if (!child.isFolder || !child.coordinate) continue;
      if (path.has(child.coordinate)) continue;
      const nested = resolveDirectory(child.coordinate);
      const d = child.identifier || directoryDTag(nested ?? { tags: [] }) || child.coordinate;
      out.push({
        coordinate: child.coordinate,
        d,
        depth,
        label:
          directoryEntryDisplayName({
            event: nested,
            parentLabel: child.parentLabel,
            parentD: child.parentD || d
          }) || d,
        event: nested,
        isRoot: false
      });
      if (nested) {
        const nextPath = new Set(path);
        nextPath.add(child.coordinate);
        walk(nested, depth + 1, nextPath);
      }
    }
  };
  walk(root, 1, new Set([rootCoord]));
  return out;
}

/** Publication coordinates targeted by a 30045 directory (non-folder `a` tags + `e`). */
export function publicationTargetsFromDirectory(event: Event): {
  addresses: string[];
  eventIds: string[];
} {
  const addresses: string[] = [];
  const eventIds: string[] = [];
  const seenA = new Set<string>();
  const seenE = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] === 'a' && tag[1]) {
      const parsed = parseAddress(tag[1]);
      if (parsed?.kind === KIND.PUBLICATION && !seenA.has(tag[1])) {
        seenA.add(tag[1]);
        addresses.push(tag[1]);
      }
    }
    if (tag[0] === 'e' && tag[1] && isEventIdHex(tag[1])) {
      const id = tag[1].toLowerCase();
      if (!seenE.has(id)) {
        seenE.add(id);
        eventIds.push(id);
      }
    }
  }
  return { addresses, eventIds };
}

/**
 * Wipe-guard: do not publish a replacement until the existing replaceable is known
 * (loaded) or confirmed missing (`confirmedMissing`). Nested toggles must require a
 * loaded event; only addNewBookshelf creates new nested directories.
 */
export function canPublishBookshelfReplacement(
  existing: Event | null | undefined,
  confirmedMissing: boolean
): boolean {
  if (existing) return true;
  return confirmedMissing;
}
