import type { Event, Filter } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import { isKind1Reply } from './comments';
import { parseAddress } from './library-scope';
import { hexPubkey } from './metadata';
import { emptyMuteState, filterMuted, followPubkeysFromMetadata, type MuteState } from './mute';
import { uniqueRelayUrls } from './nostr/mailboxes';
import { memoryGetEvent, rememberEvents } from './nostr/event-memory';
import { cachedEventsByKind, cacheGetEvent } from './nostr/cache';
import { fetchByAddress } from './nostr/fetch';
import { relayPool } from './nostr/pool';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { forestRelay, getSelectorContext, socialStack } from './nostr/selector';
import { firstTag } from './nostr/verify';
import { compareDirectoryListing } from './directory-explorer';

const HEX_ID = /^[0-9a-f]{64}$/i;

function tagThreadMarker(tag: string[]): 'root' | 'reply' | null {
  for (const slot of [tag[3], tag[2]]) {
    if (slot === 'root' || slot === 'reply') return slot;
  }
  return null;
}

const FOLLOW_AUTHOR_BATCH = 50;
const FOLLOW_AUTHOR_CAP = 200;

/** Time windows for feed list filters / notification relay `since` (`null` = unlimited). */
export const NOTIFICATION_LOOKBACK_OPTIONS = [
  { id: '24h', label: '24 hours', seconds: 24 * 60 * 60 },
  { id: '48h', label: '48 hours', seconds: 48 * 60 * 60 },
  { id: '1w', label: '1 week', seconds: 7 * 24 * 60 * 60 },
  { id: '1m', label: '1 month', seconds: 30 * 24 * 60 * 60 },
  { id: '3m', label: '3 months', seconds: 90 * 24 * 60 * 60 },
  { id: 'all', label: 'unlimited', seconds: null }
] as const;

export type NotificationLookbackId = (typeof NOTIFICATION_LOOKBACK_OPTIONS)[number]['id'];

export const DEFAULT_NOTIFICATION_LOOKBACK: NotificationLookbackId = '24h';

/** Unix `since` for a lookback window, or `null` when unlimited. */
export function feedSinceFromLookback(
  lookbackSeconds: number | null | undefined
): number | null {
  if (lookbackSeconds == null) return null;
  return Math.floor(Date.now() / 1000) - lookbackSeconds;
}

function withFeedSince(filters: Filter[], since: number | null): Filter[] {
  if (since == null) return filters;
  return filters.map((filter) => ({ ...filter, since }));
}

/** True when `next` covers a wider time window than `prev` (needs a fresh relay query). */
export function feedLookbackIsWider(
  next: NotificationLookbackId,
  prev: NotificationLookbackId | null | undefined
): boolean {
  if (prev == null) return true;
  const n = notificationLookbackSeconds(next);
  const p = notificationLookbackSeconds(prev);
  if (n == null) return p != null;
  if (p == null) return false;
  return n > p;
}

const NOTIFICATION_LOOKBACK_IDS = new Set<string>(
  NOTIFICATION_LOOKBACK_OPTIONS.map((o) => o.id)
);

export function isNotificationLookbackId(raw: string): raw is NotificationLookbackId {
  return NOTIFICATION_LOOKBACK_IDS.has(raw);
}

export function parseNotificationLookback(
  raw: string | null | undefined
): NotificationLookbackId {
  const t = (raw ?? '').trim().toLowerCase();
  return isNotificationLookbackId(t) ? t : DEFAULT_NOTIFICATION_LOOKBACK;
}

/** Seconds before now for `#p` queries, or `null` when unlimited. */
export function notificationLookbackSeconds(
  id: NotificationLookbackId = DEFAULT_NOTIFICATION_LOOKBACK
): number | null {
  const opt = NOTIFICATION_LOOKBACK_OPTIONS.find((o) => o.id === id);
  return opt ? opt.seconds : 30 * 24 * 60 * 60;
}

/**
 * Library / media / bookmark posts for the Original Posts tab (plus kind 1 notes).
 * Top-level web comments (kind 1111 on a URL) are handled separately via
 * {@link isTopLevelWebComment}.
 * Publication indexes (30040), sections (30041), specs (30817), and wikis (30818)
 * stay out — they have hub/search pages, and mass imports would flood Follows /
 * Original Posts.
 */
const FEED_POST_KINDS = [
  KIND.DJOT,
  KIND.PICTURE,
  KIND.VIDEO,
  KIND.SHORT_VIDEO,
  KIND.VOICE,
  KIND.HIGHLIGHT,
  KIND.LONG_FORM,
  KIND.RATING,
  KIND.MUSIC,
  KIND.WEB_BOOKMARK,
  KIND.LIVE_EVENT,
  KIND.MEETING_SPACE,
  KIND.MEETING_ROOM
] as const;

const FEED_KINDS = new Set<number>([KIND.TEXT_NOTE, ...FEED_POST_KINDS]);

/** Responses shown on the Replies tab alongside original posts. */
const REPLY_ROW_KINDS = new Set<number>([KIND.TEXT_NOTE, KIND.COMMENT, ...FEED_POST_KINDS]);

/** NIP-18 boosts shown on an author's profile feed (collapsed onto the target). */
const FEED_REPOST_KINDS = [KIND.REPOST, KIND.GENERIC_REPOST] as const;
const FEED_REPOST_KIND_SET = new Set<number>(FEED_REPOST_KINDS);

const HTTP_URL = /^https?:\/\//i;

/** Kind 6 / 16 — kept on author timelines so you can see what they boosted. */
export function isFeedRepost(event: Event): boolean {
  return FEED_REPOST_KIND_SET.has(event.kind);
}

/** First HTTP(S) page URL from NIP-73 `i` / `I` tags (value or URL hint). */
function httpUrlFromITags(event: Event): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== 'i' && tag[0] !== 'I') continue;
    const value = (tag[1] ?? '').trim();
    const hint = (tag[2] ?? '').trim();
    if (HTTP_URL.test(hint)) return hint;
    if (HTTP_URL.test(value)) return value;
  }
  return null;
}

/**
 * Kind 1111 whose thread root is a website (`i`/`I`), with no note/address pointers.
 * These are Original Posts (like web bookmarks), not replies.
 */
