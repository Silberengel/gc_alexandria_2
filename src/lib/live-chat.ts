import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { referencesTarget, type WorkResponses } from './comments';
import { commentParentId } from './comments';
import { eventAddress } from './nostr/verify';
import { NIP53_KIND, liveChatActivityAddress } from './nip53';
import { filterMuted, type MuteState } from './mute';
import { contentWithoutMediaUrls, uniqueMedia } from './media';
import {
  shouldHideEventByGrapevine,
  type GrapevineTrustContext
} from './grapevine-rank';

export type LiveChatRow =
  | { type: 'message'; event: Event; replyToId: string | null }
  | { type: 'presence'; event: Event; handRaised: boolean };

/**
 * NIP-53 live chat is address-rooted on the activity. An optional `e` tag may
 * name a parent chat message, but Streamstr and most hosts post flat under the
 * root `a` tag — we still render a flat timeline either way.
 */
export function liveChatReplyParentId(event: Event): string | null {
  if (event.kind !== KIND.LIVE_CHAT) return null;
  for (const tag of event.tags) {
    if (tag[0] !== 'e') continue;
    const id = (tag[1] ?? '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(id)) return id;
  }
  return null;
}

/** True when this event belongs to the live activity (a-tag / id), not a nested reply chain. */
export function isLiveChatForActivity(event: Event, activity: Event): boolean {
  if (event.kind !== KIND.LIVE_CHAT) return false;
  if (referencesTarget(event, activity)) return true;
  const addr = liveChatActivityAddress(event);
  return !!addr && addr === eventAddress(activity);
}

export function isPresenceForActivity(event: Event, activity: Event): boolean {
  if (event.kind !== KIND.ROOM_PRESENCE) return false;
  return referencesTarget(event, activity);
}

/** Drop presence older than this (NIP-53: clients SHOULD filter stale presence). */
export const LIVE_PRESENCE_WINDOW_SEC = 30 * 60;

/** Re-publish kind 10312 while the viewer stays on a live thread (once on enter, then this often). */
export const LIVE_PRESENCE_REFRESH_MS = 5 * 60 * 1000;

export type LivePresencePerson = {
  pubkey: string;
  handRaised: boolean;
  created_at: number;
};

/**
 * Unique listeners currently in the room (newest presence wins per pubkey).
 * Newest first for the avatar strip.
 */
export function collectLivePresence(
  activity: Event,
  responses: WorkResponses,
  nowSec = Math.floor(Date.now() / 1000)
): LivePresencePerson[] {
  const pool = [...responses.thread, ...responses.other, ...(responses.quotes ?? [])];
  const byPubkey = new Map<string, LivePresencePerson>();
  for (const event of pool) {
    if (!isPresenceForActivity(event, activity)) continue;
    if (nowSec - event.created_at > LIVE_PRESENCE_WINDOW_SEC) continue;
    const pubkey = event.pubkey.toLowerCase();
    const handRaised = event.tags.some(
      (t) => t[0] === 'hand' && (t[1] ?? '').trim() === '1'
    );
    const prev = byPubkey.get(pubkey);
    if (prev && prev.created_at >= event.created_at) continue;
    byPubkey.set(pubkey, { pubkey, handRaised, created_at: event.created_at });
  }
  return [...byPubkey.values()].sort((a, b) => b.created_at - a.created_at);
}

/**
 * Flat chronological feed for a kind 30311: chat messages + presence lines.
 * Newest first — compose sits above the list, so fresh posts stay under the box
 * instead of sinking as older history loads in.
 * Reply `e` tags are recorded but do not nest rows (Twitch-style).
 */
export function collectLiveChatRows(
  activity: Event,
  responses: WorkResponses,
  extra: Event[] = []
): LiveChatRow[] {
  const pool = [
    ...responses.thread,
    ...responses.other,
    ...(responses.quotes ?? []),
    ...extra
  ];
  const byId = new Map<string, Event>();
  for (const event of pool) {
    if (!event?.id) continue;
    byId.set(event.id.toLowerCase(), event);
  }

  const rows: LiveChatRow[] = [];
  for (const event of byId.values()) {
    if (isLiveChatForActivity(event, activity)) {
      rows.push({
        type: 'message',
        event,
        replyToId: liveChatReplyParentId(event)
      });
      continue;
    }
    if (isPresenceForActivity(event, activity)) {
      const hand = event.tags.some(
        (t) => t[0] === 'hand' && (t[1] ?? '').trim() === '1'
      );
      rows.push({ type: 'presence', event, handRaised: hand });
    }
  }

  rows.sort((a, b) => {
    const dt = b.event.created_at - a.event.created_at;
    if (dt !== 0) return dt;
    return b.event.id.localeCompare(a.event.id);
  });
  return rows;
}

/** How many chat messages carry an `e` reply parent that is also in this feed. */
export function countNestedLiveChatReplies(rows: LiveChatRow[]): number {
  const ids = new Set(
    rows.filter((r) => r.type === 'message').map((r) => r.event.id.toLowerCase())
  );
  let n = 0;
  for (const row of rows) {
    if (row.type !== 'message' || !row.replyToId) continue;
    if (ids.has(row.replyToId)) n += 1;
  }
  return n;
}

/** Draft a kind 1311 live chat message rooted on the activity `a` tag. */
export function liveChatDraft(
  activity: Event,
  content: string
): { kind: number; content: string; tags: string[][] } {
  const addr = eventAddress(activity);
  return {
    kind: NIP53_KIND.LIVE_CHAT,
    content,
    tags: [['a', addr, '', 'root']]
  };
}

/**
 * Draft a kind 10312 room presence for a live activity (NIP-53).
 * Regular replaceable — one presence room per pubkey at a time.
 */
export function roomPresenceDraft(
  activity: Event,
  opts?: { handRaised?: boolean; relayHint?: string }
): { kind: number; content: string; tags: string[][] } {
  const addr = eventAddress(activity);
  const relay = (opts?.relayHint ?? '').trim();
  const tags: string[][] = [['a', addr, relay, 'root']];
  if (opts?.handRaised) tags.push(['hand', '1']);
  return {
    kind: NIP53_KIND.ROOM_PRESENCE,
    content: '',
    tags
  };
}

/**
 * Unsigned stand-in so the avatar strip paints the viewer immediately while the
 * real kind-10312 is signed and published (relays may be slow or rate-limited).
 */
export function localRoomPresence(
  activity: Event,
  pubkey: string,
  opts?: { handRaised?: boolean; relayHint?: string }
): Event {
  const pk = pubkey.trim().toLowerCase();
  const draft = roomPresenceDraft(activity, opts);
  return {
    // Deterministic placeholder id (64 hex) — never published.
    id: (pk + '0'.repeat(64)).slice(0, 64),
    pubkey: pk,
    created_at: Math.floor(Date.now() / 1000),
    kind: NIP53_KIND.ROOM_PRESENCE,
    tags: draft.tags,
    content: '',
    sig: ''
  };
}

/** Parent pointer used by nestComments — for diagnostics. */
export function liveChatNestParent(event: Event): string | null {
  if (event.kind !== KIND.LIVE_CHAT) return null;
  return commentParentId(event);
}

/**
 * Shield-on display: mute list, optional GrapeRank gate, and media collapse.
 * When Shield is off, callers should skip this and show every row.
 */
export function filterLiveChatForShield(
  events: Event[],
  muted: MuteState,
  grapevine: GrapevineTrustContext | null
): Event[] {
  let next = filterMuted(events, muted);
  if (grapevine?.trustFilterEnabled) {
    next = next.filter((event) => !shouldHideEventByGrapevine(event, grapevine));
  }
  return next;
}

/** Text left after stripping media URLs; empty means the line was media-only. */
export function liveChatShieldText(event: Event): { mediaOnly: boolean; text: string } {
  const media = uniqueMedia(event);
  if (!media.length) return { mediaOnly: false, text: event.content ?? '' };
  const text = contentWithoutMediaUrls(event.content ?? '', media);
  return { mediaOnly: !text, text };
}
