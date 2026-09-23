import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import { warmAddress, warmNavEvent } from './nav-warm';
import { eventAddress } from './nostr/verify';
import { memoryGetEvent } from './nostr/event-memory';
import { publicationCoordinateLookupKeys } from './publication-coordinate';

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

/** True when `event` defers to `target` via a-tag coordinate or e-tag id. */
export function eventDefersTo(event: Event, target: Event): boolean {
  const ref = getWikiDeferTarget(event);
  if (!ref) return false;
  if (ref.eventId && ref.eventId.toLowerCase() === target.id.toLowerCase()) return true;
  if (!ref.coordinate) return false;
  const targetKeys = new Set(publicationCoordinateLookupKeys(eventAddress(target)));
  return publicationCoordinateLookupKeys(ref.coordinate).some((k) => targetKeys.has(k));
}

/**
 * Unique pubkeys that defer to `target`, plus optional seeds (e.g. from ?deferredBy=).
 * Excludes the target author.
 */
export function deferrerPubkeys(
  candidates: readonly Event[],
  target: Event,
  seeds: readonly string[] = []
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const targetPk = target.pubkey.trim().toLowerCase();

  const add = (pk: string) => {
    const n = pk.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(n) || n === targetPk || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  for (const seed of seeds) add(seed);
  for (const event of candidates) {
    if (eventDefersTo(event, target)) add(event.pubkey);
  }
  return out;
}

/** NIP-54 style placeholder: "Read nostr:naddr1… instead." (optional nostr:, truncated OK). */
export function isDeferralPlaceholderContent(content: string): boolean {
  const s = content.trim();
  if (!s) return false;
  return /^\s*Read\s+(?:nostr:)?(?:nevent|naddr|note)1[02-9ac-hj-np-z]+/i.test(s);
}

/** `/wiki/d/…/p/…` for a `kind:pubkey:d` coordinate, else null. */
export function wikiPathFromCoordinate(coordinate: string | undefined): string | null {
  if (!coordinate) return null;
  const parts = coordinate.split(':');
  if (parts.length < 3) return null;
  const kind = Number(parts[0]);
  const pubkey = (parts[1] ?? '').toLowerCase();
  const d = parts.slice(2).join(':');
  if (kind !== KIND.WIKI && kind !== KIND.SPEC) return null;
  if (!/^[0-9a-f]{64}$/.test(pubkey) || !d) return null;
  return `/wiki/d/${encodeURIComponent(d)}/p/${nip19.npubEncode(pubkey)}`;
}

/** Prefer a-tag coordinate; fall back to naddr embedded in placeholder content. */
export function wikiDeferTargetHref(event: Event): string | null {
  const fromTag = wikiPathFromCoordinate(getWikiDeferTarget(event)?.coordinate);
  if (fromTag) return fromTag;
  const match = event.content.match(/(?:nostr:)?(naddr1[02-9ac-hj-np-z]+)/i);
  if (!match?.[1]) return null;
  try {
    const decoded = nip19.decode(match[1]);
    if (decoded.type !== 'naddr') return null;
    const { kind, pubkey, identifier } = decoded.data;
    if (kind !== KIND.WIKI && kind !== KIND.SPEC) return null;
    return `/wiki/d/${encodeURIComponent(identifier)}/p/${nip19.npubEncode(pubkey.toLowerCase())}`;
  } catch {
    return null;
  }
}

/** Seed memory for the preferred defer target before SPA nav. */
export function warmWikiDeferTarget(from: Event): void {
  warmNavEvent(from);
  const target = getWikiDeferTarget(from);
  if (target?.coordinate) warmAddress(target.coordinate);
  if (target?.eventId) {
    const hit = memoryGetEvent(target.eventId);
    if (hit) warmNavEvent(hit);
  }
}