export function isTopLevelWebComment(event: Event): boolean {
  if (event.kind !== KIND.COMMENT) return false;
  if (!httpUrlFromITags(event)) return false;
  return !event.tags.some(
    (tag) =>
      (tag[0] === 'e' || tag[0] === 'E' || tag[0] === 'a' || tag[0] === 'A') &&
      Boolean(tag[1]?.trim())
  );
}

/** Social responses that can notify the viewer when they `#p`-tag them. */
export const NOTIFICATION_KINDS = [
  KIND.TEXT_NOTE,
  KIND.COMMENT,
  KIND.REACTION,
  KIND.HIGHLIGHT,
  KIND.ZAP,
  KIND.REPOST,
  KIND.GENERIC_REPOST,
  KIND.RATING
] as const;

const NOTIFICATION_KIND_SET = new Set<number>(NOTIFICATION_KINDS);

/** Fixed feed views (always present in the tab strip). */
export const BUILTIN_FEED_TABS = ['follows', 'original', 'replies', 'notifications'] as const;
export type BuiltinFeedTab = (typeof BUILTIN_FEED_TABS)[number];

/** Built-in tabs plus user-added `kind:N` filters. */
export type FeedTab = BuiltinFeedTab | `kind:${number}`;

/** Default strip order — Follows first. */
export const DEFAULT_FEED_TAB_ORDER: FeedTab[] = [
  'follows',
  'original',
  'replies',
  'notifications'
];

const BUILTIN_FEED_TAB_SET = new Set<string>(BUILTIN_FEED_TABS);

export function isKindFeedTab(tab: string): tab is `kind:${number}` {
  return /^kind:\d+$/.test(tab);
}

export function feedTabKind(tab: FeedTab): number | null {
  const m = /^kind:(\d+)$/.exec(tab);
  if (!m) return null;
  return Number(m[1]);
}

export function isFeedTab(raw: string): raw is FeedTab {
  return BUILTIN_FEED_TAB_SET.has(raw) || isKindFeedTab(raw);
}

export function parseFeedTab(raw: string | null | undefined): FeedTab {
  const t = (raw ?? '').trim().toLowerCase();
  if (t === 'follows' || t === 'replies' || t === 'notifications') return t;
  if (isKindFeedTab(t)) return t;
  return 'original';
}

/** Short label for a feed tab button. */
export function feedTabLabel(tab: FeedTab): string {
  if (tab === 'follows') return 'Follows';
  if (tab === 'original') return 'Original Posts';
  if (tab === 'replies') return 'Replies';
  if (tab === 'notifications') return 'Notifications';
  const kind = feedTabKind(tab);
  return kind == null ? tab : `Kind ${kind}`;
}

/** Lowercase hex pubkey from `?author=` (hex, npub, or nprofile). */
export function parseFeedAuthorParam(raw: string | null | undefined): string | null {
  const hex = hexPubkey((raw ?? '').trim());
  return hex ? hex.toLowerCase() : null;
}

function tagMarkedRootOrReply(tag: string[]): boolean {
  return tag[2] === 'root' || tag[2] === 'reply' || tag[3] === 'root' || tag[3] === 'reply';
}

/**
 * An original post: a note or library post with no thread tags.
 * Kind 1 replies (any `e` tag, or an `a` tag marked root/reply) are responses.
 * Top-level web comments count as OPs. Addressable posts stay original unless an
 * `e`/`a` tag is marked root or reply.
 */
export function isOriginalPost(event: Event): boolean {
  if (isFeedRepost(event)) return true;
  if (isTopLevelWebComment(event)) return true;
  if (!FEED_KINDS.has(event.kind)) return false;
  if (event.kind === KIND.TEXT_NOTE) return !isKind1Reply(event);
  return !event.tags.some(
    (tag) =>
      (tag[0] === 'e' || tag[0] === 'E' || tag[0] === 'a' || tag[0] === 'A') &&
      tag[1] &&
      tagMarkedRootOrReply(tag)
  );
}

/** Kind 1 reply or kind 1111 comment — the responses the Replies tab adds to OPs. */
export function isFeedReplyRow(event: Event): boolean {
  if (event.kind === KIND.COMMENT) return true;
  if (event.kind === KIND.TEXT_NOTE) return isKind1Reply(event);
  return false;
}

/** Events that belong on the Replies timeline (OPs plus kind 1 / 1111 responses). */
export function isRepliesTimelineEvent(event: Event): boolean {
  if (isFeedRepost(event)) return true;
  if (!REPLY_ROW_KINDS.has(event.kind)) return false;
  if (event.kind === KIND.COMMENT) return true;
  if (event.kind === KIND.TEXT_NOTE) return true;
  return isOriginalPost(event);
}

/** Someone else's event that `#p`-tags the viewer (notification inbox row). */
export function isNotificationForViewer(event: Event, viewerPubkey: string): boolean {
  const pk = viewerPubkey.trim().toLowerCase();
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return false;
  if (event.pubkey.toLowerCase() === pk) return false;
  if (!NOTIFICATION_KIND_SET.has(event.kind)) return false;
  return event.tags.some((tag) => tag[0] === 'p' && (tag[1] ?? '').trim().toLowerCase() === pk);
}

export type FeedRelayGroups = {
  /** Signed-in viewer's favorites (when they have any) and inboxes. */
  personal: string[];
  /** theforest: signed out, or signed in with no favorites and no inboxes. */
  shipped: string[];
};

/**
 * Relays for the feed listing.
 * Signed out: theforest only.
 * Signed in: inboxes, plus favorites when that list is not empty.
 * No inboxes and no favorites: theforest.
 */
export function feedRelayGroups(): FeedRelayGroups {
  const ctx = getSelectorContext();
  const forest = [forestRelay()];
  if (!ctx.signedIn) return { personal: [], shipped: forest };
  const personal = uniqueRelayUrls([...(ctx.favorites.length ? ctx.favorites : []), ...ctx.inbox]);
  if (!personal.length) return { personal: [], shipped: forest };
  return { personal, shipped: [] };
}

/** Kind 1 is its own REQ. A relay that only honors one filter would otherwise return long-form and drop notes. */
function noteFilters(): Filter[] {
  return [{ kinds: [KIND.TEXT_NOTE], limit: 40 }];
}

function postFilters(): Filter[] {
  return [{ kinds: [...FEED_POST_KINDS], limit: 24 }];
}

