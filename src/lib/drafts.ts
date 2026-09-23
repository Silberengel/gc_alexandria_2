import type { Event } from 'nostr-tools';
import { KIND, NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import { nip10ReplyTags, nip22TagsForTarget, shouldReplyWithKind1 } from './comments';
import { ratingTags } from './ratings';
import { eventAddress } from './nostr/verify';
import { withBookmarkTag } from './shelves';
import { slugifyPublicationLabel } from './publication-lists';

const TRACKER_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_',
  'source'
]);

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
  // Continue any kind 1 with NIP-10 kind 1; reply to 1111, 9802, etc. with 1111.
  if (replyTo && shouldReplyWithKind1(replyTo)) {
    return {
      kind: KIND.TEXT_NOTE,
      content,
      tags: nip10ReplyTags(replyTo, [target.id])
    };
  }
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

/** `kind:pubkey:d` with a lowercase pubkey, matching Bookshelf highlight coordinates. */
function highlightCoordinate(event: Event): string {
  const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
  return `${event.kind}:${event.pubkey.toLowerCase()}:${d}`;
}

/**
 * NIP-84 highlight using Bookshelf's NIP-22 root/parent tags.
 * Uppercase `A`/`K`/`P` scope the book index; lowercase `a`/`k`/`e`/`p` name the chapter.
 */
export function highlightDraft(
  book: Event,
  section: Event,
  quote: string,
  context?: string
): { kind: number; content: string; tags: string[][] } {
  const tags: string[][] = [
    ['A', highlightCoordinate(book)],
    ['K', String(book.kind)],
    ['P', book.pubkey.toLowerCase()],
    ['a', highlightCoordinate(section)],
    ['k', String(section.kind)],
    ['e', section.id.toLowerCase()],
    ['p', section.pubkey.toLowerCase(), '', 'publisher']
  ];
  const source = chapterSourceUrl(section);
  if (source) tags.push(['r', source, 'source']);
  const ctx = context?.trim();
  if (ctx) tags.push(['context', ctx]);
  return {
    kind: KIND.HIGHLIGHT,
    content: quote,
    tags
  };
}

/** First chapter `r` or `source` URL, with fragments and tracking parameters removed. */
function chapterSourceUrl(chapter: Event): string | null {
  for (const tag of chapter.tags) {
    if (tag[0] !== 'r' && tag[0] !== 'source') continue;
    const cleaned = cleanSourceUrl(tag[1]);
    if (cleaned) return cleaned;
  }
  return null;
}

function cleanSourceUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const kept = [...url.searchParams.entries()].filter(([name]) => {
    const key = name.toLowerCase();
    return !TRACKER_PARAMETERS.has(key) && !key.startsWith('utm_');
  });
  url.hash = '';
  url.search = '';
  for (const [name, param] of kept) url.searchParams.append(name, param);
  return url.toString();
}
