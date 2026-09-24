import type { Event } from 'nostr-tools';
import { firstTag } from './verify';

/** NIP-01 replaceable: kinds 0, 3, and 10000–19999 (one live event per pubkey+kind). */
export function isReplaceableKind(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10_000 && kind < 20_000);
}

/** NIP-01 addressable: kinds 30000–39999 (one live event per pubkey+kind+d). */
export function isAddressableKind(kind: number): boolean {
  return kind >= 30_000 && kind < 40_000;
}

/**
 * Stable NIP-01 replacement key, or null for regular events.
 * Replaceable: `kind:pubkey`. Addressable: `kind:pubkey:d`.
 */
export function replaceableCoord(event: Pick<Event, 'kind' | 'pubkey' | 'tags'>): string | null {
  const pk = event.pubkey.toLowerCase();
  if (isReplaceableKind(event.kind)) return `${event.kind}:${pk}`;
  if (isAddressableKind(event.kind)) {
    const d = firstTag(event as Event, 'd') ?? '';
    return `${event.kind}:${pk}:${d}`;
  }
  return null;
}

/**
 * True when `candidate` should replace `current` under NIP-01:
 * higher `created_at` wins; on a tie, the lower id (lexical) wins.
 */
export function isNewerReplaceable(candidate: Event, current: Event): boolean {
  if (candidate.created_at !== current.created_at) {
    return candidate.created_at > current.created_at;
  }
  const a = candidate.id.toLowerCase();
  const b = current.id.toLowerCase();
  return a < b;
}

/** Sort helper: newest first (NIP-01 id tiebreak). */
export function compareReplaceableNewestFirst(a: Event, b: Event): number {
  if (a.created_at !== b.created_at) return b.created_at - a.created_at;
  const ai = a.id.toLowerCase();
  const bi = b.id.toLowerCase();
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/** Newest replaceable of `kind` (optionally scoped to one author). */
export function pickLatestReplaceable(
  events: Event[],
  kind: number,
  pubkey?: string | null
): Event | null {
  const pk = pubkey?.toLowerCase() ?? null;
  let best: Event | null = null;
  for (const event of events) {
    if (event.kind !== kind) continue;
    if (pk && event.pubkey.toLowerCase() !== pk) continue;
    if (!best || isNewerReplaceable(event, best)) best = event;
  }
  return best;
}

/** Newest addressable for kind + author + d. */
export function pickLatestAddressable(
  events: Event[],
  kind: number,
  pubkey: string,
  d: string
): Event | null {
  const pk = pubkey.toLowerCase();
  let best: Event | null = null;
  for (const event of events) {
    if (event.kind !== kind) continue;
    if (event.pubkey.toLowerCase() !== pk) continue;
    if ((firstTag(event, 'd') ?? '') !== d) continue;
    if (!best || isNewerReplaceable(event, best)) best = event;
  }
  return best;
}

/**
 * Keep regular events as-is; for each replaceable/addressable coord keep only the NIP-01 winner.
 */
export function pruneToLatestReplaceables(events: Event[]): Event[] {
  const winners = new Map<string, Event>();
  const regular: Event[] = [];
  for (const event of events) {
    const coord = replaceableCoord(event);
    if (!coord) {
      regular.push(event);
      continue;
    }
    const prev = winners.get(coord);
    if (!prev || isNewerReplaceable(event, prev)) winners.set(coord, event);
  }
  return [...regular, ...winners.values()];
}
