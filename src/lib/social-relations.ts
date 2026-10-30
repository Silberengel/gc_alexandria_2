/**
 * Profile follow / mute actions for one pubkey on the viewer's kind-3 contact
 * list and kind-10000 mute list (public tags + NIP-51 private content tags).
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  applyMuteList,
  decryptPrivateMuteTags,
  latestReplaceable,
  parseMuteList
} from './mute';
import {
  contentForPrivateTags,
  decryptPrivateTagsDetailed
} from './private-tags';
import { signAndPublish } from './sign';
import { session } from './stores/session';

const HEX64 = /^[0-9a-f]{64}$/i;

export type RelationVisibility = 'public' | 'private';
export type RelationMode = RelationVisibility | null;

export type PubkeyRelationState = {
  follow: RelationMode;
  mute: RelationMode;
};

function normalizePk(pubkey: string): string {
  return pubkey.trim().toLowerCase();
}

function isPTag(tag: string[]): boolean {
  return tag[0] === 'p' && !!tag[1] && HEX64.test(tag[1]);
}

function tagPubkey(tag: string[]): string {
  return (tag[1] ?? '').toLowerCase();
}

/** Whether `pubkey` appears in public tags and/or private tag rows. */
export function pubkeyRelationMode(
  publicTags: string[][],
  privateTags: string[][],
  pubkey: string
): RelationMode {
  const pk = normalizePk(pubkey);
  if (!pk || !HEX64.test(pk)) return null;
  if (publicTags.some((t) => isPTag(t) && tagPubkey(t) === pk)) return 'public';
  if (privateTags.some((t) => isPTag(t) && tagPubkey(t) === pk)) return 'private';
  return null;
}

/** Drop every `p` for `pubkey`; leave other tags (and other people) alone. */
export function stripPubkeyTags(tags: string[][], pubkey: string): string[][] {
  const pk = normalizePk(pubkey);
  return tags.filter((t) => !(isPTag(t) && tagPubkey(t) === pk));
}

/**
 * Place `pubkey` on public or private tags (or remove from both).
 * Always strips the other bucket so a person is not listed twice.
 */
export function placePubkeyTags(
  publicTags: string[][],
  privateTags: string[][],
  pubkey: string,
  mode: RelationVisibility | 'remove'
): { publicTags: string[][]; privateTags: string[][] } {
  const pk = normalizePk(pubkey);
  let nextPublic = stripPubkeyTags(publicTags, pk);
  let nextPrivate = stripPubkeyTags(privateTags, pk);
  if (mode === 'public') nextPublic = [...nextPublic, ['p', pk]];
  else if (mode === 'private') nextPrivate = [...nextPrivate, ['p', pk]];
  return { publicTags: nextPublic, privateTags: nextPrivate };
}

async function loadListBag(
  kind: number
): Promise<{
  previous: Event | null;
  publicTags: string[][];
  privateTags: string[][];
  couldDecrypt: boolean;
}> {
  const previous = latestReplaceable(session.getMetadata(), kind);
  if (!previous) {
    return { previous: null, publicTags: [], privateTags: [], couldDecrypt: true };
  }
  if (kind === KIND.MUTE) {
    const detailed = await decryptPrivateTagsDetailed(previous);
    return {
      previous,
      publicTags: previous.tags.map((t) => [...t]),
      privateTags: detailed.tags,
      couldDecrypt: detailed.couldDecrypt
    };
  }
  const detailed = await decryptPrivateTagsDetailed(previous);
  return {
    previous,
    publicTags: previous.tags.map((t) => [...t]),
    privateTags: detailed.tags,
    couldDecrypt: detailed.couldDecrypt
  };
}

async function publishListUpdate(
  kind: number,
  publicTags: string[][],
  privateTags: string[][],
  previous: Event | null,
  couldDecrypt: boolean,
  successMessage: string
): Promise<Event | null> {
  const content = await contentForPrivateTags({
    privateTags,
    previousContent: previous?.content ?? '',
    couldDecryptPrevious: couldDecrypt,
    allowPlaintextFallback: true
  });
  const signed = await signAndPublish(
    { kind, content, tags: publicTags },
    { successMessage }
  );
  if (!signed) return null;
  if (kind === KIND.MUTE) {
    try {
      const extra = await decryptPrivateMuteTags(signed);
      applyMuteList(parseMuteList(signed, extra));
    } catch {
      applyMuteList(parseMuteList(signed, []));
    }
  }
  return signed;
}

/** Current follow/mute visibility for `targetPubkey` from session metadata. */
export async function readPubkeyRelationState(
  targetPubkey: string
): Promise<PubkeyRelationState> {
  const pk = normalizePk(targetPubkey);
  const contact = await loadListBag(KIND.CONTACT_LIST);
  const mute = await loadListBag(KIND.MUTE);
  return {
    follow: pubkeyRelationMode(contact.publicTags, contact.privateTags, pk),
    mute: pubkeyRelationMode(mute.publicTags, mute.privateTags, pk)
  };
}

/** Follow publicly, privately, or unfollow (`remove`). */
export async function setFollowRelation(
  targetPubkey: string,
  mode: RelationVisibility | 'remove'
): Promise<boolean> {
  const pk = normalizePk(targetPubkey);
  if (!pk || !HEX64.test(pk)) return false;
  const viewer = session.getPubkey()?.toLowerCase() ?? '';
  if (!viewer || viewer === pk) return false;
  const bag = await loadListBag(KIND.CONTACT_LIST);
  const next = placePubkeyTags(bag.publicTags, bag.privateTags, pk, mode);
  const label =
    mode === 'remove'
      ? 'Unfollowed.'
      : mode === 'private'
        ? 'Following privately.'
        : 'Following.';
  const signed = await publishListUpdate(
    KIND.CONTACT_LIST,
    next.publicTags,
    next.privateTags,
    bag.previous,
    bag.couldDecrypt,
    label
  );
  return !!signed;
}

/** Mute publicly, privately, or unmute (`remove`). */
export async function setMuteRelation(
  targetPubkey: string,
  mode: RelationVisibility | 'remove'
): Promise<boolean> {
  const pk = normalizePk(targetPubkey);
  if (!pk || !HEX64.test(pk)) return false;
  const viewer = session.getPubkey()?.toLowerCase() ?? '';
  if (!viewer || viewer === pk) return false;
  const bag = await loadListBag(KIND.MUTE);
  const next = placePubkeyTags(bag.publicTags, bag.privateTags, pk, mode);
  const label =
    mode === 'remove'
      ? 'Unmuted.'
      : mode === 'private'
        ? 'Muted privately.'
        : 'Muted.';
  const signed = await publishListUpdate(
    KIND.MUTE,
    next.publicTags,
    next.privateTags,
    bag.previous,
    bag.couldDecrypt,
    label
  );
  return !!signed;
}
