import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import {
  MY_BOOK_COLLECTION_D_TAG,
  ROOT_DIRECTORY_D_TAG,
  directoryDTag,
  directoryEntryDisplayName
} from './bookshelf';
import { parseAddress, parseEventCoordinate } from './library-scope';
import { libraryDocumentPath, publicationPath } from './metadata';
import { firstTag } from './nostr/verify';
import { kindDescription } from './kind-label';

function npubPath(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey.toLowerCase());
  } catch {
    return pubkey.toLowerCase();
  }
}

export type DirectoryExplorerEntry = {
  /** Stable list key. */
  key: string;
  /** Folder = nested 30045; everything else is a file/reference. */
  role: 'folder' | 'file';
  /** Kind from `a` coordinate, or null for bare `e` tags. */
  kind: number | null;
  coordinate?: string;
  eventId?: string;
  relayHint?: string;
  /** Display name (tag label, title, d, or kind fallback). */
  label: string;
};

function isEventIdHex(value: string | undefined): boolean {
  return !!value && /^[0-9a-f]{64}$/i.test(value);
}

function isRelayUrl(value: string | undefined): boolean {
  return !!value && /^(wss?|https?):\/\//i.test(value);
}

/** Optional human label on an `a` / `e` tag (NKBIP-04), skipping relay and id fields. */
function tagHumanLabel(tag: string[]): string {
  if (tag[0] === 'a') {
    // a, coord, relay?, idOrLabel?, …label
    for (let i = tag.length - 1; i >= 2; i--) {
      const part = tag[i]?.trim();
      if (!part) continue;
      if (isRelayUrl(part) || isEventIdHex(part)) continue;
      return part;
    }
    return '';
  }
  if (tag[0] === 'e') {
    // e, id, relay?, pubkey?, label?
    for (let i = tag.length - 1; i >= 2; i--) {
      const part = tag[i]?.trim();
      if (!part) continue;
      if (isRelayUrl(part) || isEventIdHex(part)) continue;
      return part;
    }
  }
  return '';
}

function slugLabel(d: string): string {
  return d.replace(/-/g, ' ').trim() || d;
}

/**
 * Ordered children of a kind 30045 directory (NKBIP-04): every `a` / `e` tag.
 * Nested 30045s are folders; all other pointers are files/references.
 */
export function directoryExplorerEntries(dir: Pick<Event, 'tags'>): DirectoryExplorerEntry[] {
  const out: DirectoryExplorerEntry[] = [];
  let i = 0;
  for (const tag of dir.tags) {
    if (tag[0] === 'a' && tag[1]) {
      const coord = tag[1].trim();
      const parsed = parseEventCoordinate(coord);
      if (!parsed) continue;
      const isFolder = parsed.kind === KIND.DIRECTORY;
      const label =
        tagHumanLabel(tag) ||
        (parsed.d ? slugLabel(parsed.d) : '') ||
        kindDescription(parsed.kind);
      const eventId = isEventIdHex(tag[3])
        ? tag[3]!.toLowerCase()
        : isEventIdHex(tag[2])
          ? tag[2]!.toLowerCase()
          : undefined;
      const relayHint = isRelayUrl(tag[2]) ? tag[2] : undefined;
      out.push({
        key: `a:${i}:${coord}`,
        role: isFolder ? 'folder' : 'file',
        kind: parsed.kind,
        coordinate: coord,
        eventId,
        relayHint,
        label
      });
      i += 1;
      continue;
    }
    if (tag[0] === 'e' && tag[1] && isEventIdHex(tag[1])) {
      const eventId = tag[1].toLowerCase();
      const relayHint = isRelayUrl(tag[2]) ? tag[2] : undefined;
      const label = tagHumanLabel(tag) || `Note ${eventId.slice(0, 8)}…`;
      out.push({
        key: `e:${i}:${eventId}`,
        role: 'file',
        kind: null,
        eventId,
        relayHint,
        label
      });
      i += 1;
    }
  }
  return out;
}

/** Rank within one author's directories: `/root` first, then bookshelf, then others. */
export function directoryHomeRank(event: Pick<Event, 'tags'>): number {
  const d = directoryDTag(event);
  if (d === ROOT_DIRECTORY_D_TAG) return 0;
  if (d === MY_BOOK_COLLECTION_D_TAG) return 1;
  return 2;
}

/**
 * Sort directories by pubkey, with each author's `/root` first (then my-book-collection),
 * then newest within the same rank.
 */
export function compareDirectoryListing(a: Event, b: Event): number {
  const byPk = a.pubkey.toLowerCase().localeCompare(b.pubkey.toLowerCase());
  if (byPk !== 0) return byPk;
  const byHome = directoryHomeRank(a) - directoryHomeRank(b);
  if (byHome !== 0) return byHome;
  if (a.created_at !== b.created_at) return b.created_at - a.created_at;
  return a.id.localeCompare(b.id);
}

