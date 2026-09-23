import { nip19, type Event } from 'nostr-tools';
import { KIND } from './constants';
import { blurbMarkupForKind, cardBlurb } from './card-blurb';
import { compareAuthorsByGrapevine, type GrapevineTrustContext } from './grapevine-rank';
import { parseAddress } from './library-scope';
import { looksLikeNativeAsciidoc } from './markup';
import { firstTag, tagValue } from './nostr/verify';
import { indexSlug } from './dtag';
import { coverImageUrl } from './cover';
import {
  isDeferralPlaceholderContent,
  isWikiDeference,
  wikiDeferTargetHref
} from './wiki-defer';

export type CardMeta = {
  publishedBy: string;
  authors: string[];
  titles: string[];
  subjects: string[];
  source?: string;
  identifier?: string;
  language?: string;
  image?: string;
  summary?: string;
  /** Wiki deference — show elegant notice instead of placeholder body. */
  defers?: boolean;
  deferHref?: string;
  dTag: string;
  kind: number;
};

export function publicationPath(event: Event): string {
  const d = firstTag(event, 'd') ?? '';
  return `/publication/d/${encodeURIComponent(d)}/p/${nip19.npubEncode(event.pubkey)}`;
}

export function wikiPath(event: Event): string {
  const d = firstTag(event, 'd') ?? '';
  return `/wiki/d/${encodeURIComponent(d)}/p/${nip19.npubEncode(event.pubkey)}`;
}

export function cardMeta(event: Event): CardMeta {
  const authors = tagValue(event, 'author');
  const nTags = tagValue(event, 'N');
  const titles = tagValue(event, 'title');
  const tTags = tagValue(event, 'T');
  const summaryTag = firstTag(event, 'summary');
  const rawSummary = summaryTag?.trim() || event.content.trim().slice(0, 800) || '';
  const defers = isWikiDeference(event) || isDeferralPlaceholderContent(event.content);
  const deferHref = defers ? wikiDeferTargetHref(event) ?? undefined : undefined;
  let summary: string | undefined;
  if (!defers || (summaryTag && !isDeferralPlaceholderContent(summaryTag))) {
    const markup =
      looksLikeNativeAsciidoc(rawSummary) ? 'asciidoc' : blurbMarkupForKind(event.kind);
    const fromContent = cardBlurb(rawSummary, { markup, max: 280 }) || undefined;
    // Never surface deferral placeholders as the teaser.
    summary =
      fromContent && !isDeferralPlaceholderContent(fromContent) ? fromContent : undefined;
  }
  return {
    publishedBy: event.pubkey,
    authors: authors.length ? authors : nTags,
    titles: titles.length ? titles : tTags,
    subjects: tagValue(event, 't'),
    source: firstTag(event, 's') ?? firstTag(event, 'source'),
    identifier: firstTag(event, 'i'),
    language: firstTag(event, 'l'),
    image: coverImageUrl(event),
    summary,
    defers: defers || undefined,
    deferHref,
    dTag: firstTag(event, 'd') ?? '',
    kind: event.kind
  };
}

export function displayTitle(event: Event): string {
  const m = cardMeta(event);
  if (m.titles[0]) return m.titles[0];
  if (m.dTag) return m.dTag.replace(/-/g, ' ');
  return 'Untitled';
}

export function npubFromInput(input: string): string | null {
  const trimmed = input.trim().replace(/^nostr:/i, '');
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    try {
      return nip19.npubEncode(trimmed.toLowerCase());
    } catch {
      return null;
    }
  }
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub') return trimmed;
    if (decoded.type === 'nprofile') return nip19.npubEncode(decoded.data.pubkey);
  } catch {
    return null;
  }
  return null;
}

export function hexPubkey(input: string): string | null {
  const trimmed = input.trim().replace(/^nostr:/i, '');
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    return null;
  }
  return null;
}

export function searchAuthorSlug(name: string): string {
  return indexSlug(name);
}

export function countSections(event: Event, sections: Event[]): number {
  const addr = `${KIND.PUBLICATION}:${event.pubkey}:${firstTag(event, 'd') ?? ''}`;
  return sections.filter((s) =>
    s.tags.some((t) => t[0] === 'a' && t[1] === addr)
  ).length;
}

/** True when a 30040 index lists at least one section: any `e`, or an `a` whose kind is not 30040. */
export function hasPublicationSection(event: Event): boolean {
  if (event.kind !== KIND.PUBLICATION) return false;
  for (const tag of event.tags) {
    if (tag[0] === 'a' && tag[1]) {
      const parsed = parseAddress(tag[1]);
      // Nested publication indexes are not readable sections.
      if (parsed && parsed.kind !== KIND.PUBLICATION) return true;
    }
    if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) return true;
  }
  return false;
}

/** Search kind tier: publications first, then wiki/spec, then everything else. */
export function searchKindTier(kind: number): number {
  if (kind === KIND.PUBLICATION) return 0;
  if (kind === KIND.WIKI || kind === KIND.SPEC) return 1;
  return 2;
}

export function sortSearchResults(
  events: Event[],
  sectionCounts: Map<string, number>,
  grapevine?: GrapevineTrustContext | null
): Event[] {
  return [...events].sort((a, b) => {
    const kindDiff = searchKindTier(a.kind) - searchKindTier(b.kind);
    if (kindDiff !== 0) return kindDiff;
    const aSections = sectionCounts.get(a.id) ?? 0;
    const bSections = sectionCounts.get(b.id) ?? 0;
    const aBoost = aSections >= 2 ? 1 : 0;
    const bBoost = bSections >= 2 ? 1 : 0;
    if (aBoost !== bBoost) return bBoost - aBoost;
    if (grapevine) {
      const byRank = compareAuthorsByGrapevine(a.pubkey, b.pubkey, grapevine);
      if (byRank !== 0) return byRank;
    }
    return b.created_at - a.created_at;
  });
}
