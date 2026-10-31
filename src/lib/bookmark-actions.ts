/**
 * Toggle NIP-51 membership: kind 10003 bookmarks for other people's events
 * (public or private), kind 10001 pins for the viewer's own (always public).
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  pickBookmarkListWithDeprecated,
  pickPinListWithDeprecated
} from './nip51-deprecated-lists';
import { isAddressableKind } from './nostr/replaceable';
import { eventAddress } from './nostr/verify';
import { contentForPrivateTags, decryptPrivateTagsDetailed } from './private-tags';
import { signAndPublish } from './sign';
import { session } from './stores/session';

export type BookmarkVisibility = 'public' | 'private';

/** Standard list kind for this target relative to the viewer. */
export function membershipListKind(target: Event, viewerPubkey: string): number {
  return target.pubkey.toLowerCase() === viewerPubkey.toLowerCase() ? KIND.PIN : KIND.BOOKMARK;
}

function targetAddress(target: Event): string | null {
  return isAddressableKind(target.kind) ? eventAddress(target) : null;
}

function membershipTag(target: Event): string[] {
  const addr = targetAddress(target);
  return addr ? ['a', addr] : ['e', target.id];
}

/** True when `tags` already reference this event (`a` and/or `e`). */
export function tagsIncludeEvent(tags: string[][], target: Event): boolean {
  const id = target.id.toLowerCase();
  const addr = targetAddress(target);
  for (const tag of tags) {
    if (tag[0] === 'e' && (tag[1] ?? '').toLowerCase() === id) return true;
    if (addr && tag[0] === 'a' && tag[1] === addr) return true;
  }
  return false;
}

/** Public-tag membership only (sync). */
export function listIncludesEvent(list: Event | null | undefined, target: Event): boolean {
  if (!list) return false;
  return tagsIncludeEvent(list.tags, target);
}

/**
 * Add or remove the target on a tag bag while preserving every other tag.
 * Addressable kinds get an `a` tag; others get `e`.
 */
export function withListMembershipTag(
  tags: string[][],
  target: Event,
  add: boolean
): string[][] {
  const id = target.id.toLowerCase();
  const addr = targetAddress(target);
  const without = tags.filter((tag) => {
    if (tag[0] === 'e' && (tag[1] ?? '').toLowerCase() === id) return false;
    if (addr && tag[0] === 'a' && tag[1] === addr) return false;
    return true;
  });
  if (!add) return without;
  return [...without, membershipTag(target)];
}

/**
 * Same as {@link withListMembershipTag}, but takes a list event (or null).
 * Preserves the historical shelves / bookmark helper signature.
 */
export function withBookmarkTag(
  list: Event | null | undefined,
  target: Event,
  add: boolean
): string[][] {
  return withListMembershipTag(list?.tags ?? [], target, add);
}

/** Drop deprecated `d=pin|bookmark` when rewriting onto the standard kind. */
function publicTagsForStandardList(tags: string[][], previous: Event | null): string[][] {
  if (!previous || previous.kind !== KIND.DEPRECATED_CATEGORIZED_LIST) return tags;
  return tags.filter((tag) => tag[0] !== 'd');
}

export function viewerMembershipList(
  target: Event,
  viewerPubkey: string,
  metadata: Event[]
): Event | null {
  const kind = membershipListKind(target, viewerPubkey);
  if (kind === KIND.PIN) return pickPinListWithDeprecated(metadata, viewerPubkey);
  return pickBookmarkListWithDeprecated(metadata, viewerPubkey);
}

/** Where the target already sits on the viewer's pin/bookmark list. */
export async function readMembershipMode(
  target: Event
): Promise<BookmarkVisibility | null> {
  const pubkey = session.getPubkey();
  if (!pubkey) return null;
  const previous = viewerMembershipList(target, pubkey, session.getMetadata());
  if (!previous) return null;
  if (tagsIncludeEvent(previous.tags, target)) return 'public';
  if (membershipListKind(target, pubkey) === KIND.PIN) return null;
  const detailed = await decryptPrivateTagsDetailed(previous);
  if (tagsIncludeEvent(detailed.tags, target)) return 'private';
  return null;
}

async function publishPinToggle(target: Event, add: boolean): Promise<Event | null> {
  const pubkey = session.getPubkey();
  if (!pubkey) return null;
  const previous = pickPinListWithDeprecated(session.getMetadata(), pubkey);
  const nextTags = publicTagsForStandardList(
    withBookmarkTag(previous, target, add),
    previous
  );
  return signAndPublish(
    {
      kind: KIND.PIN,
      content: previous?.content ?? '',
      tags: nextTags
    },
    { successMessage: add ? 'Pinned.' : 'Unpinned.' }
  );
}

/**
 * Set bookmark visibility or remove. Pins are not handled here — use
 * {@link toggleEventPin}. Always strips the target from the other bucket so it
 * is not listed twice.
 */
export async function setEventBookmark(
  target: Event,
  mode: BookmarkVisibility | 'remove'
): Promise<Event | null> {
  const pubkey = session.getPubkey();
  if (!pubkey) return null;
  if (membershipListKind(target, pubkey) === KIND.PIN) return null;

  const previous = pickBookmarkListWithDeprecated(session.getMetadata(), pubkey);
  const detailed = previous
    ? await decryptPrivateTagsDetailed(previous)
    : { tags: [] as string[][], couldDecrypt: true };

  let publicTags = withListMembershipTag(previous?.tags ?? [], target, false);
  let privateTags = withListMembershipTag(detailed.tags, target, false);
  if (mode === 'public') publicTags = withListMembershipTag(publicTags, target, true);
  else if (mode === 'private') privateTags = withListMembershipTag(privateTags, target, true);

  publicTags = publicTagsForStandardList(publicTags, previous);

  let content = '';
  try {
    content = await contentForPrivateTags({
      privateTags,
      previousContent: previous?.content ?? '',
      couldDecryptPrevious: detailed.couldDecrypt,
      allowPlaintextFallback: true
    });
  } catch {
    return null;
  }

  const successMessage =
    mode === 'remove'
      ? 'Bookmark removed.'
      : mode === 'private'
        ? 'Bookmarked privately.'
        : 'Bookmarked.';

  return signAndPublish(
    {
      kind: KIND.BOOKMARK,
      content,
      tags: publicTags
    },
    { successMessage }
  );
}

/** Pin or unpin the viewer's own event (always public tags). */
export async function toggleEventPin(target: Event): Promise<Event | null> {
  const pubkey = session.getPubkey();
  if (!pubkey) return null;
  if (membershipListKind(target, pubkey) !== KIND.PIN) return null;
  const previous = pickPinListWithDeprecated(session.getMetadata(), pubkey);
  const active = listIncludesEvent(previous, target);
  return publishPinToggle(target, !active);
}

/**
 * @deprecated Prefer {@link setEventBookmark} / {@link toggleEventPin}.
 * Kept for call sites that only need a simple flip (pins, or remove when already on).
 */
export async function toggleEventBookmarkOrPin(target: Event): Promise<Event | null> {
  const pubkey = session.getPubkey();
  if (!pubkey) return null;
  if (membershipListKind(target, pubkey) === KIND.PIN) return toggleEventPin(target);
  const mode = await readMembershipMode(target);
  if (mode) return setEventBookmark(target, 'remove');
  return setEventBookmark(target, 'public');
}