/** Display title for a directory (title tag, then known d-tags, then d / fallback). */
export function directoryExplorerTitle(event: Event): string {
  const d = directoryDTag(event);
  const titled = firstTag(event, 'title')?.trim();
  if (titled) return titled;
  if (d === MY_BOOK_COLLECTION_D_TAG) return 'My bookshelf';
  if (d === ROOT_DIRECTORY_D_TAG) return 'root';
  return (
    directoryEntryDisplayName({
      event,
      parentD: d
    }) || 'Directory'
  );
}

/** Non-folder children vs nested 30045 folders. */
export function directoryChildCounts(dir: Pick<Event, 'tags'>): {
  events: number;
  folders: number;
} {
  let events = 0;
  let folders = 0;
  for (const entry of directoryExplorerEntries(dir)) {
    if (entry.role === 'folder') folders += 1;
    else events += 1;
  }
  return { events, folders };
}

export type DirectoryGmtParts = {
  /** `Mo dd.mm.yyyy` */
  date: string;
  /** `hh:mm:ss GMT` */
  time: string;
};

/**
 * Directory listing stamp parts (weekday in English two-letter form, UTC clock).
 * UI stacks date above time to save horizontal space.
 */
export function formatDirectoryGmtParts(createdAtSec: number): DirectoryGmtParts | null {
  if (!Number.isFinite(createdAtSec) || createdAtSec <= 0) return null;
  const d = new Date(createdAtSec * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const wd = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d.getUTCDay()] ?? '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return {
    date: `${wd} ${dd}.${mm}.${yyyy}`,
    time: `${hh}:${min}:${ss} GMT`
  };
}

/** Single-line stamp: `Mo dd.mm.yyyy hh:mm:ss GMT`. */
export function formatDirectoryGmt(createdAtSec: number): string {
  const parts = formatDirectoryGmtParts(createdAtSec);
  if (!parts) return '';
  return `${parts.date} ${parts.time}`;
}

/** Unix-style path segment for a directory (`root`, `my-book-collection`, …). */
export function directoryPathSegment(event: Event): string {
  return directoryDTag(event) || event.id.slice(0, 8);
}

/** In-app hash path when a resolved child event is available. */
export function directoryChildHref(event: Event): string | null {
  if (event.kind === KIND.DIRECTORY) return null;
  if (event.kind === KIND.PUBLICATION || event.kind === KIND.SECTION) {
    return `#${publicationPath(event)}`;
  }
  if (
    event.kind === KIND.WIKI ||
    event.kind === KIND.SPEC ||
    event.kind === KIND.LONG_FORM
  ) {
    return `#${libraryDocumentPath(event)}`;
  }
  if (event.kind === KIND.METADATA) {
    return `#/p/${event.pubkey}`;
  }
  if (event.id) return `#/feed?thread=${event.id}`;
  return null;
}

/** Fallback href from an unresolved `a` coordinate. */
export function directoryCoordinateHref(coordinate: string): string | null {
  const parsed = parseAddress(coordinate) ?? parseEventCoordinate(coordinate);
  if (!parsed) return null;
  if (parsed.kind === KIND.DIRECTORY) return null;
  const npub = npubPath(parsed.pubkey);
  if (parsed.kind === KIND.PUBLICATION || parsed.kind === KIND.SECTION) {
    return `#/publication/d/${encodeURIComponent(parsed.d)}/p/${npub}`;
  }
  if (parsed.kind === KIND.WIKI) {
    return `#/wiki/d/${encodeURIComponent(parsed.d)}/p/${npub}`;
  }
  if (parsed.kind === KIND.SPEC) {
    return `#/spec/d/${encodeURIComponent(parsed.d)}/p/${npub}`;
  }
  if (parsed.kind === KIND.LONG_FORM) {
    return `#/article/d/${encodeURIComponent(parsed.d)}/p/${npub}`;
  }
  if (parsed.kind === KIND.METADATA) return `#/p/${npub}`;
  return null;
}

/** External / referenced resources vs Nostr-native library events (NKBIP-04). */
export function directoryEntryIconClass(entry: DirectoryExplorerEntry): string {
  if (entry.role === 'folder') return 'is-folder';
  if (entry.kind === 1063) return 'is-external';
  if (entry.kind === KIND.WEB_BOOKMARK) return 'is-link';
  return 'is-file';
}

export function directoryEntryKindLine(entry: DirectoryExplorerEntry): string {
  if (entry.role === 'folder') return 'Folder';
  if (entry.kind == null) return 'Event';
  if (entry.kind === 1063) return 'File';
  if (entry.kind === KIND.WEB_BOOKMARK) return 'Bookmark';
  return kindDescription(entry.kind);
}

export function directoryHasChildren(dir: Pick<Event, 'tags'>): boolean {
  return directoryExplorerEntries(dir).length > 0;
}

export function directoryTitleTag(event: Pick<Event, 'tags'>): string {
  return firstTag(event as Event, 'title')?.trim() || '';
}
