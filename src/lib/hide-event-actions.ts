/**
 * Hide event on kind 10000 (`e`, optional `a` + author `p`) with cache scrub.
 */
import type { Event } from 'nostr-tools';
import { get } from 'svelte/store';
import { withListMembershipTag, tagsIncludeEvent } from './bookmark-actions';
import { KIND } from './constants';
import {
  applyMuteList,
  decryptPrivateMuteTags,
  isMutedEvent,
  muteState,
  parseMuteList
} from './mute';
import { isAddressableKind } from './nostr/replaceable';
import { scrubCachedAuthor, scrubCachedEvent } from './nostr/cache';
import { eventAddress, firstTag } from './nostr/verify';
import {
  contentForPrivateTags,
  decryptPrivateTagsDetailed
} from './private-tags';
import { pickLatestReplaceable } from './nostr/replaceable';
import { signAndPublish } from './sign';
import { session } from './stores/session';
import { rememberViewerHideTarget } from './viewer-hide';
import { eventOnThreadWatchList, threadWatchListsFromMetadata } from './thread-watch';

export type HideVisibility = 'public' | 'private';

function membershipOnMuteTags(tags: string[][], target: Event): boolean {
  return tagsIncludeEvent(tags, target);
}

function withMuteEventTags(tags: string[][], target: Event, add: boolean): string[][] {
  let next = withListMembershipTag(tags, target, add);
  if (isAddressableKind(target.kind)) {
    const addr = eventAddress(target);
    const withoutA = next.filter((t) => !(t[0] === 'a' && t[1] === addr));
    next = add && addr ? [...withoutA, ['a', addr]] : withoutA;
  }
  return next;
}

function stripPubkey(tags: string[][], pubkey: string): string[][] {
  const pk = pubkey.toLowerCase();
  return tags.filter((t) => !(t[0] === 'p' && (t[1] ?? '').toLowerCase() === pk));
}

async function stripFollowList(target: Event): Promise<boolean> {
  const { follow } = threadWatchListsFromMetadata(session.getMetadata());
  if (!follow || !tagsIncludeEvent(follow.tags, target)) return true;
  const signed = await signAndPublish(
    {
      kind: KIND.THREAD_NOTIFICATION_FOLLOW,
      content: follow.content ?? '',
      tags: withListMembershipTag(follow.tags, target, false)
    },
    { successMessage: 'Unfollowed thread.' }
  );
  return !!signed;
}

async function publishMuteTags(
  publicTags: string[][],
  privateTags: string[][],
  previous: Event | null,
  couldDecrypt: boolean,
  successMessage: string
): Promise<Event | null> {
  let content = '';
  try {
    content = await contentForPrivateTags({
      privateTags,
      previousContent: previous?.content ?? '',
      couldDecryptPrevious: couldDecrypt,
      allowPlaintextFallback: true
    });
  } catch {
    return null;
  }
  const signed = await signAndPublish(
    { kind: KIND.MUTE, content, tags: publicTags },
    { successMessage }
  );
  if (!signed) return null;
  try {
    const extra = await decryptPrivateMuteTags(signed);
    applyMuteList(parseMuteList(signed, extra));
  } catch {
    applyMuteList(parseMuteList(signed, []));
  }
  return signed;
}

/** Remove this event from kind 10000 (public + private buckets). */
export async function unhideEventMembership(target: Event): Promise<boolean> {
  const previous = pickLatestReplaceable(session.getMetadata(), KIND.MUTE);
  if (!previous) return true;
  const detailed = await decryptPrivateTagsDetailed(previous);
  const publicTags = withMuteEventTags(previous.tags, target, false);
  const privateTags = withMuteEventTags(detailed.tags, target, false);
  if (
    publicTags.length === previous.tags.length &&
    privateTags.length === detailed.tags.length
  ) {
    return true;
  }
  const signed = await publishMuteTags(
    publicTags,
    privateTags,
    previous,
    detailed.couldDecrypt,
    'Event unhidden.'
  );
  return !!signed;
}

/** True when target is on the viewer's mute list as `e`/`a` (not only author `p`). */
export function eventHiddenOnMuteList(target: Event, muteList: Event | null): boolean {
  if (!muteList) return false;
  if (membershipOnMuteTags(muteList.tags, target)) return true;
  if (isAddressableKind(target.kind)) {
    const addr = eventAddress(target);
    if (muteList.tags.some((t) => t[0] === 'a' && t[1] === addr)) return true;
  }
  return false;
}

/**
 * Add event hide tags. Caller must pass `confirmConflict` when the event is followed.
 */
export async function hideEventMembership(
  target: Event,
  opts: {
    muteAuthor?: boolean;
    visibility?: HideVisibility;
    confirmConflict?: boolean;
  } = {}
): Promise<boolean> {
  const viewer = session.getPubkey()?.toLowerCase() ?? '';
  if (!viewer) return false;
  if (target.pubkey.toLowerCase() === viewer) return false;

  const { follow } = threadWatchListsFromMetadata(session.getMetadata());
  const followed = eventOnThreadWatchList(target, follow);
  if (followed && !opts.confirmConflict) return false;
  if (followed) {
    const stripped = await stripFollowList(target);
    if (!stripped) return false;
  }

  const visibility = opts.visibility ?? 'private';
  const previous = pickLatestReplaceable(session.getMetadata(), KIND.MUTE);
  const detailed = previous
    ? await decryptPrivateTagsDetailed(previous)
    : { tags: [] as string[][], couldDecrypt: true };

  let publicTags = withMuteEventTags(previous?.tags ?? [], target, false);
  let privateTags = withMuteEventTags(detailed.tags, target, false);
  if (visibility === 'public') publicTags = withMuteEventTags(publicTags, target, true);
  else privateTags = withMuteEventTags(privateTags, target, true);

  if (opts.muteAuthor) {
    const pk = target.pubkey.toLowerCase();
    publicTags = stripPubkey(publicTags, pk);
    privateTags = stripPubkey(privateTags, pk);
    if (visibility === 'public') publicTags = [...publicTags, ['p', pk]];
    else privateTags = [...privateTags, ['p', pk]];
  }

  const signed = await publishMuteTags(
    publicTags,
    privateTags,
    previous,
    detailed.couldDecrypt,
    opts.muteAuthor ? 'Event hidden and author muted.' : 'Event hidden.'
  );
  if (!signed) return false;

  rememberViewerHideTarget(target);
  void scrubCachedEvent(target.id);
  if (opts.muteAuthor) void scrubCachedAuthor(target.pubkey);
  return true;
}

/** Hide or unhide; unhide when already event-muted (not only author). */
export async function toggleHideEvent(
  target: Event,
  opts: {
    muteAuthor?: boolean;
    visibility?: HideVisibility;
    confirmConflict?: boolean;
  } = {}
): Promise<boolean> {
  const muteList = pickLatestReplaceable(session.getMetadata(), KIND.MUTE);
  if (eventHiddenOnMuteList(target, muteList) || isMutedEvent(target, get(muteState))) {
    // Only unhide the event tags — leave author `p` alone unless it was event-only.
    return unhideEventMembership(target);
  }
  return hideEventMembership(target, opts);
}

export function dTagHint(event: Event): string | undefined {
  return firstTag(event, 'd') ?? undefined;
}
