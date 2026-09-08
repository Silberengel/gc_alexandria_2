import type { Event } from 'nostr-tools';
import { KIND, NIP32_BOOKLIST_LABEL, NIP32_UGC_NAMESPACE } from './constants';
import { parseAddress } from './library-scope';

export function extractNip32LabelValues(tags: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (tag[0] !== 'l') continue;
    const value = tag[1]?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function isBooklistLabel(label: string): boolean {
  return label.trim().toLowerCase() === NIP32_BOOKLIST_LABEL;
}

export function labelEventHasBooklistTag(event: Pick<Event, 'tags'>): boolean {
  return extractNip32LabelValues(event.tags).some(isBooklistLabel);
}

export function isBooklistEvent(event: Event): boolean {
  return event.kind === KIND.LABEL && labelEventHasBooklistTag(event);
}

/** Kind 1985 with an `l` tag targeting a publication (any slug, optionally ugc). */
export function isPublicationLabelEvent(event: Event): boolean {
  if (event.kind !== KIND.LABEL) return false;
  if (!extractNip32LabelValues(event.tags).length) return false;
  const { addresses, eventIds } = publicationTargets(event);
  return addresses.length > 0 || eventIds.length > 0;
}

export function labelEventHasSlug(event: Pick<Event, 'tags'>, slug: string): boolean {
  const needle = slug.trim().toLowerCase();
  return extractNip32LabelValues(event.tags).some((v) => v.toLowerCase() === needle);
}

export function labelSlugFromEvent(event: Pick<Event, 'tags'>): string | null {
  return extractNip32LabelValues(event.tags)[0] ?? null;
}

export function isUgcLabelEvent(event: Pick<Event, 'tags'>): boolean {
  return event.tags.some(
    (t) =>
      (t[0] === 'L' && t[1]?.toLowerCase() === NIP32_UGC_NAMESPACE) ||
      (t[0] === 'l' && t[2]?.toLowerCase() === NIP32_UGC_NAMESPACE)
  );
}

/** Publication coordinates (30040 only) and event ids targeted by a label or bookmark. */
export function publicationTargets(event: Event): { addresses: string[]; eventIds: string[] } {
  const addresses: string[] = [];
  const eventIds: string[] = [];
  const seenA = new Set<string>();
  const seenE = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] === 'a' && tag[1]) {
      const parsed = parseAddress(tag[1]);
      if (parsed?.kind === KIND.PUBLICATION && !seenA.has(tag[1])) {
        seenA.add(tag[1]);
        addresses.push(tag[1]);
      }
    }
    if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
      const id = tag[1].toLowerCase();
      if (!seenE.has(id)) {
        seenE.add(id);
        eventIds.push(id);
      }
    }
  }
  return { addresses, eventIds };
}

export function eventTargetsPublication(event: Event, publication: Event): boolean {
  const addr = `${KIND.PUBLICATION}:${publication.pubkey}:${publication.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
  for (const tag of event.tags) {
    if (tag[0] === 'a' && tag[1] === addr) return true;
    if (tag[0] === 'e' && tag[1]?.toLowerCase() === publication.id.toLowerCase()) return true;
  }
  return false;
}
