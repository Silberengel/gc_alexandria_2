import type { Event } from 'nostr-tools';
import { KIND, NIP32_BOOKLIST_LABEL } from './constants';
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
