import type { Event } from 'nostr-tools';
import { isKind1Reply } from '../comments';
import { KIND } from '../constants';
import type { MuteState } from '../mute';
import { isMutedEvent } from '../mute';
import {
  emptyThreadWatchRefs,
  eventMatchesThreadWatchRefs,
  interactionOnOwnThread,
  isNotificationThreadInteraction,
  type ThreadWatchRefs
} from '../thread-watch';

/**
 * Library / media / bookmark posts for the Original Posts tab (plus kind 1 notes).
 * Top-level web comments (kind 1111 on a URL) are handled separately via
 * {@link isTopLevelWebComment}.
 * Publication indexes (30040), sections (30041), specs (30817), and wikis (30818)
 * stay out — they have hub/search pages, and mass imports would flood Follows /
 * Original Posts.
 */
export const FEED_POST_KINDS = [
  KIND.DJOT,
  KIND.PICTURE,
  KIND.VIDEO,
  KIND.SHORT_VIDEO,
  KIND.VOICE,
  KIND.HIGHLIGHT,
  KIND.LONG_FORM,
  KIND.POLL,
  KIND.ISSUE,
  KIND.GIT_REPO,
  KIND.CALENDAR_DATE,
  KIND.CALENDAR_TIME,
  KIND.RATING,
  KIND.MUSIC,
  KIND.WEB_BOOKMARK,
  KIND.LIVE_EVENT,
  KIND.MEETING_SPACE,
  KIND.MEETING_ROOM
] as const;

export const FEED_KINDS = new Set<number>([KIND.TEXT_NOTE, ...FEED_POST_KINDS]);

/** Responses shown on the Replies tab alongside original posts. */
export const REPLY_ROW_KINDS = new Set<number>([KIND.TEXT_NOTE, KIND.COMMENT, ...FEED_POST_KINDS]);

/** NIP-18 boosts shown on an author's profile feed (collapsed onto the target). */
export const FEED_REPOST_KINDS = [KIND.REPOST, KIND.GENERIC_REPOST] as const;
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
  KIND.PUBLIC_MESSAGE,
  KIND.COMMENT,
  KIND.REACTION,
  KIND.HIGHLIGHT,
  KIND.ZAP,
  KIND.MONERO_TIP,
  KIND.MONERO_TIP_RECEIPT,
  KIND.REPOST,
  KIND.GENERIC_REPOST,
  KIND.RATING
] as const;

const NOTIFICATION_KIND_SET = new Set<number>(NOTIFICATION_KINDS);

/**
 * Distinct kinds that can appear in Follows / Original Posts / Replies /
 * Notifications (for the feed list kind filter). Sorted ascending.
 */
export const FEED_FILTER_KINDS: readonly number[] = Object.freeze(
  [
    ...new Set<number>([
      KIND.TEXT_NOTE,
      ...FEED_POST_KINDS,
      KIND.COMMENT,
      ...FEED_REPOST_KINDS,
      ...NOTIFICATION_KINDS,
      KIND.SNO
    ])
  ].sort((a, b) => a - b)
);

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

export type NotificationInboxContext = {
  followRefs?: ThreadWatchRefs;
  notifMuteRefs?: ThreadWatchRefs;
  mute?: MuteState;
  lookup?: (id: string) => Event | null;
};

/**
 * Someone else's notification-kind event for the viewer: `#p`, own-thread
 * interaction, or 19130-watched subtree — excluding 19132 and muted events.
 */
export function isNotificationForViewer(
  event: Event,
  viewerPubkey: string,
  ctx: NotificationInboxContext = {}
): boolean {
  const pk = viewerPubkey.trim().toLowerCase();
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return false;
  if (event.pubkey.toLowerCase() === pk) return false;
  if (!NOTIFICATION_KIND_SET.has(event.kind)) return false;
  if (ctx.mute && isMutedEvent(event, ctx.mute)) return false;

  const followRefs = ctx.followRefs ?? emptyThreadWatchRefs();
  const notifMuteRefs = ctx.notifMuteRefs ?? emptyThreadWatchRefs();
  const interaction = isNotificationThreadInteraction(event);

  if (
    interaction &&
    eventMatchesThreadWatchRefs(event, notifMuteRefs)
  ) {
    return false;
  }

  const pHit = event.tags.some(
    (tag) => tag[0] === 'p' && (tag[1] ?? '').trim().toLowerCase() === pk
  );
  if (pHit) return true;

  if (!interaction) return false;

  if (interactionOnOwnThread(event, pk, ctx.lookup)) return true;
  if (eventMatchesThreadWatchRefs(event, followRefs)) return true;
  return false;
}
