import type { Filter } from 'nostr-tools';
import { KIND } from '../constants';
import { uniqueRelayUrls } from '../nostr/mailboxes';
import { forestRelay, getSelectorContext } from '../nostr/selector';
import { normalizeFeedKinds } from './tabs';
import { FEED_POST_KINDS, FEED_REPOST_KINDS } from './taxonomy';

export const FOLLOW_AUTHOR_BATCH = 50;
export const FOLLOW_AUTHOR_CAP = 200;

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

export function withFeedSince(filters: Filter[], since: number | null): Filter[] {
  if (since == null) return filters;
  return filters.map((filter) => ({ ...filter, since }));
}

/** Kind 1 alone so relays that honor one filter still return notes. */
export function noteFilters(): Filter[] {
  return [{ kinds: [KIND.TEXT_NOTE], limit: 40 }];
}

export function postFilters(): Filter[] {
  // Single multi-kind filter (relays cap limit ~100). Sparse kinds that the
  // kind dropdown cares about get their own filter in {@link socialAskFilters}.
  return [{ kinds: [...FEED_POST_KINDS], limit: 100 }];
}

/** Kind 9802 alone so highlights are not crowded out of the mixed post filter. */
export function highlightFilters(): Filter[] {
  return [{ kinds: [KIND.HIGHLIGHT], limit: 100 }];
}

export function repostFilters(): Filter[] {
  return [{ kinds: [...FEED_REPOST_KINDS], limit: 40 }];
}

export function commentFilters(): Filter[] {
  return [{ kinds: [KIND.COMMENT], limit: 40 }];
}

/**
 * One REQ batch for the global social feed ask — notes, mixed library posts,
 * highlights, comments, and reposts. Prefer this over five parallel `query()`
 * calls (pool slot contention / wine concurrent REQ limits).
 */
export function socialAskFilters(): Filter[] {
  return [
    ...noteFilters(),
    ...postFilters(),
    ...highlightFilters(),
    ...commentFilters(),
    ...repostFilters()
  ];
}

export function followNoteFilters(authors: string[]): Filter[] {
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
export function followOriginalFilters(authors: string[]): Filter[] {
  const filters: Filter[] = [];
  for (let i = 0; i < authors.length; i += FOLLOW_AUTHOR_BATCH) {
    const batch = authors.slice(i, i + FOLLOW_AUTHOR_BATCH);
    filters.push({ kinds: [KIND.TEXT_NOTE], authors: batch, limit: 20 });
    filters.push({ kinds: [...FEED_POST_KINDS], authors: batch, limit: 16 });
    filters.push({ kinds: [KIND.HIGHLIGHT], authors: batch, limit: 20 });
    filters.push({ kinds: [KIND.COMMENT], authors: batch, limit: 12 });
    filters.push({ kinds: [...FEED_REPOST_KINDS], authors: batch, limit: 16 });
  }
  return filters;
}

export function followReplyFilters(authors: string[]): Filter[] {
  const filters: Filter[] = [];
  for (let i = 0; i < authors.length; i += FOLLOW_AUTHOR_BATCH) {
    const batch = authors.slice(i, i + FOLLOW_AUTHOR_BATCH);
    filters.push({ kinds: [KIND.TEXT_NOTE], authors: batch, limit: 20 });
    filters.push({ kinds: [KIND.COMMENT], authors: batch, limit: 15 });
    filters.push({ kinds: [...FEED_REPOST_KINDS], authors: batch, limit: 15 });
  }
  return filters;
}

export function kindFeedFilters(kinds: readonly number[], authors?: string[]): Filter[] {
  const unique = normalizeFeedKinds(kinds);
  if (!unique.length) return [];
  if (!authors?.length) return [{ kinds: unique, limit: 80 }];
  const filters: Filter[] = [];
  for (let i = 0; i < authors.length; i += FOLLOW_AUTHOR_BATCH) {
    filters.push({
      kinds: unique,
      authors: authors.slice(i, i + FOLLOW_AUTHOR_BATCH),
      limit: 40
    });
  }
  return filters;
}

export function authorNoteFilters(author: string): Filter[] {
  // Profile "View feed" — ask for a full page per kind so inactive authors are
  // not stuck on whatever happened to be in the global feed cache.
  return [
    { kinds: [KIND.TEXT_NOTE], authors: [author], limit: 100 },
    { kinds: [KIND.COMMENT], authors: [author], limit: 100 },
    { kinds: [...FEED_POST_KINDS], authors: [author], limit: 100 },
    { kinds: [KIND.HIGHLIGHT], authors: [author], limit: 100 },
    { kinds: [...FEED_REPOST_KINDS], authors: [author], limit: 100 }
  ];
}
