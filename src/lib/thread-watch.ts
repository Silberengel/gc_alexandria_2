/**
 * Imwald-style thread notification watch / mute (kinds 19130 / 19132).
 * Membership is `e` / `a` for the event the viewer acted on; matching walks
 * ancestry so following a mid-thread reply catches its descendants.
 */
import type { Event } from 'nostr-tools';
import { tagsIncludeEvent } from './bookmark-actions';
import { KIND } from './constants';
import { isKind1Reply } from './comments';
import { isMutedEvent, type MuteState } from './mute';
import { isAddressableKind, pickLatestReplaceable } from './nostr/replaceable';
import { eventAddress } from './nostr/verify';

const HEX64 = /^[0-9a-f]{64}$/i;

export type ThreadWatchRefs = {
  eIds: Set<string>;
  aCoords: Set<string>;
};

export function emptyThreadWatchRefs(): ThreadWatchRefs {
  return { eIds: new Set(), aCoords: new Set() };
}

export function parseThreadWatchList(list: Event | null | undefined): ThreadWatchRefs {
  const out = emptyThreadWatchRefs();
  if (!list) return out;
  for (const tag of list.tags) {
    const name = (tag[0] ?? '').toLowerCase();
    const value = (tag[1] ?? '').trim();
    if (!value) continue;
    if (name === 'e' && HEX64.test(value)) out.eIds.add(value.toLowerCase());
    else if (name === 'a') out.aCoords.add(value.toLowerCase());
  }
  return out;
}

export function threadWatchListsFromMetadata(metadata: Event[]): {
  follow: Event | null;
  notifMute: Event | null;
} {
  return {
    follow: pickLatestReplaceable(metadata, KIND.THREAD_NOTIFICATION_FOLLOW),
    notifMute: pickLatestReplaceable(metadata, KIND.THREAD_NOTIFICATION_MUTE)
  };
}

/** Exact membership of `event` on a watch list (menu checked state before priority). */
export function eventOnThreadWatchList(
  event: Event,
  list: Event | null | undefined
): boolean {
  if (!list) return false;
  return tagsIncludeEvent(list.tags, event);
}

export function eventMatchesThreadWatchRefs(event: Event, refs: ThreadWatchRefs): boolean {
  if (!refs.eIds.size && !refs.aCoords.size) return false;
  const id = event.id.toLowerCase();
  if (refs.eIds.has(id)) return true;
  if (isAddressableKind(event.kind)) {
    const addr = eventAddress(event).toLowerCase();
    if (addr && refs.aCoords.has(addr)) return true;
  }
  for (const tag of event.tags) {
    const name = tag[0];
    const value = (tag[1] ?? '').trim();
    if (!value) continue;
    if ((name === 'e' || name === 'E') && HEX64.test(value) && refs.eIds.has(value.toLowerCase())) {
      return true;
    }
    if ((name === 'a' || name === 'A') && refs.aCoords.has(value.toLowerCase())) return true;
  }
  return false;
}

/**
 * Replies, reactions, reposts, zaps-on-note, comments, ratings — not top-level OP notes.
 * Mirrors Imwald `isNotificationThreadInteractionEvent`.
 */
export function isNotificationThreadInteraction(event: Event): boolean {
  switch (event.kind) {
    case KIND.TEXT_NOTE:
      return isKind1Reply(event);
    case KIND.COMMENT:
    case KIND.REACTION:
    case KIND.REPOST:
    case KIND.GENERIC_REPOST:
    case KIND.HIGHLIGHT:
    case KIND.ZAP:
    case KIND.MONERO_TIP:
    case KIND.MONERO_TIP_RECEIPT:
    case KIND.RATING:
    case KIND.PUBLIC_MESSAGE:
      return true;
    default:
      return false;
  }
}

/** True when ancestry tags reference an event id/address authored by `viewerPubkey`. */
export function interactionOnOwnThread(
  event: Event,
  viewerPubkey: string,
  lookup?: (id: string) => Event | null
): boolean {
  const pk = viewerPubkey.trim().toLowerCase();
  if (!pk || !HEX64.test(pk)) return false;
  for (const tag of event.tags) {
    const name = tag[0];
    const value = (tag[1] ?? '').trim();
    if (!value) continue;
    if ((name === 'p' || name === 'P') && value.toLowerCase() === pk) {
      // `#p` alone is handled separately; own-thread means root/parent authorship.
      continue;
    }
    if ((name === 'e' || name === 'E') && HEX64.test(value) && lookup) {
      const parent = lookup(value.toLowerCase());
      if (parent && parent.pubkey.toLowerCase() === pk) return true;
    }
    if ((name === 'a' || name === 'A') && value.toLowerCase().includes(`:${pk}:`)) {
      return true;
    }
  }
  return false;
}

export type ThreadWatchEffective = {
  followed: boolean;
  notifMuted: boolean;
  hidden: boolean;
};

/**
 * Effective UI / matcher state when wire lists conflict.
 * Hide (10000 e) and 19132 both beat 19130 follow.
 */
export function effectiveThreadWatchState(
  event: Event,
  opts: {
    followList: Event | null;
    notifMuteList: Event | null;
    mute: MuteState;
  }
): ThreadWatchEffective {
  const hidden = isMutedEvent(event, opts.mute);
  const rawFollow = eventOnThreadWatchList(event, opts.followList);
  const rawMute = eventOnThreadWatchList(event, opts.notifMuteList);
  const notifMuted = rawMute;
  const followed = rawFollow && !hidden && !notifMuted;
  return { followed, notifMuted, hidden };
}

export function conflictMessageForFollow(from: 'notifMute' | 'hide'): string {
  if (from === 'hide') {
    return 'This thread is hidden. Following it will unhide it and move it to your followed threads. Continue?';
  }
  return 'This thread is muted for notifications. Following it will unmute notifications for it. Continue?';
}

export function conflictMessageForNotifMute(): string {
  return 'This thread is followed. Muting notifications will unfollow it. Continue?';
}

export function conflictMessageForHide(): string {
  return 'This thread is followed. Hiding it will unfollow it. Continue?';
}