/** Kind 6 / 16 alone so boosts are not crowded out of the post REQ. */
function repostFilters(): Filter[] {
  return [{ kinds: [...FEED_REPOST_KINDS], limit: 40 }];
}

/** Kind 1111 alone so relays can return web comments without crowding the post REQ. */
function commentFilters(): Filter[] {
  return [{ kinds: [KIND.COMMENT], limit: 40 }];
}

/**
 * Pubkeys whose original notes are added to a signed-in feed.
 * Muted accounts are left out. Capped so one request stays modest.
 */
export function feedFollowAuthors(metadataEvents: Event[], muted: MuteState): string[] {
  const authors: string[] = [];
  for (const pubkey of followPubkeysFromMetadata(metadataEvents)) {
    if (muted.pubkeys.has(pubkey)) continue;
    authors.push(pubkey);
    if (authors.length >= FOLLOW_AUTHOR_CAP) break;
  }
  return authors;
}

function followNoteFilters(authors: string[]): Filter[] {
  const filters: Filter[] = [];
  for (let i = 0; i < authors.length; i += FOLLOW_AUTHOR_BATCH) {
    const batch = authors.slice(i, i + FOLLOW_AUTHOR_BATCH);
    filters.push({
      kinds: [KIND.TEXT_NOTE],
      authors: batch,
      limit: 15
    });
    filters.push({
      kinds: [...FEED_REPOST_KINDS],
      authors: batch,
      limit: 15
    });
  }
  return filters;
}

/** Broader follow REQs for the Follows-only tab (notes, library posts, boosts). */
function followOriginalFilters(authors: string[]): Filter[] {
  const filters: Filter[] = [];
  for (let i = 0; i < authors.length; i += FOLLOW_AUTHOR_BATCH) {
    const batch = authors.slice(i, i + FOLLOW_AUTHOR_BATCH);
    filters.push({ kinds: [KIND.TEXT_NOTE], authors: batch, limit: 20 });
    filters.push({ kinds: [...FEED_POST_KINDS], authors: batch, limit: 16 });
    filters.push({ kinds: [KIND.COMMENT], authors: batch, limit: 12 });
    filters.push({ kinds: [...FEED_REPOST_KINDS], authors: batch, limit: 16 });
  }
  return filters;
}

function kindFeedFilters(kind: number, authors?: string[]): Filter[] {
  if (!authors?.length) return [{ kinds: [kind], limit: 40 }];
  const filters: Filter[] = [];
  for (let i = 0; i < authors.length; i += FOLLOW_AUTHOR_BATCH) {
    filters.push({
      kinds: [kind],
      authors: authors.slice(i, i + FOLLOW_AUTHOR_BATCH),
      limit: 20
    });
  }
  return filters;
}

const emptyMute: MuteState = emptyMuteState();

/** Keep posts already on screen when a load comes back with nothing. */
export function keepFeedPosts(shown: Event[], incoming: Event[]): Event[] {
  return incoming.length ? incoming : shown;
}

/** Merge by id and sort newest-first — does not drop rows already on screen. */
export function mergeFeedPosts(shown: Event[], incoming: Event[]): Event[] {
  if (!incoming.length) return shown;
  const byId = new Map<string, Event>();
  for (const event of shown) {
    if (event?.id) byId.set(event.id.toLowerCase(), event);
  }
  for (const event of incoming) {
    if (event?.id) byId.set(event.id.toLowerCase(), event);
  }
  return [...byId.values()].sort((a, b) => b.created_at - a.created_at);
}

/**
 * After the feed has settled, newer posts are held for a "New Events" control
 * instead of jumping into the timeline (which steals scroll).
 */
export function collectNewFeedEvents(
  incoming: Event[],
  opts: {
    shown: Event[];
    pending: Event[];
    /** Max `created_at` already admitted to the timeline when it settled / last admit. */
    watermark: number;
  }
): Event[] {
  const known = new Set<string>();
  for (const event of opts.shown) {
    if (event?.id) known.add(event.id.toLowerCase());
  }
  for (const event of opts.pending) {
    if (event?.id) known.add(event.id.toLowerCase());
  }
  const byId = new Map<string, Event>();
  for (const event of opts.pending) {
    if (event?.id) byId.set(event.id.toLowerCase(), event);
  }
  for (const event of incoming) {
    if (!event?.id) continue;
    const id = event.id.toLowerCase();
    if (known.has(id)) continue;
    if (event.created_at <= opts.watermark) continue;
    byId.set(id, event);
    known.add(id);
  }
  return [...byId.values()].sort((a, b) => b.created_at - a.created_at);
}

/** Newest `created_at` in a list (0 when empty). */
export function feedEventsWatermark(events: Event[]): number {
  let max = 0;
  for (const event of events) {
    if (event.created_at > max) max = event.created_at;
  }
  return max;
}

/** Newest original posts already in memory or the browser cache. */
export async function recallFeedPosts(): Promise<Event[]> {
  const kinds = [KIND.TEXT_NOTE, KIND.COMMENT, ...FEED_POST_KINDS, ...FEED_REPOST_KINDS];
  const stored = (await Promise.all(kinds.map((kind) => cachedEventsByKind(kind)))).flat();
  return stored
    .filter(isOriginalPost)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 40);
}

function sortFeedEvents(events: Event[]): Event[] {
  return pruneToLatestReplaceables(events).sort((a, b) => {
    if (a.kind === KIND.DIRECTORY && b.kind === KIND.DIRECTORY) {
      return compareDirectoryListing(a, b);
    }
    return b.created_at - a.created_at;
  });
}

