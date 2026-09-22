import {
  BRAINSTORM_SEARCH_RELAY_URL,
  GRAPEVINE_FALLBACK_OBSERVER_PUBKEY,
  GRAPEVINE_RANK_MIN_DEFAULT,
  KIND
} from './constants';
import { isValidPubkey } from './nip85-trusted-assertions';
import { normalizeWebSocketRelay } from './nostr/relay-filters';
import { relayPool } from './nostr/pool';
import { trust } from './stores/trust';
import { trustedAssertions } from './trusted-assertions';
import type { Event } from 'nostr-tools';

export function brainstormSearchRelayUrl(): string {
  return normalizeWebSocketRelay(BRAINSTORM_SEARCH_RELAY_URL) || BRAINSTORM_SEARCH_RELAY_URL;
}

export function isBrainstormSearchRelay(url: string): boolean {
  const a = (normalizeWebSocketRelay(url) || url).toLowerCase().replace(/\/$/, '');
  const b = brainstormSearchRelayUrl().toLowerCase().replace(/\/$/, '');
  return a === b;
}

/** NIP-54 Wikipedia / wiki articles indexed on Brainstorm. */
export const BRAINSTORM_WIKI_SEARCH_KINDS: readonly number[] = [KIND.WIKI];

/** Publication indexes (30040) and section bodies (30041). */
export const BRAINSTORM_PUBLICATION_SEARCH_KINDS: readonly number[] = [
  KIND.PUBLICATION,
  KIND.SECTION
];

/**
 * Build the NIP-50 `search` string for Brainstorm only.
 * Never send these extensions to other relays — they would match as literal tokens.
 */
export function buildBrainstormSearchQuery(opts: {
  query: string;
  observerPubkey?: string | null;
  trustFilterEnabled?: boolean;
  rankCutoff?: number;
}): string {
  const base = opts.query.trim();
  if (!base) return '';
  const observerRaw = (opts.observerPubkey ?? GRAPEVINE_FALLBACK_OBSERVER_PUBKEY).trim().toLowerCase();
  const observer = isValidPubkey(observerRaw) ? observerRaw : GRAPEVINE_FALLBACK_OBSERVER_PUBKEY;
  const parts = [base, `observer:${observer}`, 'sort:rank'];
  if (opts.trustFilterEnabled) {
    const cutoff = opts.rankCutoff ?? GRAPEVINE_RANK_MIN_DEFAULT;
    parts.push(`filter:rank:gte:${cutoff}`);
  } else {
    parts.push('include:spam');
  }
  return parts.join(' ');
}

/**
 * NIP-50 REQ against the Brainstorm search relay. Extensions stay on this host only.
 */
export async function fetchBrainstormNip50Events(opts: {
  query: string;
  kinds: readonly number[];
  observerPubkey?: string | null;
  trustFilterEnabled?: boolean;
  rankCutoff?: number;
  limit?: number;
  timeoutMs?: number;
}): Promise<Event[]> {
  const q = opts.query.trim();
  if (!q || opts.kinds.length === 0) return [];

  let observerPubkey = opts.observerPubkey;
  let trustFilterEnabled = opts.trustFilterEnabled;
  let rankCutoff = opts.rankCutoff;

  if (observerPubkey === undefined) {
    observerPubkey = trustedAssertions.getProviderState().observerPubkey;
  }
  if (trustFilterEnabled === undefined || rankCutoff === undefined) {
    const snap = trust.snapshot();
    if (trustFilterEnabled === undefined) trustFilterEnabled = snap.enabled;
    if (rankCutoff === undefined) rankCutoff = snap.rankMin;
  }

  const search = buildBrainstormSearchQuery({
    query: q,
    observerPubkey,
    trustFilterEnabled,
    rankCutoff
  });
  if (!search) return [];

  try {
    const events = await relayPool.query(
      [brainstormSearchRelayUrl()],
      [{ kinds: [...opts.kinds], search, limit: opts.limit ?? 80 }],
      opts.timeoutMs ?? 14_000
    );
    const kindSet = new Set(opts.kinds);
    return events.filter((e) => kindSet.has(e.kind));
  } catch {
    return [];
  }
}
