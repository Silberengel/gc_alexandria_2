import type { Event } from 'nostr-tools';
import { KIND, NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import { nip22TagsForTarget } from './comments';
import { ratingTags } from './ratings';
import { eventAddress } from './nostr/verify';
import { withBookmarkTag } from './shelves';
import { slugifyPublicationLabel } from './publication-lists';

export function publicationLabelDraft(
  publication: Event,
  label: string = NIP32_BOOKLIST_LABEL
): { kind: number; content: string; tags: string[][] } {
  const slug = slugifyPublicationLabel(label);
  return {
    kind: KIND.LABEL,
    content: '',
    tags: [
      ['L', NIP32_UGC_NAMESPACE],
      ['l', slug, NIP32_UGC_NAMESPACE],
      ['a', eventAddress(publication)]
    ]
  };
}

export function booklistLabelDraft(
  publication: Event
): { kind: number; content: string; tags: string[][] } {
  return publicationLabelDraft(publication, NIP32_BOOKLIST_LABEL);
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
  stars: number,
  review = ''
): { kind: number; content: string; tags: string[][] } {
  const content = review.trim();
  return {
    kind: KIND.RATING,
    content,
    tags: ratingTags(publication, stars, content.length > 0)
  };
}

export function highlightDraft(
  section: Event,
  quote: string,
  context?: string
): { kind: number; content: string; tags: string[][] } {
  const addr = eventAddress(section);
  const tags: string[][] = [
    ['a', addr],
    ['e', section.id.toLowerCase()],
    ['p', section.pubkey.toLowerCase()],
    ['k', String(section.kind)]
  ];
  const ctx = context?.trim();
  if (ctx) tags.push(['context', ctx]);
  return {
    kind: KIND.HIGHLIGHT,
    content: quote,
    tags
  };
}