/** Newest original posts from the session's feed relays, plus follows' notes when signed in. */
export async function loadFeed(
  metadataEvents: Event[] = [],
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void,
  lookbackSeconds: number | null = null
): Promise<Event[]> {
  const since = feedSinceFromLookback(lookbackSeconds);
  const inWindow = (event: Event): boolean =>
    since == null || event.created_at >= since;
  const cached = filterMuted(await recallFeedPosts(), muted);
  const byId = new Map<string, Event>();
  const paint = (): void => {
    const posts = filterMuted(
      sortFeedEvents([...byId.values()].filter(inWindow)),
      muted
    );
    if (posts.length) onCache?.(posts);
  };
  for (const event of cached) {
    if (!isOriginalPost(event) || !inWindow(event)) continue;
    byId.set(event.id, event);
  }
  if (byId.size) paint();
  const { personal, shipped } = feedRelayGroups();
  const relays = uniqueRelayUrls([...personal, ...shipped]);
  const authors = getSelectorContext().signedIn ? feedFollowAuthors(metadataEvents, muted) : [];
  const followFilters = withFeedSince(followNoteFilters(authors), since);
  // Background list load — not priority. Priority slots are for open threads / wiki.
  const queryOpts = { includeCooling: true };
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (!isOriginalPost(event) || !inWindow(event) || byId.has(event.id)) continue;
      byId.set(event.id, event);
      added = true;
    }
    if (added) paint();
  };
  const ask = (urls: string[], maxRelays: number): Promise<Event[]> =>
    Promise.all([
      relayPool.query(urls, withFeedSince(noteFilters(), since), 7000, maxRelays, absorb, queryOpts),
      relayPool.query(urls, withFeedSince(postFilters(), since), 7000, maxRelays, absorb, queryOpts),
      relayPool.query(
        urls,
        withFeedSince(commentFilters(), since),
        7000,
        maxRelays,
        absorb,
        queryOpts
      ),
      relayPool.query(
        urls,
        withFeedSince(repostFilters(), since),
        7000,
        maxRelays,
        absorb,
        queryOpts
      )
    ]).then((batches) => batches.flat());
  const [fromPersonal, fromShipped, fromFollows] = await Promise.all([
    personal.length ? ask(personal, Math.min(personal.length, 8)) : Promise.resolve([]),
    shipped.length ? ask(shipped, 4) : Promise.resolve([]),
    followFilters.length
      ? relayPool
          .query(relays, followFilters, 7000, Math.min(relays.length, 8), absorb, queryOpts)
          .catch(() => [] as Event[])
      : Promise.resolve([] as Event[])
  ]);
  for (const event of [...fromPersonal, ...fromShipped, ...fromFollows]) {
    if (!isOriginalPost(event) || !inWindow(event)) continue;
    byId.set(event.id, event);
  }
  return filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
}

/** Cached original posts from accounts the viewer follows. */
export async function recallFollowsFeed(
  metadataEvents: Event[] = [],
  muted: MuteState = emptyMute
): Promise<Event[]> {
  const authors = new Set(feedFollowAuthors(metadataEvents, muted));
  if (!authors.size) return [];
  return (await recallFeedPosts())
    .filter((event) => authors.has(event.pubkey.toLowerCase()))
    .slice(0, 40);
}

/**
 * Original posts from follow-list authors only (no open relay dump).
 * Empty when signed out or the contact list has no usable pubkeys.
 */
export async function loadFollowsFeed(
  metadataEvents: Event[] = [],
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void,
  lookbackSeconds: number | null = null
): Promise<Event[]> {
  if (!getSelectorContext().signedIn) return [];
  const authors = feedFollowAuthors(metadataEvents, muted);
  if (!authors.length) return [];
  const since = feedSinceFromLookback(lookbackSeconds);
  const inWindow = (event: Event): boolean =>
    since == null || event.created_at >= since;
  const authorSet = new Set(authors);
  const cached = filterMuted(await recallFollowsFeed(metadataEvents, muted), muted);
  const byId = new Map<string, Event>();
  const paint = (): void => {
    const posts = filterMuted(
      sortFeedEvents([...byId.values()].filter(inWindow)),
      muted
    );
    if (posts.length) onCache?.(posts);
  };
  for (const event of cached) {
    if (
      !isOriginalPost(event) ||
      !authorSet.has(event.pubkey.toLowerCase()) ||
      !inWindow(event)
    ) {
      continue;
    }
    byId.set(event.id, event);
  }
  if (byId.size) paint();
  const { personal, shipped } = feedRelayGroups();
  const relays = uniqueRelayUrls([...personal, ...shipped]);
  if (!relays.length) {
    return filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
  }
  const filters = withFeedSince(followOriginalFilters(authors), since);
  const queryOpts = { includeCooling: true };
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (
        !isOriginalPost(event) ||
        !authorSet.has(event.pubkey.toLowerCase()) ||
        !inWindow(event) ||
        byId.has(event.id)
      ) {
        continue;
      }
      byId.set(event.id, event);
      added = true;
    }
    if (added) paint();
  };
  const hits = await relayPool
    .query(relays, filters, 7000, Math.min(relays.length, 8), absorb, queryOpts)
    .catch(() => [] as Event[]);
  for (const event of hits) {
    if (
      !isOriginalPost(event) ||
      !authorSet.has(event.pubkey.toLowerCase()) ||
      !inWindow(event)
    ) {
      continue;
    }
    byId.set(event.id, event);
  }
  return filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
}

/** Cached events of one kind (newest first). */
export async function recallKindFeed(kind: number): Promise<Event[]> {
  if (!Number.isInteger(kind) || kind < 0) return [];
  return (await cachedEventsByKind(kind)).sort((a, b) => b.created_at - a.created_at).slice(0, 40);
}

/** Newest events of a single kind from the session's feed relays. */
export async function loadKindFeed(
  kind: number,
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void,
  lookbackSeconds: number | null = null
): Promise<Event[]> {
  if (!Number.isInteger(kind) || kind < 0) return [];
  const since = feedSinceFromLookback(lookbackSeconds);
  const inWindow = (event: Event): boolean =>
    since == null || event.created_at >= since;
  const cached = filterMuted(await recallKindFeed(kind), muted);
  const byId = new Map<string, Event>();
  const paint = (): void => {
    const posts = filterMuted(
      sortFeedEvents([...byId.values()].filter(inWindow)),
      muted
    );
    if (posts.length) onCache?.(posts);
  };
  for (const event of cached) {
    if (event.kind !== kind || !inWindow(event)) continue;
    byId.set(event.id, event);
  }
  if (byId.size) paint();
  const { personal, shipped } = feedRelayGroups();
  const relays = uniqueRelayUrls([...personal, ...shipped]);
  if (!relays.length) {
    return filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
  }
  const filters = withFeedSince(kindFeedFilters(kind), since);
  const queryOpts = { includeCooling: true };
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (event.kind !== kind || !inWindow(event) || byId.has(event.id)) continue;
      byId.set(event.id, event);
      added = true;
    }
    if (added) paint();
  };
  const ask = (urls: string[], maxRelays: number): Promise<Event[]> =>
    relayPool.query(urls, filters, 7000, maxRelays, absorb, queryOpts).catch(() => [] as Event[]);
  const [fromPersonal, fromShipped] = await Promise.all([
    personal.length ? ask(personal, Math.min(personal.length, 8)) : Promise.resolve([]),
    shipped.length ? ask(shipped, 4) : Promise.resolve([])
  ]);
  for (const event of [...fromPersonal, ...fromShipped]) {
    if (event.kind !== kind || !inWindow(event)) continue;
    byId.set(event.id, event);
  }
  return filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
}

