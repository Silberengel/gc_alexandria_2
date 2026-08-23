import { nip19, type Event } from 'nostr-tools';
import { KIND } from './constants';
import { parseAddress } from './library-scope';
import { firstTag, tagValue } from './nostr/verify';
import { indexSlug } from './dtag';
import { coverImageUrl } from './cover';

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
  dTag: string;
  kind: number;
};

export function publicationPath(event: Event): string {
  const d = firstTag(event, 'd') ?? '';
  return `/publication/d/${encodeURIComponent(d)}/p/${encodeURIComponent(event.pubkey)}`;
}

export function wikiPath(event: Event): string {
  const d = firstTag(event, 'd') ?? '';
  return `/wiki/d/${encodeURIComponent(d)}/p/${encodeURIComponent(event.pubkey)}`;
}

export function cardMeta(event: Event): CardMeta {
  const authors = tagValue(event, 'author');
  const nTags = tagValue(event, 'N');
  const titles = tagValue(event, 'title');
  const tTags = tagValue(event, 'T');
  return {
    publishedBy: event.pubkey,
    authors: authors.length ? authors : nTags,
    titles: titles.length ? titles : tTags,
    subjects: tagValue(event, 't'),
    source: firstTag(event, 's') ?? firstTag(event, 'source'),
    identifier: firstTag(event, 'i'),
    language: firstTag(event, 'l'),
    image: coverImageUrl(event),
    summary: firstTag(event, 'summary') ?? event.content.slice(0, 280),
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

/** True when a 30040 index lists at least one section (`a` or `e`), of any kind. */
export function hasPublicationSection(event: Event): boolean {
  if (event.kind !== KIND.PUBLICATION) return false;
  for (const tag of event.tags) {
    if (tag[0] === 'a' && tag[1] && parseAddress(tag[1])) return true;
    if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) return true;
  }
  return false;
}

export function sortSearchResults(events: Event[], sectionCounts: Map<string, number>): Event[] {
  return [...events].sort((a, b) => {
    const aSections = sectionCounts.get(a.id) ?? 0;
    const bSections = sectionCounts.get(b.id) ?? 0;
    const aBoost = aSections >= 2 ? 1 : 0;
    const bBoost = bSections >= 2 ? 1 : 0;
    if (aBoost !== bBoost) return bBoost - aBoost;
    return b.created_at - a.created_at;
  });
}
