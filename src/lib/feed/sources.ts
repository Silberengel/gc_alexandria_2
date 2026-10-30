import type { Event } from 'nostr-tools';
import { KIND } from '../constants';
import { filterMuted, followPubkeysFromMetadata, type MuteState } from '../mute';
import { authorOutbox, uniqueRelayUrls, withPreferredRelays } from '../nostr/mailboxes';
import { cachedEventsByKind } from '../nostr/cache';
import { rememberEvents } from '../nostr/event-memory';
import { relayPool } from '../nostr/pool';
import {
  foreignRelaysAllowed,
  getSelectorContext,
  socialSearchStack,
  socialStack
} from '../nostr/selector';
import { feedSinceFromLookback, notificationLookbackSeconds } from './lookback';
import { emptyMute, runFeedLoader, sortFeedEvents } from './loader-shell';
import {
  authorNoteFilters,
  feedRelayGroups,
  FOLLOW_AUTHOR_CAP,
  followNoteFilters,
  followOriginalFilters,
  followReplyFilters,
  kindFeedFilters,
  socialAskFilters,
  withFeedSince
} from './relay-plan';
import { normalizeFeedKinds } from './tabs';
import {
  FEED_POST_KINDS,
  FEED_REPOST_KINDS,
  isNotificationForViewer,
  isOriginalPost,
  isRepliesTimelineEvent,
  NOTIFICATION_KINDS
} from './taxonomy';

const HEX_ID = /^[0-9a-f]{64}$/i;

/**
 * Pubkeys whose original notes are added to a signed-in feed.
 * Always includes the viewer (own posts never rely on the global kind-1 flood).
 * Muted accounts are left out. Capped so one request stays modest.
 */
export function feedFollowAuthors(metadataEvents: Event[], muted: MuteState): string[] {
  const authors: string[] = [];
  const seen = new Set<string>();
  const push = (pubkey: string): void => {
    const pk = pubkey.trim().toLowerCase();
    if (!HEX_ID.test(pk) || muted.pubkeys.has(pk) || seen.has(pk)) return;
    if (authors.length >= FOLLOW_AUTHOR_CAP) return;
    seen.add(pk);
    authors.push(pk);
  };
  const viewer = getSelectorContext().viewerPubkey.trim().toLowerCase();
  if (getSelectorContext().signedIn) push(viewer);
  for (const pubkey of followPubkeysFromMetadata(metadataEvents)) {
    push(pubkey);
    if (authors.length >= FOLLOW_AUTHOR_CAP) break;
  }
  return authors;
}

/** Feed relays plus kind-1 search hosts so follow/author REQs are not stuck on a quiet home relay. */
export function feedAuthorQueryRelays(base: string[]): { relays: string[]; maxRelays: number } {
  const relays = uniqueRelayUrls([...base, ...socialSearchStack()]);
  return { relays, maxRelays: Math.min(Math.max(relays.length, 1), 12) };
}

/** Prefer one author's NIP-65 write relays when looking up their timeline. */
export async function authorFeedQueryScope(authorPubkey: string): Promise<{
  relays: string[];
  maxRelays: number;
}> {
  const { personal, shipped } = feedRelayGroups();
  const base = uniqueRelayUrls([...personal, ...shipped]);
  const baseMax = Math.min(Math.max(base.length, 1), 8);
  if (!foreignRelaysAllowed()) {
    return feedAuthorQueryRelays(base);
  }
  try {
    const outbox = await authorOutbox(authorPubkey);
    const preferred = withPreferredRelays(base, outbox, baseMax, 4);
    return feedAuthorQueryRelays(preferred.relays);
  } catch {
    return feedAuthorQueryRelays(base);
  }
}