function followReplyFilters(authors: string[]): Filter[] {
  const filters: Filter[] = [];
  for (let i = 0; i < authors.length; i += FOLLOW_AUTHOR_BATCH) {
    const batch = authors.slice(i, i + FOLLOW_AUTHOR_BATCH);
    filters.push({ kinds: [KIND.TEXT_NOTE], authors: batch, limit: 20 });
    filters.push({ kinds: [KIND.COMMENT], authors: batch, limit: 15 });
    filters.push({ kinds: [...FEED_REPOST_KINDS], authors: batch, limit: 15 });
  }
  return filters;
}

/** Newest OPs already in cache, plus kind 1 replies and kind 1111 comments. */
export async function recallFeedWithReplies(): Promise<Event[]> {
  const kinds = [KIND.TEXT_NOTE, KIND.COMMENT, ...FEED_POST_KINDS, ...FEED_REPOST_KINDS];
  const stored = (await Promise.all(kinds.map((kind) => cachedEventsByKind(kind)))).flat();
  return stored
    .filter(isRepliesTimelineEvent)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 60);
}

/**
 * Original posts plus their responses (kind 1 replies and kind 1111 comments).
 * Same relay groups as {@link loadFeed}; absorbs replies instead of dropping them.
 */
export async function loadFeedWithReplies(
  metadataEvents: Event[] = [],
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void,
  lookbackSeconds: number | null = null
): Promise<Event[]> {
  const since = feedSinceFromLookback(lookbackSeconds);
  const inWindow = (event: Event): boolean =>
    since == null || event.created_at >= since;
  const cached = filterMuted(await recallFeedWithReplies(), muted);
  const byId = new Map<string, Event>();
  const paint = (): void => {
    const posts = filterMuted(
      sortFeedEvents([...byId.values()].filter(inWindow)),
      muted
    );
    if (posts.length) onCache?.(posts);
  };
  for (const event of cached) {
    if (!isRepliesTimelineEvent(event) || !inWindow(event)) continue;
    byId.set(event.id, event);
  }
  if (byId.size) paint();
  const { personal, shipped } = feedRelayGroups();
  const relays = uniqueRelayUrls([...personal, ...shipped]);
  const authors = getSelectorContext().signedIn ? feedFollowAuthors(metadataEvents, muted) : [];
  const followFilters = withFeedSince(followReplyFilters(authors), since);
  const queryOpts = { includeCooling: true };
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (!isRepliesTimelineEvent(event) || !inWindow(event) || byId.has(event.id)) continue;
      byId.set(event.id, event);
      added = true;
    }
    if (added) paint();
  };
  const ask = (urls: string[], maxRelays: number): Promise<Event[]> =>
    Promise.all([
      relayPool.query(urls, withFeedSince(noteFilters(), since), 7000, maxRelays, absorb, queryOpts),
      relayPool.query(
        urls,
        withFeedSince(commentFilters(), since),
        7000,
        maxRelays,
        absorb,
        queryOpts
      ),
      relayPool.query(urls, withFeedSince(postFilters(), since), 7000, maxRelays, absorb, queryOpts),
      relayPool.query(
        urls,
        withFeedSince(repostFilters(), since),
        7000,
        maxRelays,
        absorb,
        queryOpts
      )
    ]).then((batches) => batches.flat());
  const [fromPersonal, fromShipped, fromFollows] = await Promise.all([
    personal.length ? ask(personal, Math.min(personal.length, 8)) : Promise.resolve([]),
    shipped.length ? ask(shipped, 4) : Promise.resolve([]),
    followFilters.length
      ? relayPool
          .query(relays, followFilters, 7000, Math.min(relays.length, 8), absorb, queryOpts)
          .catch(() => [] as Event[])
      : Promise.resolve([] as Event[])
  ]);
  for (const event of [...fromPersonal, ...fromShipped, ...fromFollows]) {
    if (!isRepliesTimelineEvent(event) || !inWindow(event)) continue;
    byId.set(event.id, event);
  }
  return filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
}

function authorNoteFilters(author: string): Filter[] {
  return [
    { kinds: [KIND.TEXT_NOTE], authors: [author], limit: 40 },
    { kinds: [KIND.COMMENT], authors: [author], limit: 40 },
    { kinds: [...FEED_POST_KINDS], authors: [author], limit: 24 },
    // Own REQ so articles/media do not crowd out the author's boosts.
    { kinds: [...FEED_REPOST_KINDS], authors: [author], limit: 40 }
  ];
}

function isAuthorEvent(event: Event, authorPubkey: string): boolean {
  return event.pubkey.toLowerCase() === authorPubkey;
}

/** Cached replies-timeline events from one author. */
export async function recallAuthorFeedWithReplies(authorPubkey: string): Promise<Event[]> {
  const pk = authorPubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return [];
  return (await recallFeedWithReplies())
    .filter((event) => isAuthorEvent(event, pk))
    .slice(0, 60);
}

/** Cached original posts from one author. */
export async function recallAuthorFeedPosts(authorPubkey: string): Promise<Event[]> {
  const pk = authorPubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return [];
  return (await recallFeedPosts())
    .filter((event) => isAuthorEvent(event, pk))
    .slice(0, 40);
}

/**
 * One author's posts and replies (Replies tab scoped to a profile).
 * Uses the same relay groups as the main feed; only `authors` filters.
 */
