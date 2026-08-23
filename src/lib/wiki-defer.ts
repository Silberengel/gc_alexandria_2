import type { Event } from 'nostr-tools';
import { KIND } from './constants';

export type WikiReference = {
  coordinate?: string;
  eventId?: string;
  relayHint?: string;
};

function tagMarker(tag: string[]): string | undefined {
  return tag[3]?.trim() || undefined;
}

function readReferenceByMarker(event: Event, marker: string): WikiReference | undefined {
  const aTag = event.tags.find((t) => t[0] === 'a' && tagMarker(t) === marker && t[1]);
  const eTag = event.tags.find((t) => t[0] === 'e' && tagMarker(t) === marker && t[1]);
  if (!aTag && !eTag) return undefined;
  return {
    coordinate: aTag?.[1],
    eventId: eTag?.[1],
    relayHint: aTag?.[2] || eTag?.[2] || undefined
  };
}

/** Kind 30818 that tags another version with marker `defer`. */
export function getWikiDeferTarget(event: Event): WikiReference | undefined {
  if (event.kind !== KIND.WIKI) return undefined;
  return readReferenceByMarker(event, 'defer');
}

export function isWikiDeference(event: Event): boolean {
  return !!getWikiDeferTarget(event);
}

export function isDeferralPlaceholderContent(content: string): boolean {
  return /^\s*Read nostr:(?:nevent|naddr|note)1[a-z0-9]+ instead\.?\s*$/i.test(content);
}