function isAuthorEvent(event: Event, authorPubkey: string): boolean {
  return event.pubkey.toLowerCase() === authorPubkey;
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

/** Newest original posts from the session's feed relays, plus follows' notes when signed in. */
export async function loadFeed(
  metadataEvents: Event[] = [],
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void,
  lookbackSeconds: number | null = null
): Promise<Event[]> {
  const since = feedSinceFromLookback(lookbackSeconds);
  const { personal, shipped } = feedRelayGroups();
  const authors = getSelectorContext().signedIn ? feedFollowAuthors(metadataEvents, muted) : [];
  const followFilters = withFeedSince(followNoteFilters(authors), since);
  const followScope = feedAuthorQueryRelays(uniqueRelayUrls([...personal, ...shipped]));
  return runFeedLoader({
    muted,
    onCache,
    lookbackSeconds,
    accept: isOriginalPost,
    recall: recallFeedPosts,
    askFilters: withFeedSince(socialAskFilters(), since),
    personal,
    shipped,
    extraQuery: followFilters.length
      ? {
          relays: followScope.relays,
          maxRelays: followScope.maxRelays,
          filters: followFilters
        }
      : null
  });
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
  const authorSet = new Set(authors);
  const { personal, shipped } = feedRelayGroups();
  const scope = feedAuthorQueryRelays(uniqueRelayUrls([...personal, ...shipped]));
  return runFeedLoader({
    muted,
    onCache,
    lookbackSeconds,
    accept: (event) => isOriginalPost(event) && authorSet.has(event.pubkey.toLowerCase()),
    recall: () => recallFollowsFeed(metadataEvents, muted),
    askFilters: [],
    personal: [],
    shipped: [],
    extraQuery: scope.relays.length
      ? {
          relays: scope.relays,
          maxRelays: scope.maxRelays,
          filters: withFeedSince(followOriginalFilters(authors), since)
        }
      : null
  });
}

/** Cached events for one or more kinds (newest first). */
export async function recallKindFeed(
  kinds: number | readonly number[],
  authors: readonly string[] = []
): Promise<Event[]> {
  const unique = normalizeFeedKinds(Array.isArray(kinds) ? kinds : [kinds]);
  if (!unique.length) return [];
  const stored = (await Promise.all(unique.map((kind) => cachedEventsByKind(kind)))).flat();
  const want = new Set(unique);
  const authorSet =
    authors.length > 0
      ? new Set(authors.map((pk) => pk.trim().toLowerCase()).filter(Boolean))
      : null;
  return stored
    .filter((event) => {
      if (!want.has(event.kind)) return false;
      if (authorSet && !authorSet.has(event.pubkey.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 100);
}

/** Newest events of one or more kinds from the session's feed relays. */
export async function loadKindFeed(
  kinds: number | readonly number[],
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void,
  lookbackSeconds: number | null = null,
  authors: readonly string[] = []
): Promise<Event[]> {
  const unique = normalizeFeedKinds(Array.isArray(kinds) ? kinds : [kinds]);
  if (!unique.length) return [];
  const want = new Set(unique);
  const authorList = [...authors].map((pk) => pk.trim().toLowerCase()).filter(Boolean);
  const authorSet = authorList.length ? new Set(authorList) : null;
  const accept = (event: Event): boolean => {
    if (!want.has(event.kind)) return false;
    if (authorSet && !authorSet.has(event.pubkey.toLowerCase())) return false;
    return true;
  };
  const since = feedSinceFromLookback(lookbackSeconds);
  const { personal, shipped } = feedRelayGroups();
  return runFeedLoader({
    muted,
    onCache,
    lookbackSeconds,
    accept,
    recall: () => recallKindFeed(unique, authorList),
    askFilters: withFeedSince(kindFeedFilters(unique, authorList), since),
    personal,
    shipped
  });
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
  const { personal, shipped } = feedRelayGroups();
  const authors = getSelectorContext().signedIn ? feedFollowAuthors(metadataEvents, muted) : [];
  const followFilters = withFeedSince(followReplyFilters(authors), since);
  const followScope = feedAuthorQueryRelays(uniqueRelayUrls([...personal, ...shipped]));
  return runFeedLoader({
    muted,
    onCache,
    lookbackSeconds,
    accept: isRepliesTimelineEvent,
    recall: recallFeedWithReplies,
    askFilters: withFeedSince(socialAskFilters(), since),
    personal,
    shipped,
    extraQuery: followFilters.length
      ? {
          relays: followScope.relays,
          maxRelays: followScope.maxRelays,
          filters: followFilters
        }
      : null
  });
}

/** Cached replies-timeline events from one author. */
export async function recallAuthorFeedWithReplies(authorPubkey: string): Promise<Event[]> {
  const pk = authorPubkey.trim().toLowerCase();
  if (!HEX_ID.test(pk)) return [];
  return (await recallFeedWithReplies())
    .filter((event) => isAuthorEvent(event, pk))
    .slice(0, 60);
}

/** Cached original posts from one author. */
export async function recallAuthorFeedPosts(authorPubkey: string): Promise<Event[]> {
  const pk = authorPubkey.trim().toLowerCase();
  if (!HEX_ID.test(pk)) return [];
  return (await recallFeedPosts())
    .filter((event) => isAuthorEvent(event, pk))
    .slice(0, 40);
}

/**
 * One author's posts and replies (Replies tab scoped to a profile).
 * Prefer that author's NIP-65 outbox, then feed + kind-1 search relays.
 */
export async function loadAuthorFeedWithReplies(
  authorPubkey: string,
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void
): Promise<Event[]> {
  const pk = authorPubkey.trim().toLowerCase();
  if (!HEX_ID.test(pk)) return [];
  const scope = await authorFeedQueryScope(pk);
  return runFeedLoader({
    muted,
    onCache,
    lookbackSeconds: null,
    queryTimeoutMs: 10_000,
    accept: (event) => isAuthorEvent(event, pk) && isRepliesTimelineEvent(event),
    recall: () => recallAuthorFeedWithReplies(pk),
    askFilters: [],
    personal: [],
    shipped: [],
    extraQuery: scope.relays.length
      ? {
          relays: scope.relays,
          maxRelays: scope.maxRelays,
          filters: authorNoteFilters(pk)
        }
      : null
  });
}

/** One author's original posts (Original Posts tab scoped to a profile). Prefers their outbox. */
export async function loadAuthorFeed(
  authorPubkey: string,
  muted: MuteState = emptyMute,
  onCache?: (events: Event[]) => void
): Promise<Event[]> {
  const pk = authorPubkey.trim().toLowerCase();
  if (!HEX_ID.test(pk)) return [];
  const scope = await authorFeedQueryScope(pk);
  return runFeedLoader({
    muted,
    onCache,
    lookbackSeconds: null,
    queryTimeoutMs: 10_000,
    accept: (event) => isAuthorEvent(event, pk) && isOriginalPost(event),
    recall: () => recallAuthorFeedPosts(pk),
    askFilters: [],
    personal: [],
    shipped: [],
    extraQuery: scope.relays.length
      ? {
          relays: scope.relays,
          maxRelays: scope.maxRelays,
          filters: authorNoteFilters(pk)
        }
      : null
  });
}

/** Relays for the Notifications tab: inbox/favorites first, then social stack. */
export function notificationRelays(): string[] {
  const { personal, shipped } = feedRelayGroups();
  // socialSearchStack() is already empty when GitCitadel reads are off; also skip
  // when Outboxes is off so public hunt hosts (nos.lol, primus, …) stay off.
  const hunt = foreignRelaysAllowed() ? socialSearchStack() : [];
  return uniqueRelayUrls([...personal, ...shipped, ...socialStack(), ...hunt]);
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
  onCache?: (events: Event[]) => void,
  lookbackSeconds: number | null = notificationLookbackSeconds()
): Promise<Event[]> {
  const pk = viewerPubkey.trim().toLowerCase();
  if (!HEX_ID.test(pk)) return [];
  const since = feedSinceFromLookback(lookbackSeconds);
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
  // Relays (and normalizeRelayFilters) cap around 100 — request that ceiling.
  const filters = withFeedSince(
    [{ kinds: [...NOTIFICATION_KINDS], '#p': [pk], limit: 100 }],
    since
  );
  const queryOpts = { includeCooling: true, priority: true as const };
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
    .query(relays, filters, 8000, Math.min(Math.max(relays.length, 1), 12), absorb, queryOpts)
    .catch(() => [] as Event[]);
  for (const event of hits) {
    if (!isNotificationForViewer(event, pk) || !inWindow(event)) continue;
    byId.set(event.id, event);
    rememberEvents([event]);
  }
  return filterMuted(sortFeedEvents([...byId.values()].filter(inWindow)), muted);
}

/** Tab → recall/load dispatch used by the list controller (one registry). */
export type FeedSourceContext = {
  tab: string;
  author: string | null;
  pubkey: string | null;
  meta: Event[];
  muted: MuteState;
  lookbackSec: number | null;
};

export function recallForFeedSource(ctx: FeedSourceContext): Promise<Event[]> {
  const { tab, author, pubkey, meta, muted } = ctx;
  const kinds = normalizeFeedKinds(
    tab.startsWith('kind:')
      ? tab
          .slice('kind:'.length)
          .split('+')
          .map((part) => Number(part))
      : []
  );
  if (tab === 'notifications' && pubkey) return recallNotifications(pubkey);
  if (author) {
    return tab === 'replies' ? recallAuthorFeedWithReplies(author) : recallAuthorFeedPosts(author);
  }
  if (tab === 'follows') return recallFollowsFeed(meta, muted);
  if (kinds.length) return recallKindFeed(kinds);
  if (tab === 'replies') return recallFeedWithReplies();
  return recallFeedPosts();
}

export function loadForFeedSource(
  ctx: FeedSourceContext,
  onCache?: (events: Event[]) => void
): Promise<Event[]> {
  const { tab, author, pubkey, meta, muted, lookbackSec } = ctx;
  const kinds = normalizeFeedKinds(
    tab.startsWith('kind:')
      ? tab
          .slice('kind:'.length)
          .split('+')
          .map((part) => Number(part))
      : []
  );
  if (tab === 'notifications') {
    return loadNotifications(pubkey!, muted, onCache, lookbackSec);
  }
  if (author) {
    return tab === 'replies'
      ? loadAuthorFeedWithReplies(author, muted, onCache)
      : loadAuthorFeed(author, muted, onCache);
  }
  if (tab === 'follows') {
    return loadFollowsFeed(meta, muted, onCache, lookbackSec);
  }
  if (kinds.length) {
    return loadKindFeed(kinds, muted, onCache, lookbackSec);
  }
  if (tab === 'replies') {
    return loadFeedWithReplies(meta, muted, onCache, lookbackSec);
  }
  return loadFeed(meta, muted, onCache, lookbackSec);
}

/** Re-export for callers that sorted after a local merge. */
export { sortFeedEvents, emptyMute };