export async function loadAuthorFeedWithReplies(
  authorPubkey: string,
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void
): Promise<Event[]> {
  const pk = authorPubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return [];
  const cached = filterMuted(await recallAuthorFeedWithReplies(pk), muted);
  const byId = new Map<string, Event>();
  const paint = (): void => {
    const posts = filterMuted(sortFeedEvents([...byId.values()]), muted);
    if (posts.length) onCache?.(posts);
  };
  for (const event of cached) {
    if (isRepliesTimelineEvent(event)) byId.set(event.id, event);
  }
  if (byId.size) paint();
  const { personal, shipped } = feedRelayGroups();
  const relays = uniqueRelayUrls([...personal, ...shipped]);
  if (!relays.length) return filterMuted(sortFeedEvents([...byId.values()]), muted);
  const filters = authorNoteFilters(pk);
  const queryOpts = { includeCooling: true };
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (!isAuthorEvent(event, pk) || !isRepliesTimelineEvent(event) || byId.has(event.id)) {
        continue;
      }
      byId.set(event.id, event);
      added = true;
    }
    if (added) paint();
  };
  const ask = (urls: string[], maxRelays: number): Promise<Event[]> =>
    relayPool.query(urls, filters, 7000, maxRelays, absorb, queryOpts).catch(() => [] as Event[]);
  const [fromPersonal, fromShipped] = await Promise.all([
    personal.length ? ask(personal, Math.min(personal.length, 8)) : Promise.resolve([]),
    shipped.length ? ask(shipped, 4) : Promise.resolve([])
  ]);
  for (const event of [...fromPersonal, ...fromShipped]) {
    if (!isAuthorEvent(event, pk) || !isRepliesTimelineEvent(event)) continue;
    byId.set(event.id, event);
  }
  return filterMuted(sortFeedEvents([...byId.values()]), muted);
}

/** One author's original posts (Original Posts tab scoped to a profile). */
export async function loadAuthorFeed(
  authorPubkey: string,
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void
): Promise<Event[]> {
  const pk = authorPubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return [];
  const cached = filterMuted(await recallAuthorFeedPosts(pk), muted);
  const byId = new Map<string, Event>();
  const paint = (): void => {
    const posts = filterMuted(sortFeedEvents([...byId.values()]), muted);
    if (posts.length) onCache?.(posts);
  };
  for (const event of cached) {
    if (isOriginalPost(event)) byId.set(event.id, event);
  }
  if (byId.size) paint();
  const { personal, shipped } = feedRelayGroups();
  const relays = uniqueRelayUrls([...personal, ...shipped]);
  if (!relays.length) return filterMuted(sortFeedEvents([...byId.values()]), muted);
  const filters = authorNoteFilters(pk);
  const queryOpts = { includeCooling: true };
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (!isAuthorEvent(event, pk) || !isOriginalPost(event) || byId.has(event.id)) continue;
      byId.set(event.id, event);
      added = true;
    }
    if (added) paint();
  };
  const ask = (urls: string[], maxRelays: number): Promise<Event[]> =>
    relayPool.query(urls, filters, 7000, maxRelays, absorb, queryOpts).catch(() => [] as Event[]);
  const [fromPersonal, fromShipped] = await Promise.all([
    personal.length ? ask(personal, Math.min(personal.length, 8)) : Promise.resolve([]),
    shipped.length ? ask(shipped, 4) : Promise.resolve([])
  ]);
  for (const event of [...fromPersonal, ...fromShipped]) {
    if (!isAuthorEvent(event, pk) || !isOriginalPost(event)) continue;
    byId.set(event.id, event);
  }
  return filterMuted(sortFeedEvents([...byId.values()]), muted);
}

/** Relays for the Notifications tab: feed relays plus the social stack. */
export function notificationRelays(): string[] {
  const { personal, shipped } = feedRelayGroups();
  return uniqueRelayUrls([...personal, ...shipped, ...socialStack()]);
}

/** Cached events that `#p`-tag the viewer. */
export async function recallNotifications(viewerPubkey: string): Promise<Event[]> {
  const stored = (
    await Promise.all(NOTIFICATION_KINDS.map((kind) => cachedEventsByKind(kind)))
  ).flat();
  return stored
    .filter((event) => isNotificationForViewer(event, viewerPubkey))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 80);
}

/**
 * Responses aimed at the signed-in viewer: replies, comments, reactions, highlights,
 * quotes/reposts, zap receipts, and ratings that `#p`-tag them.
 * @param lookbackSeconds seconds before now for relay `since`, or `null` for unlimited
 */
export async function loadNotifications(
  viewerPubkey: string,
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void,
  lookbackSeconds: number | null = notificationLookbackSeconds()
): Promise<Event[]> {
  const pk = viewerPubkey.trim().toLowerCase();
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return [];
  const since =
    lookbackSeconds == null ? null : Math.floor(Date.now() / 1000) - lookbackSeconds;
  const inWindow = (event: Event): boolean =>
    since == null || event.created_at >= since;
  const cached = filterMuted(await recallNotifications(pk), muted);
  const byId = new Map<string, Event>();
  const paint = (): void => {
    const rows = filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
    if (rows.length) onCache?.(rows);
  };
  for (const event of cached) {
    if (!inWindow(event)) continue;
    byId.set(event.id, event);
  }
  if (byId.size) paint();
  const relays = notificationRelays();
  if (!relays.length) {
    return filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
  }
  const filters: Filter[] = [
    {
      kinds: [...NOTIFICATION_KINDS],
      '#p': [pk],
      ...(since != null ? { since } : {}),
      limit: since == null ? 200 : 120
    }
  ];
  const queryOpts = { includeCooling: true };
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (!isNotificationForViewer(event, pk) || !inWindow(event) || byId.has(event.id)) {
        continue;
      }
      byId.set(event.id, event);
      rememberEvents([event]);
      added = true;
    }
    if (added) paint();
  };
  const hits = await relayPool
    .query(relays, filters, 8000, Math.min(relays.length, 10), absorb, queryOpts)
    .catch(() => [] as Event[]);
  for (const event of hits) {
    if (!isNotificationForViewer(event, pk) || !inWindow(event)) continue;
    byId.set(event.id, event);
    rememberEvents([event]);
  }
  return filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
}

