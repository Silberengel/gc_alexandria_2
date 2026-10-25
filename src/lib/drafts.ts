import type { Event } from 'nostr-tools';
import { KIND, NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import {
  canOfferKind1Reply,
  nip10ReplyTags,
  nip22TagsForTarget,
  shouldReplyWithKind1
} from './comments';
import { PUBLICATION_RATING_MARK, ratingTags } from './ratings';
import { eventAddress } from './nostr/verify';
import { slugifyPublicationLabel } from './publication-lists';
import { buildComposePartial } from './compose-build';

const TRACKER_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_'
]);

export function publicationLabelDraft(
  publication: Event,
  label: string = NIP32_BOOKLIST_LABEL
): { kind: number; content: string; tags: string[][] } {
  const slug = slugifyPublicationLabel(label);
  const draft = buildComposePartial({
    kind: KIND.LABEL,
    content: '',
    values: {
      namespace_L: NIP32_UGC_NAMESPACE,
      label_l: slug,
      target_a: eventAddress(publication)
    }
  });
  // NIP-32 ugc labels carry the namespace as the third `l` element.
  const tags = draft.tags.map((t) =>
    t[0] === 'l' && t[1] && !t[2] ? ['l', t[1], NIP32_UGC_NAMESPACE] : t
  );
  return { ...draft, tags };
}

export function deletionDraft(target: Event): { kind: number; content: string; tags: string[][] } {
  const values: Record<string, string> = {
    e: target.id.toLowerCase(),
    k: String(target.kind)
  };
  // NIP-09: also tag the addressable coordinate so clients can hide the whole replaceable series.
  if (target.kind >= 30_000 && target.kind < 40_000) {
    values.a = eventAddress(target);
  }
  return buildComposePartial({
    kind: KIND.DELETION,
    content: '',
    values
  });
}

export function commentDraft(
  target: Event,
  content: string,
  replyTo?: Event,
  opts?: { asKind1Reply?: boolean }
): { kind: number; content: string; tags: string[][] } {
  if (replyTo && shouldReplyWithKind1(replyTo)) {
    return {
      kind: KIND.TEXT_NOTE,
      content,
      tags: nip10ReplyTags(replyTo, [target.id])
    };
  }
  const noteParent = replyTo ?? target;
  if (opts?.asKind1Reply && canOfferKind1Reply(noteParent)) {
    return {
      kind: KIND.TEXT_NOTE,
      content,
      tags: nip10ReplyTags(noteParent, [target.id])
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
  const address = eventAddress(publication);
  const catalog = buildComposePartial({
    kind: KIND.RATING,
    content,
    values: {
      d: address,
      stars: String(Math.min(5, Math.max(1, Math.round(stars)))),
      mark_m: PUBLICATION_RATING_MARK,
      c: content.length > 0 ? 'true' : ''
    }
  });
  // Catalog owns rating/s/m/d/c; app still merges a/A/e/k/p pointers.
  const pointers = ratingTags(publication, stars, content.length > 0).filter(
    (t) => t[0] === 'a' || t[0] === 'A' || t[0] === 'e' || t[0] === 'k' || t[0] === 'p'
  );
  const seen = new Set(catalog.tags.map((t) => t.join('\0')));
  const tags = [...catalog.tags];
  for (const row of pointers) {
    const key = row.join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(row);
  }
  return { kind: KIND.RATING, content, tags };
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
