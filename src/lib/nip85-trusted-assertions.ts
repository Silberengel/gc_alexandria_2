import { KIND } from './constants';
import { isWebSocketRelay, normalizeWebSocketRelay } from './nostr/relay-filters';
import type { Event } from 'nostr-tools';

export type Nip85ProviderRef = {
  /** Metric tag from kind 10040, e.g. `30382:rank` or `30382`. */
  metric: string;
  /** Service pubkey that signs kind 30382 events. */
  servicePubkey: string;
  /** Relay hint where 30382 events live. */
  relayUrl: string;
};

export type TrustedAssertionScore = {
  subjectPubkey: string;
  /** User rank 0–100 when present. */
  rank: number | null;
  hops: number | null;
  followers: number | null;
  pagerank: number | null;
  event?: Event;
};

const HEX64 = /^[0-9a-f]{64}$/;

export function isValidPubkey(pubkey: string): boolean {
  return HEX64.test(pubkey.trim().toLowerCase());
}

function parseIntTag(tags: string[][], name: string): number | null {
  const raw = tags.find((t) => t[0] === name)?.[1];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Prefer `30382:rank`, else the first `30382:*` tag, else a bare `30382` tag.
 * Ignores encrypted `.content` (private 10040) in v1.
 */
export function parseNip85ProviderFrom10040(event: Event | null | undefined): Nip85ProviderRef | null {
  if (!event || event.kind !== KIND.NIP85_PREFS) return null;
  const candidates: Nip85ProviderRef[] = [];
  for (const tag of event.tags) {
    const metric = tag[0]?.trim();
    const servicePubkey = tag[1]?.trim().toLowerCase();
    const relayRaw = tag[2]?.trim();
    if (!metric || !servicePubkey || !relayRaw) continue;
    if (!metric.startsWith('30382')) continue;
    if (!isValidPubkey(servicePubkey)) continue;
    const relayUrl = normalizeWebSocketRelay(relayRaw) || relayRaw;
    if (!isWebSocketRelay(relayUrl) && !relayUrl.startsWith('wss://') && !relayUrl.startsWith('ws://')) {
      continue;
    }
    candidates.push({ metric, servicePubkey, relayUrl });
  }
  if (candidates.length === 0) return null;
  const rankExact = candidates.find((c) => c.metric === '30382:rank');
  if (rankExact) return rankExact;
  const rankPrefixed = candidates.find((c) => c.metric.startsWith('30382:'));
  if (rankPrefixed) return rankPrefixed;
  return candidates[0] ?? null;
}

export function parseTrustedAssertionScore(
  event: Event | null | undefined
): TrustedAssertionScore | null {
  if (!event || event.kind !== KIND.NIP85_SCORE) return null;
  const d = event.tags.find((t) => t[0] === 'd')?.[1]?.trim().toLowerCase();
  if (!d || !isValidPubkey(d)) return null;
  return {
    subjectPubkey: d,
    rank: parseIntTag(event.tags, 'rank'),
    hops: parseIntTag(event.tags, 'hops'),
    followers: parseIntTag(event.tags, 'followers'),
    pagerank: parseIntTag(event.tags, 'pagerank'),
    event
  };
}

export function trustedAssertionCacheKey(servicePubkey: string, subjectPubkey: string): string {
  return `${servicePubkey.toLowerCase()}:${subjectPubkey.toLowerCase()}`;
}

/** True when rank is a finite number (including 0). */
export function hasKnownRank(score: TrustedAssertionScore | null | undefined): boolean {
  return score != null && score.rank != null && Number.isFinite(score.rank);
}
