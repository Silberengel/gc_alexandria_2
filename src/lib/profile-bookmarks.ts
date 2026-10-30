/**
 * Profile bookmarks: the standard kind-10003 list plus kind-30003 bookmark sets.
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { parseEventCoordinate } from './library-scope';
import { cropText } from './listing-table';
import { poolMap } from './nostr/fetch';
import { compareReplaceableNewestFirst, pruneToLatestReplaceables } from './nostr/replaceable';
import { firstTag } from './nostr/verify';
import {
  decryptPrivateTags,
  looksLikeNip04Ciphertext,
  looksLikeNip44Ciphertext
} from './private-tags';

export const PROFILE_BOOKMARKS_SEGMENT = 'bookmarks';

/** Published-order items shown per list before the rest are omitted. */
export const PROFILE_BOOKMARK_ITEM_LIMIT = 48;

/** Event and address pointers fetched per list. Further pointers count as omitted. */
export const PROFILE_BOOKMARK_FETCH_LIMIT = 40;

const DESCRIPTION_MAX = 280;

export function isProfileBookmarksSegment(raw: string | undefined | null): boolean {
  return (raw ?? '').trim().toLowerCase() === PROFILE_BOOKMARKS_SEGMENT;
}

/** `/p/:id/bookmarks` — same id segment as other profile links (npub or NIP-05). */
export function profileBookmarksPath(id: string): string {
  return `/p/${id.trim()}/bookmarks`;
}

export type BookmarkItem =
  | { type: 'event'; key: string; id: string; relay?: string }
  | { type: 'address'; key: string; address: string; relay?: string }
  | { type: 'url'; key: string; url: string }
  | { type: 'tag'; key: string; tag: string };

export type BookmarkSection = {
  id: string;
  listKind: number;
  title: string;
  description: string;
  items: BookmarkItem[];
  omitted: number;
};

