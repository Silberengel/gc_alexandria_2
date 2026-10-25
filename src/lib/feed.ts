import type { Event, Filter } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import { isKind1Reply } from './comments';
import { hexPubkey } from './metadata';
import { filterMuted, followPubkeysFromMetadata, type MuteState } from './mute';
import { uniqueRelayUrls } from './nostr/mailboxes';
import { memoryGetEvent, rememberEvents } from './nostr/event-memory';
import { cachedEventsByKind, cacheGetEvent } from './nostr/cache';
import { fetchByAddress } from './nostr/fetch';
import { relayPool } from './nostr/pool';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { forestRelay, getSelectorContext, socialStack } from './nostr/selector';
import { firstTag } from './nostr/verify';

const FOLLOW_AUTHOR_BATCH = 50;
const FOLLOW_AUTHOR_CAP = 200;
/** How far back the Notifications tab looks on relays. */
const NOTIFICATION_LOOKBACK_SEC = 7 * 24 * 60 * 60;

/**
 * Library / media / bookmark posts for the Original Posts tab (plus kind 1 notes).
 * Top-level web comments (kind 1111 on a URL) are handled separately via
 * {@link isTopLevelWebComment}.
 */
const FEED_POST_KINDS = [
  KIND.DJOT,
  KIND.PICTURE,
  KIND.VIDEO,
  KIND.SHORT_VIDEO,
  KIND.VOICE,
  KIND.HIGHLIGHT,
  KIND.LONG_FORM,
  KIND.PUBLICATION,
  KIND.WIKI,
  KIND.SPEC,
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

export type FeedTab = 'original' | 'replies' | 'notifications';

export function parseFeedTab(raw: string | null | undefined): FeedTab {
  const t = (raw ?? '').trim().toLowerCase();
  if (t === 'replies' || t === 'notifications') return t;
  return 'original';
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

const emptyMute: MuteState = { pubkeys: new Set(), eventIds: new Set() };

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
  return pruneToLatestReplaceables(events).sort((a, b) => b.created_at - a.created_at);
}

/** Newest original posts from the session's feed relays, plus follows' notes when signed in. */
export async function loadFeed(
  metadataEvents: Event[] = [],
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void
): Promise<Event[]> {
  const cached = filterMuted(await recallFeedPosts(), muted);
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
  const authors = getSelectorContext().signedIn ? feedFollowAuthors(metadataEvents, muted) : [];
  const followFilters = followNoteFilters(authors);
  // Background list load — not priority. Priority slots are for open threads / wiki.
  const queryOpts = { includeCooling: true };
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (!isOriginalPost(event) || byId.has(event.id)) continue;
      byId.set(event.id, event);
      added = true;
    }
    if (added) paint();
  };
  const ask = (urls: string[], maxRelays: number): Promise<Event[]> =>
    Promise.all([
      relayPool.query(urls, noteFilters(), 7000, maxRelays, absorb, queryOpts),
      relayPool.query(urls, postFilters(), 7000, maxRelays, absorb, queryOpts),
      relayPool.query(urls, commentFilters(), 7000, maxRelays, absorb, queryOpts),
      relayPool.query(urls, repostFilters(), 7000, maxRelays, absorb, queryOpts)
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
    if (!isOriginalPost(event)) continue;
    byId.set(event.id, event);
  }
  return filterMuted(sortFeedEvents([...byId.values()]), muted);
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
  onCache?: (events: Event[]) => void
): Promise<Event[]> {
  const cached = filterMuted(await recallFeedWithReplies(), muted);
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
  const authors = getSelectorContext().signedIn ? feedFollowAuthors(metadataEvents, muted) : [];
  const followFilters = followReplyFilters(authors);
  const queryOpts = { includeCooling: true };
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (!isRepliesTimelineEvent(event) || byId.has(event.id)) continue;
      byId.set(event.id, event);
      added = true;
    }
    if (added) paint();
  };
  const ask = (urls: string[], maxRelays: number): Promise<Event[]> =>
    Promise.all([
      relayPool.query(urls, noteFilters(), 7000, maxRelays, absorb, queryOpts),
      relayPool.query(urls, commentFilters(), 7000, maxRelays, absorb, queryOpts),
      relayPool.query(urls, postFilters(), 7000, maxRelays, absorb, queryOpts),
      relayPool.query(urls, repostFilters(), 7000, maxRelays, absorb, queryOpts)
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
    if (!isRepliesTimelineEvent(event)) continue;
    byId.set(event.id, event);
  }
  return filterMuted(sortFeedEvents([...byId.values()]), muted);
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
 */
export async function loadNotifications(
  viewerPubkey: string,
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void
): Promise<Event[]> {
  const pk = viewerPubkey.trim().toLowerCase();
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return [];
  const cached = filterMuted(await recallNotifications(pk), muted);
  const byId = new Map<string, Event>();
  const paint = (): void => {
    const rows = filterMuted(sortFeedEvents([...byId.values()]), muted);
    if (rows.length) onCache?.(rows);
  };
  for (const event of cached) byId.set(event.id, event);
  if (byId.size) paint();
  const relays = notificationRelays();
  if (!relays.length) return filterMuted(sortFeedEvents([...byId.values()]), muted);
  const since = Math.floor(Date.now() / 1000) - NOTIFICATION_LOOKBACK_SEC;
  const filters: Filter[] = [
    {
      kinds: [...NOTIFICATION_KINDS],
      '#p': [pk],
      since,
      limit: 120
    }
  ];
  const queryOpts = { includeCooling: true };
  const absorb = (batch: Event[]): void => {
    let added = false;
    for (const event of batch) {
      if (!isNotificationForViewer(event, pk) || byId.has(event.id)) continue;
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
    if (!isNotificationForViewer(event, pk)) continue;
    byId.set(event.id, event);
    rememberEvents([event]);
  }
  return filterMuted(sortFeedEvents([...byId.values()]), muted);
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

/**
 * In-feed thread URL on the same `/feed` route (query `thread=`).
 * Staying on `/feed` avoids remounting the list when opening/closing a card.
 */
export type FeedListOpts = { author?: string | null };

function appendFeedAuthor(q: URLSearchParams, author?: string | null): void {
  const hex = author?.trim().toLowerCase();
  if (hex && /^[0-9a-f]{64}$/.test(hex)) q.set('author', hex);
}

export function feedThreadPath(
  event: Event,
  tab: FeedTab = 'original',
  opts: FeedListOpts = {}
): string {
  const q = new URLSearchParams();
  q.set('thread', feedThreadPointer(event));
  if (tab !== 'original') q.set('tab', tab);
  appendFeedAuthor(q, opts.author);
  return `/feed?${q.toString()}`;
}

/** List URL for a feed tab (no open thread). */
export function feedListPath(tab: FeedTab = 'original', opts: FeedListOpts = {}): string {
  const q = new URLSearchParams();
  if (tab !== 'original') q.set('tab', tab);
  appendFeedAuthor(q, opts.author);
  const s = q.toString();
  return s ? `/feed?${s}` : '/feed';
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
