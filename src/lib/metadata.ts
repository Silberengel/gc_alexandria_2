import { nip19, type Event } from 'nostr-tools';
import { KIND } from './constants';
import { blurbMarkupForKind, cardBlurb } from './card-blurb';
import { compareAuthorsByGrapevine, type GrapevineTrustContext } from './grapevine-rank';
import { parseAddress } from './library-scope';
import { looksLikeNativeAsciidoc } from './markup';
import { firstTag, tagValue } from './nostr/verify';
import { indexSlug, normalizeDTag } from './dtag';
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
    const fromContent = cardBlurb(rawSummary, { markup, max: 250 }) || undefined;
    // Never surface deferral placeholders as the teaser.
    summary =
      fromContent && !isDeferralPlaceholderContent(fromContent) ? fromContent : undefined;
  }
  return {
    publishedBy: event.pubkey,
    authors: authors.length ? authors : nTags,
    titles: (titles.length ? titles : tTags)
      .map((t) => {
        const plain = typeof t === 'string' ? t : String(t ?? '');
        if (!plain.trim()) return '';
        return cardBlurb(plain, { markup: 'markdown', max: 100 }) || plain.slice(0, 100);
      })
      .filter(Boolean),
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
  const raw = m.titles[0] || (m.dTag ? m.dTag.replace(/-/g, ' ') : '') || 'Untitled';
  if (raw === 'Untitled') return raw;
  return cardBlurb(raw, { markup: 'markdown', max: 100 }) || raw.slice(0, 100);
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

/** Count walkable child pointers on a 30040 (`a`/`A`/`e`/`E`). */
export function publicationSectionCount(event: Event): number {
  let n = 0;
  for (const tag of event.tags) {
    const name = tag[0];
    if ((name === 'a' || name === 'A') && tag[1] && parseAddress(tag[1])) n += 1;
    else if ((name === 'e' || name === 'E') && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) n += 1;
  }
  return n;
}

/** True when a 30040 index lists children to walk: any `a`/`A` (including nested 30040) or `e`/`E`. */
export function hasPublicationSection(event: Event): boolean {
  return event.kind === KIND.PUBLICATION && publicationSectionCount(event) > 0;
}

/**
 * When two copies of the same event id disagree on tags (search sources vary),
 * keep the one with more section pointers so cover badges and readers stay correct.
 */
export function preferRicherEvent(a: Event, b: Event): Event {
  if (a.id.toLowerCase() !== b.id.toLowerCase()) return b;
  const sa = publicationSectionCount(a);
  const sb = publicationSectionCount(b);
  if (sa !== sb) return sa > sb ? a : b;
  if (a.tags.length !== b.tags.length) return a.tags.length > b.tags.length ? a : b;
  return b;
}

/** Search kind tier: publications first, then wiki/spec, then everything else. */
export function searchKindTier(kind: number): number {
  if (kind === KIND.PUBLICATION) return 0;
  if (kind === KIND.WIKI || kind === KIND.SPEC) return 1;
  return 2;
}

/** True when the event's d-tag equals the normalized query slug (or a variant). */
export function eventMatchesSearchD(event: Event, exactD: string): boolean {
  const want = normalizeDTag(exactD);
  if (!want) return false;
  const d = firstTag(event, 'd') ?? '';
  if (!d) return false;
  return normalizeDTag(d) === want;
}

export type SearchSortOpts = {
  /** Prefer events whose d-tag equals this slug (wikilink / ?d= searches). */
  exactD?: string;
};

export function sortSearchResults(
  events: Event[],
  sectionCounts: Map<string, number>,
  grapevine?: GrapevineTrustContext | null,
  opts?: SearchSortOpts
): Event[] {
  const exactD = opts?.exactD ? normalizeDTag(opts.exactD) : '';
  return [...events].sort((a, b) => {
    const kindDiff = searchKindTier(a.kind) - searchKindTier(b.kind);
    if (kindDiff !== 0) return kindDiff;
    if (exactD) {
      const aExact = eventMatchesSearchD(a, exactD) ? 1 : 0;
      const bExact = eventMatchesSearchD(b, exactD) ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
    }
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
