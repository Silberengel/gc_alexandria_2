/**
 * Publish Imwald thread notification follow (19130) / mute (19132) lists.
 */
import type { Event } from 'nostr-tools';
import { withListMembershipTag, tagsIncludeEvent } from './bookmark-actions';
import { KIND } from './constants';
import { pickLatestReplaceable } from './nostr/replaceable';
import { signAndPublish } from './sign';
import { session } from './stores/session';
import {
  conflictMessageForFollow,
  conflictMessageForHide,
  conflictMessageForNotifMute,
  eventOnThreadWatchList,
  threadWatchListsFromMetadata
} from './thread-watch';
import { unhideEventMembership } from './hide-event-actions';
import { isMutedEvent, muteState } from './mute';
import { get } from 'svelte/store';

async function publishWatchList(
  kind: number,
  previous: Event | null,
  tags: string[][],
  successMessage: string
): Promise<Event | null> {
  return signAndPublish(
    {
      kind,
      content: previous?.content ?? '',
      tags
    },
    { successMessage }
  );
}

function lists() {
  return threadWatchListsFromMetadata(session.getMetadata());
}

/** Strip `target` from 19130 and/or 19132 (heal exclusivity). */
export async function stripThreadWatchMembership(
  target: Event,
  which: 'follow' | 'notifMute' | 'both'
): Promise<boolean> {
  const { follow, notifMute } = lists();
  let ok = true;
  if (which === 'follow' || which === 'both') {
    if (follow && tagsIncludeEvent(follow.tags, target)) {
      const signed = await publishWatchList(
        KIND.THREAD_NOTIFICATION_FOLLOW,
        follow,
        withListMembershipTag(follow.tags, target, false),
        'Unfollowed thread.'
      );
      if (!signed) ok = false;
    }
  }
  if (which === 'notifMute' || which === 'both') {
    if (notifMute && tagsIncludeEvent(notifMute.tags, target)) {
      const signed = await publishWatchList(
        KIND.THREAD_NOTIFICATION_MUTE,
        notifMute,
        withListMembershipTag(notifMute.tags, target, false),
        'Notification mute removed.'
      );
      if (!signed) ok = false;
    }
  }
  return ok;
}

/**
 * Follow this thread (19130). Others only.
 * Pass `confirmConflict: true` after the exclusivity dialog.
 */
export async function setThreadFollow(
  target: Event,
  add: boolean,
  opts: { confirmConflict?: boolean } = {}
): Promise<boolean> {
  const viewer = session.getPubkey()?.toLowerCase() ?? '';
  if (!viewer) return false;
  if (add && target.pubkey.toLowerCase() === viewer) return false;

  const { follow, notifMute } = lists();
  const onFollow = eventOnThreadWatchList(target, follow);
  const onNotifMute = eventOnThreadWatchList(target, notifMute);
  const hidden = isMutedEvent(target, get(muteState));

  if (add) {
    if (onFollow && !onNotifMute && !hidden) return true;
    if ((onNotifMute || hidden) && !opts.confirmConflict) return false;
    if (onNotifMute) {
      const stripped = await stripThreadWatchMembership(target, 'notifMute');
      if (!stripped) return false;
    }
    if (hidden) {
      const unhidden = await unhideEventMembership(target);
      if (!unhidden) return false;
    }
    const previous = pickLatestReplaceable(
      session.getMetadata(),
      KIND.THREAD_NOTIFICATION_FOLLOW
    );
    const tags = withListMembershipTag(previous?.tags ?? [], target, true);
    const signed = await publishWatchList(
      KIND.THREAD_NOTIFICATION_FOLLOW,
      previous,
      tags,
      'Following thread.'
    );
    return !!signed;
  }

  if (!onFollow) return true;
  const previous = pickLatestReplaceable(
    session.getMetadata(),
    KIND.THREAD_NOTIFICATION_FOLLOW
  );
  const signed = await publishWatchList(
    KIND.THREAD_NOTIFICATION_FOLLOW,
    previous,
    withListMembershipTag(previous?.tags ?? [], target, false),
    'Unfollowed thread.'
  );
  return !!signed;
}

/**
 * Mute this thread in Notifications (19132). Own or others.
 * Pass `confirmConflict: true` after the exclusivity dialog.
 */
export async function setThreadNotifMute(
  target: Event,
  add: boolean,
  opts: { confirmConflict?: boolean } = {}
): Promise<boolean> {
  if (!session.getPubkey()) return false;
  const { follow, notifMute } = lists();
  const onFollow = eventOnThreadWatchList(target, follow);
  const onNotifMute = eventOnThreadWatchList(target, notifMute);

  if (add) {
    if (onNotifMute) return true;
    if (onFollow && !opts.confirmConflict) return false;
    if (onFollow) {
      const stripped = await stripThreadWatchMembership(target, 'follow');
      if (!stripped) return false;
    }
    const previous = pickLatestReplaceable(
      session.getMetadata(),
      KIND.THREAD_NOTIFICATION_MUTE
    );
    const signed = await publishWatchList(
      KIND.THREAD_NOTIFICATION_MUTE,
      previous,
      withListMembershipTag(previous?.tags ?? [], target, true),
      'Muted thread notifications.'
    );
    return !!signed;
  }

  if (!onNotifMute) return true;
  const previous = pickLatestReplaceable(
    session.getMetadata(),
    KIND.THREAD_NOTIFICATION_MUTE
  );
  const signed = await publishWatchList(
    KIND.THREAD_NOTIFICATION_MUTE,
    previous,
    withListMembershipTag(previous?.tags ?? [], target, false),
    'Unmuted thread notifications.'
  );
  return !!signed;
}

export {
  conflictMessageForFollow,
  conflictMessageForHide,
  conflictMessageForNotifMute
};