/** Load one event for a feed thread, from memory and then the same relay groups. */
export async function fetchFeedEvent(id: string): Promise<Event | null> {
  const hex = id.toLowerCase();
  const cached = memoryGetEvent(hex) ?? (await cacheGetEvent(hex).catch(() => null));
  if (cached) {
    rememberEvents([cached]);
    return cached;
  }
  const { personal, shipped } = feedRelayGroups();
  const filter: Filter[] = [{ ids: [hex], limit: 1 }];
  if (personal.length) {
    const hit = (
      await relayPool.query(personal, filter, 4000, Math.min(personal.length, 8), undefined, {
        priority: true
      })
    )[0];
    if (hit) return hit;
  }
  if (shipped.length) {
    return (
      (
        await relayPool.query(shipped, filter, 4000, 4, undefined, { priority: true })
      )[0] ?? null
    );
  }
  return null;
}

/** Preferred share/thread pointer: naddr for parameterized replaceables, else nevent1. */
export function feedThreadPointer(event: Event): string {
  const d = firstTag(event, 'd');
  if (d != null && event.kind >= 30_000 && event.kind < 40_000) {
    return nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: d
    });
  }
  return nip19.neventEncode({
    id: event.id,
    author: event.pubkey,
    kind: event.kind
  });
}

/** `nevent1…` from an id alone (boost targets, legacy `/feed/note1…` redirects). */
export function feedThreadPointerFromId(id: string): string {
  return nip19.neventEncode({ id: id.toLowerCase() });
}

function pointerFromAddressCoord(coord: string): string | null {
  const parsed = parseAddress(coord);
  if (!parsed) return null;
  try {
    return nip19.naddrEncode({
      kind: parsed.kind,
      pubkey: parsed.pubkey,
      identifier: parsed.d
    });
  } catch {
    return null;
  }
}

/** Kind 7 / 17 reactions and kind 9735 zap receipts — open the target, not themselves. */
export function isFeedInteractionEvent(event: Event): boolean {
  return event.kind === KIND.REACTION || event.kind === KIND.ZAP || event.kind === 17;
}

/**
 * Pointer for the event a reaction or zap targets.
 * NIP-25: last `e` is the reacted-to note; NIP-57 may use `e` and/or `a`/`A`.
 */
export function feedInteractionTargetPointer(event: Event): string | null {
  if (!isFeedInteractionEvent(event)) return null;
  const eTags = event.tags.filter((t) => t[0] === 'e' && t[1] && HEX_ID.test(t[1]));
  if (eTags.length) {
    const id = eTags[eTags.length - 1]?.[1];
    if (id) return feedThreadPointerFromId(id);
  }
  const aTag = event.tags.find((t) => (t[0] === 'a' || t[0] === 'A') && t[1]?.trim());
  if (aTag?.[1]) return pointerFromAddressCoord(aTag[1]);
  return null;
}

/**
 * For a reply/comment, the OP to open as `?thread=` (and focus via `?comment=`).
 * Returns null when this event is its own thread root (OPs, top-level web comments).
 */
export function feedThreadRootPointer(event: Event): string | null {
  if (isTopLevelWebComment(event)) return null;

  if (event.kind === KIND.TEXT_NOTE && isKind1Reply(event)) {
    const eTags = event.tags.filter((t) => t[0] === 'e' && t[1] && HEX_ID.test(t[1]));
    const eRoot = eTags.find((t) => tagThreadMarker(t) === 'root');
    if (eRoot?.[1]) return feedThreadPointerFromId(eRoot[1]);
    // Classic NIP-10: first e is root when unmarked; lone e is the parent/OP.
    if (eTags[0]?.[1]) return feedThreadPointerFromId(eTags[0][1]);
    const aRoot = event.tags.find(
      (t) => (t[0] === 'a' || t[0] === 'A') && t[1] && tagThreadMarker(t) === 'root'
    );
    if (aRoot?.[1]) return pointerFromAddressCoord(aRoot[1]);
    return null;
  }

  if (event.kind === KIND.COMMENT) {
    // NIP-22: uppercase tags name the thread root.
    const E = event.tags.find((t) => t[0] === 'E' && t[1] && HEX_ID.test(t[1]));
    if (E?.[1]) return feedThreadPointerFromId(E[1]);
    const A = event.tags.find((t) => t[0] === 'A' && t[1]);
    if (A?.[1]) return pointerFromAddressCoord(A[1]);
    // Lowercase-only clients: treat marked/positional e like NIP-10.
    const eTags = event.tags.filter((t) => t[0] === 'e' && t[1] && HEX_ID.test(t[1]));
    const eRoot = eTags.find((t) => tagThreadMarker(t) === 'root');
    if (eRoot?.[1]) return feedThreadPointerFromId(eRoot[1]);
    if (eTags[0]?.[1]) return feedThreadPointerFromId(eTags[0][1]);
    const aRoot = event.tags.find(
      (t) => (t[0] === 'a' || t[0] === 'A') && t[1] && tagThreadMarker(t) === 'root'
    );
    if (aRoot?.[1]) return pointerFromAddressCoord(aRoot[1]);
  }

  return null;
}

/**
 * Feed URL contract (query-based — keeps list+thread on one `/feed` route so the
 * list does not remount when opening/closing a card or switching tabs):
 *
 * 1. `/feed` — entry only; Feed.svelte quiet-rewrites to `feedListPath(firstVisibleTab)`.
 * 2. `/feed?tab=T` — list for tab T (always include `tab`, including `original`;
 *    bare `/feed` ≠ Original Posts — it means “first strip tab”).
 * 3. `/feed?thread=P` — thread on Original Posts (`parseFeedTab(null)` → `original`);
 *    open threads skip the bare-`/feed` rewrite.
 * 4. `/feed?tab=T&thread=P` — thread while preserving list tab T for close.
 * 5. `comment=` / `author=` — reply focus / profile-scoped list; orthogonal.
 * 6. Legacy `/feed/:id` — redirect to `?thread=` only (FeedThreadRedirect).
 *
 * Replies open the OP as `thread=` and focus with `comment=`; OPs open themselves.
 */
export type FeedListOpts = { author?: string | null };

function appendFeedAuthor(q: URLSearchParams, author?: string | null): void {
  const hex = author?.trim().toLowerCase();
  if (hex && /^[0-9a-f]{64}$/.test(hex)) q.set('author', hex);
}

/** Write `tab=`. Thread builders pass `omitDefault` so `original` stays off the URL. */
function appendFeedTab(
  q: URLSearchParams,
  tab: FeedTab,
  opts: { omitDefault?: boolean } = {}
): void {
  if (opts.omitDefault && tab === 'original') return;
  q.set('tab', tab);
}

