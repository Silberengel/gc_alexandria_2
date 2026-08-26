import type { Event } from 'nostr-tools';
import { KIND, NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import { nip22TagsForTarget } from './comments';
import { ratingTags } from './ratings';
import { eventAddress } from './nostr/verify';
import { withBookmarkTag } from './shelves';

export function booklistLabelDraft(publication: Event): { kind: number; content: string; tags: string[][] } {
  return {
    kind: KIND.LABEL,
    content: '',
    tags: [
      ['L', NIP32_UGC_NAMESPACE],
      ['l', NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE],
      ['a', eventAddress(publication)]
    ]
  };
}

export function deletionDraft(target: Event): { kind: number; content: string; tags: string[][] } {
  return {
    kind: KIND.DELETION,
    content: '',
    tags: [
      ['e', target.id],
      ['k', String(target.kind)]
    ]
  };
}

export function bookmarkDraft(
  existing: Event | null,
  publication: Event,
  add: boolean
): { kind: number; content: string; tags: string[][] } {
  return {
    kind: KIND.BOOKMARK,
    content: existing?.content ?? '',
    tags: withBookmarkTag(existing, publication, add)
  };
}

export function commentDraft(
  target: Event,
  content: string,
  replyTo?: Event
): { kind: number; content: string; tags: string[][] } {
  return {
    kind: KIND.COMMENT,
    content,
    tags: nip22TagsForTarget(target, replyTo)
  };
}

export function ratingDraft(
  publication: Event,
  value: number
): { kind: number; content: string; tags: string[][] } {
  return {
    kind: KIND.RATING,
    content: '',
    tags: ratingTags(eventAddress(publication), value)
  };
}

export function highlightDraft(
  section: Event,
  quote: string
): { kind: number; content: string; tags: string[][] } {
  const addr = eventAddress(section);
  return {
    kind: KIND.HIGHLIGHT,
    content: quote,
    tags: [
      ['a', addr],
      ['p', section.pubkey],
      ['k', String(section.kind)]
    ]
  };
}