export function bookmarkItemsFromTags(tags: string[][]): BookmarkItem[] {
  const out: BookmarkItem[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const item = bookmarkItemFromTag(tag);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}

/**
 * Standard list first, then bookmark sets by title.
 * Empty kind-10003 lists are dropped. Empty sets stay so the name is visible.
 * `privateTagsByEventId` is merged after public tags (own profile only).
 */
export function profileBookmarkSections(
  events: Event[],
  privateTagsByEventId?: ReadonlyMap<string, string[][]>
): BookmarkSection[] {
  const lists = pruneToLatestReplaceables(events.filter(isProfileBookmarkList));
  const standard = lists.filter((event) => event.kind === KIND.BOOKMARK);
  const sets = lists
    .filter((event) => event.kind === KIND.BOOKMARK_SET)
    .sort((a, b) => {
      const byTitle = bookmarkSetTitle(a).localeCompare(bookmarkSetTitle(b), undefined, {
        sensitivity: 'base'
      });
      if (byTitle !== 0) return byTitle;
      return compareReplaceableNewestFirst(a, b);
    });

  const sections: BookmarkSection[] = [];
  for (const event of standard) {
    const section = sectionFromEvent(event, privateTagsByEventId?.get(event.id) ?? []);
    if (section.items.length || section.omitted > 0) sections.push(section);
  }
  for (const event of sets) {
    sections.push(sectionFromEvent(event, privateTagsByEventId?.get(event.id) ?? []));
  }
  return sections;
}

/**
 * Private NIP-51 rows from content. Plaintext JSON is read directly.
 * Ciphertext is decrypted only when the caller already knows this is the viewer's list.
 */
export async function privateBookmarkTags(event: Event): Promise<string[][]> {
  const content = event.content?.trim() ?? '';
  if (!content) return [];
  if (
    !content.startsWith('[') &&
    !looksLikeNip44Ciphertext(content) &&
    !looksLikeNip04Ciphertext(content)
  ) {
    return [];
  }
  return decryptPrivateTags(event);
}

export async function resolveBookmarkItems(
  items: BookmarkItem[],
  fetchers: {
    eventById: (id: string, relay?: string) => Promise<Event | null>;
    eventByAddress: (address: string, relay?: string) => Promise<Event | null>;
  },
  concurrency = 4
): Promise<Map<string, Event | null>> {
  const targets = items.filter(
    (item): item is Extract<BookmarkItem, { type: 'event' | 'address' }> =>
      item.type === 'event' || item.type === 'address'
  );
  const results = await poolMap(targets, concurrency, async (item) => {
    if (item.type === 'event') return fetchers.eventById(item.id, item.relay);
    return fetchers.eventByAddress(item.address, item.relay);
  });
  const out = new Map<string, Event | null>();
  targets.forEach((item, index) => {
    out.set(item.key, results[index] ?? null);
  });
  return out;
}

function isProfileBookmarkList(event: Event): boolean {
  return event.kind === KIND.BOOKMARK || event.kind === KIND.BOOKMARK_SET;
}

function sectionFromEvent(event: Event, privateTags: string[][]): BookmarkSection {
  const merged = bookmarkItemsFromTags([...event.tags, ...privateTags]);
  const { items, omitted } = capBookmarkItems(merged);
  return {
    id: event.id,
    listKind: event.kind,
    title: event.kind === KIND.BOOKMARK ? 'Bookmarks' : bookmarkSetTitle(event),
    description: bookmarkSetDescription(event),
    items,
    omitted
  };
}

function bookmarkSetTitle(event: Event): string {
  const title = firstTag(event, 'title')?.trim();
  if (title) return title;
  const d = firstTag(event, 'd')?.trim();
  if (d) return d;
  return 'Bookmark set';
}

function bookmarkSetDescription(event: Event): string {
  if (event.kind !== KIND.BOOKMARK_SET) return '';
  const tagged = firstTag(event, 'description')?.trim() || firstTag(event, 'summary')?.trim();
  if (tagged) return cropText(tagged, DESCRIPTION_MAX);
  const content = event.content?.trim() ?? '';
  if (!content || content.startsWith('[')) return '';
  if (looksLikeNip44Ciphertext(content) || looksLikeNip04Ciphertext(content)) return '';
  return cropText(content, DESCRIPTION_MAX);
}

function capBookmarkItems(items: BookmarkItem[]): { items: BookmarkItem[]; omitted: number } {
  const kept: BookmarkItem[] = [];
  let fetches = 0;
  let omitted = 0;
  for (const item of items) {
    const needsFetch = item.type === 'event' || item.type === 'address';
    if (needsFetch && fetches >= PROFILE_BOOKMARK_FETCH_LIMIT) {
      omitted += 1;
      continue;
    }
    if (kept.length >= PROFILE_BOOKMARK_ITEM_LIMIT) {
      omitted += 1;
      continue;
    }
    if (needsFetch) fetches += 1;
    kept.push(item);
  }
  return { items: kept, omitted };
}

function bookmarkItemFromTag(tag: string[]): BookmarkItem | null {
  const name = tag[0];
  const value = tag[1]?.trim() ?? '';
  if (!value) return null;
  if (name === 'e') return eventItem(value, relayHint(tag[2]));
  if (name === 'a') return addressItem(value, relayHint(tag[2]));
  if (name === 'r') return urlItem(value);
  if (name === 't') return tagItem(value);
  return null;
}

function eventItem(raw: string, relay?: string): BookmarkItem | null {
  const id = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  return relay ? { type: 'event', key: `e:${id}`, id, relay } : { type: 'event', key: `e:${id}`, id };
}

function addressItem(raw: string, relay?: string): BookmarkItem | null {
  const parsed = parseEventCoordinate(raw);
  if (!parsed) return null;
  const address = parsed.d
    ? `${parsed.kind}:${parsed.pubkey}:${parsed.d}`
    : `${parsed.kind}:${parsed.pubkey}`;
  return relay
    ? { type: 'address', key: `a:${address}`, address, relay }
    : { type: 'address', key: `a:${address}`, address };
}

function urlItem(raw: string): BookmarkItem | null {
  const url = raw.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { type: 'url', key: `r:${url}`, url };
}

function tagItem(raw: string): BookmarkItem | null {
  const tag = raw.trim().replace(/^#/, '');
  if (!tag) return null;
  return { type: 'tag', key: `t:${tag.toLowerCase()}`, tag };
}

function relayHint(value: string | undefined): string | undefined {
  const raw = value?.trim() ?? '';
  if (!/^wss?:\/\//i.test(raw)) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}