export function feedThreadPath(
  event: Event,
  tab: FeedTab = 'original',
  opts: FeedListOpts = {}
): string {
  // Reactions / zaps open the reacted-to or zapped event's thread (not themselves).
  // Never recurse into another reaction/zap — that can stack-overflow during list render.
  if (isFeedInteractionEvent(event)) {
    const eTags = event.tags.filter((t) => t[0] === 'e' && t[1] && HEX_ID.test(t[1]));
    const targetId = eTags[eTags.length - 1]?.[1]?.toLowerCase();
    if (targetId) {
      const warm = memoryGetEvent(targetId);
      if (
        warm &&
        warm.id.toLowerCase() !== event.id.toLowerCase() &&
        !isFeedInteractionEvent(warm)
      ) {
        return feedThreadPath(warm, tab, opts);
      }
    }
    const targetPointer = feedInteractionTargetPointer(event);
    if (targetPointer) {
      const q = new URLSearchParams();
      q.set('thread', targetPointer);
      appendFeedTab(q, tab, { omitDefault: true });
      appendFeedAuthor(q, opts.author);
      return `/feed?${q.toString()}`;
    }
  }

  const q = new URLSearchParams();
  const rootPointer = feedThreadRootPointer(event);
  if (rootPointer) {
    q.set('thread', rootPointer);
    q.set('comment', event.id.toLowerCase());
  } else {
    q.set('thread', feedThreadPointer(event));
  }
  appendFeedTab(q, tab, { omitDefault: true });
  appendFeedAuthor(q, opts.author);
  return `/feed?${q.toString()}`;
}

/** Thread URL from a 64-hex id when the full event is not in hand (same `tab=` rules). */
export function feedThreadPathFromId(
  id: string,
  tab: FeedTab = 'original',
  opts: FeedListOpts = {}
): string {
  const q = new URLSearchParams();
  q.set('thread', feedThreadPointerFromId(id));
  appendFeedTab(q, tab, { omitDefault: true });
  appendFeedAuthor(q, opts.author);
  return `/feed?${q.toString()}`;
}

/** List URL for a feed tab (no open thread). Always writes `tab=` — see contract above. */
export function feedListPath(tab: FeedTab = 'original', opts: FeedListOpts = {}): string {
  const q = new URLSearchParams();
  appendFeedTab(q, tab);
  appendFeedAuthor(q, opts.author);
  return `/feed?${q.toString()}`;
}

/** Profile → Replies tab filtered to that pubkey. */
export function feedAuthorRepliesPath(authorPubkey: string): string {
  return feedListPath('replies', { author: authorPubkey });
}

export type FeedThreadTarget =
  | { type: 'id'; id: string; author?: string; relays?: string[] }
  | {
      type: 'addr';
      kind: number;
      pubkey: string;
      identifier: string;
      relays?: string[];
      /** Stable key for effects / warm-cache compare (coord or id). */
      key: string;
    };

/**
 * Resolve `nevent1…`, `naddr1…`, legacy `note1…`, or a 64-char hex id.
 * Does not dig bech32 out of HTTP wrappers — those stay links with a chevron.
 */
export function decodeFeedThreadTarget(raw: string): FeedThreadTarget | null {
  const value = decodeURIComponent(raw).trim().replace(/^nostr:/i, '');
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return { type: 'id', id: value.toLowerCase() };
  }
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'nevent') {
      return {
        type: 'id',
        id: decoded.data.id,
        author: decoded.data.author,
        relays: decoded.data.relays
      };
    }
    if (decoded.type === 'note') {
      return { type: 'id', id: decoded.data };
    }
    if (decoded.type === 'naddr') {
      const { kind, pubkey, identifier, relays } = decoded.data;
      return {
        type: 'addr',
        kind,
        pubkey,
        identifier,
        relays,
        key: `${kind}:${pubkey.toLowerCase()}:${identifier}`
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Event id from `nevent1…`, legacy `note1…`, or a 64-char hex id.
 * Prefer {@link decodeFeedThreadTarget} when naddr must resolve.
 */
export function decodeFeedPointer(raw: string): string | null {
  const target = decodeFeedThreadTarget(raw);
  return target?.type === 'id' ? target.id : null;
}

/** Load the OP for a feed thread (by id or naddr address). */
export async function fetchFeedThreadTarget(
  target: FeedThreadTarget
): Promise<Event | null> {
  if (target.type === 'id') {
    const cached = memoryGetEvent(target.id) ?? (await cacheGetEvent(target.id).catch(() => null));
    if (cached) {
      rememberEvents([cached]);
      return cached;
    }
    if (target.relays?.length || target.author) {
      const { fetchById } = await import('./nostr/fetch');
      const hit = await fetchById(target.id, {
        hintRelays: target.relays,
        authorPubkey: target.author
      });
      if (hit) return hit;
    }
    return fetchFeedEvent(target.id);
  }
  return fetchByAddress(`${target.kind}:${target.pubkey}:${target.identifier}`, {
    hintRelays: target.relays
  });
}

/** Stable compare key for an open thread target. */
export function feedThreadTargetKey(target: FeedThreadTarget): string {
  return target.type === 'id' ? target.id : target.key;
}

/** True when this event is the OP for the open thread target. */
export function eventMatchesThreadTarget(event: Event, target: FeedThreadTarget): boolean {
  if (target.type === 'id') return event.id.toLowerCase() === target.id;
  const d = firstTag(event, 'd');
  return (
    event.kind === target.kind &&
    event.pubkey.toLowerCase() === target.pubkey.toLowerCase() &&
    d === target.identifier
  );
}

/** Read `thread=` from the feed querystring (hex / nevent / naddr). */
export function parseFeedThreadParam(raw: string | null | undefined): string | null {
  const thread = new URLSearchParams(raw ?? '').get('thread');
  if (!thread?.trim()) return null;
  const target = decodeFeedThreadTarget(thread.trim());
  if (!target) return null;
  return feedThreadTargetKey(target);
}

/** Full thread target from the feed querystring. */
export function parseFeedThreadTarget(
  raw: string | null | undefined
): FeedThreadTarget | null {
  const thread = new URLSearchParams(raw ?? '').get('thread');
  if (!thread?.trim()) return null;
  return decodeFeedThreadTarget(thread.trim());
}
