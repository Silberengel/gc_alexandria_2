import type { Event } from 'nostr-tools';
import { KIND } from '../constants';
import { nip65InboxOutbox, type Nip65Mailboxes } from './nip65';
import { cachePutEvent } from './cache';
import { cachedIdentityEvent } from './identity-cache';
import { relayPool } from './pool';
import { isNewerReplaceable, pickLatestReplaceable } from './replaceable';
import { getSelectorContext, profileStack } from './selector';

/**
 * One person's NIP-65 list, looked up on our hard-coded profile relays (and the
 * viewer's own relays when signed in). This is not the outbox model: we never
 * walk follows and query each author's write relays. Callers may use the result
 * only for that person's profile (their outbox) or for a response / OP thread
 * (their inbox).
 */
const CACHE_MS = 10 * 60 * 1000;
const HEX64 = /^[0-9a-f]{64}$/;

const cache = new Map<string, { at: number; value: Nip65Mailboxes }>();

const EMPTY: Nip65Mailboxes = { inbox: [], outbox: [] };

/** Kinds we write to the other person's inbox so they can see the response. */
const DIRECTED_RESPONSE_KINDS = new Set<number>([
  KIND.TEXT_NOTE,
  KIND.REACTION,
  KIND.HIGHLIGHT,
  KIND.COMMENT,
  KIND.ISSUE,
  KIND.RATING
]);

function relayKey(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

export function uniqueRelayUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const key = relayKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/**
 * Put `preferred` first and raise the query cap so a 4-relay slice cannot drop them.
 * Relays already in `base` are not duplicated.
 */
export function withPreferredRelays(
  base: string[],
  preferred: string[],
  baseMax: number,
  preferredCap = 4
): { relays: string[]; maxRelays: number } {
  const extra = uniqueRelayUrls(preferred).slice(0, preferredCap);
  const seen = new Set(extra.map(relayKey));
  const relays = [...extra];
  for (const url of base) {
    const key = relayKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    relays.push(url);
  }
  return { relays, maxRelays: baseMax + extra.length };
}

/** `p` / `P` authors on a response, excluding the signer. Capped so one note cannot fan out. */
export function responseInboxPubkeys(event: Pick<Event, 'kind' | 'pubkey' | 'tags'>): string[] {
  if (!DIRECTED_RESPONSE_KINDS.has(event.kind)) return [];
  const self = event.pubkey?.toLowerCase() ?? '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'p' && tag[0] !== 'P') continue;
    const pk = tag[1]?.trim().toLowerCase() ?? '';
    if (!HEX64.test(pk) || pk === self || seen.has(pk)) continue;
    seen.add(pk);
    out.push(pk);
    if (out.length >= 8) break;
  }
  return out;
}

export async function authorMailboxes(pubkey: string): Promise<Nip65Mailboxes> {
  const pk = pubkey.trim().toLowerCase();
  if (!HEX64.test(pk)) return EMPTY;

  const ctx = getSelectorContext();
  if (ctx.viewerPubkey && ctx.viewerPubkey.toLowerCase() === pk) {
    return { inbox: [...ctx.inbox], outbox: [...ctx.outbox] };
  }

  const hit = cache.get(pk);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const stored = cachedIdentityEvent(KIND.RELAY_LIST, pk);
  if (stored) {
    const value = nip65InboxOutbox(stored);
    cache.set(pk, { at: Date.now(), value });
    void refreshAuthorMailboxes(pk);
    return value;
  }
  return refreshAuthorMailboxes(pk);
}

async function refreshAuthorMailboxes(pk: string): Promise<Nip65Mailboxes> {
  const events = await relayPool.query(
    profileStack(),
    [{ kinds: [KIND.RELAY_LIST], authors: [pk], limit: 2 }],
    4000,
    4,
    undefined,
    { priority: true }
  );
  const fetched = pickLatestReplaceable(events, KIND.RELAY_LIST, pk);
  const stored = cachedIdentityEvent(KIND.RELAY_LIST, pk);
  const list =
    fetched && (!stored || fetched.id === stored.id || isNewerReplaceable(fetched, stored))
      ? fetched
      : stored;
  if (fetched && list === fetched) void cachePutEvent(fetched);
  const value = list ? nip65InboxOutbox(list) : EMPTY;
  cache.set(pk, { at: Date.now(), value });
  return value;
}

export async function authorInbox(pubkey: string): Promise<string[]> {
  return (await authorMailboxes(pubkey)).inbox;
}

export async function authorOutbox(pubkey: string): Promise<string[]> {
  return (await authorMailboxes(pubkey)).outbox;
}

/** Inbox relays for the people tagged on a response. Empty for the viewer's own lists. */
export async function inboxRelaysForResponse(event: Event): Promise<string[]> {
  const pubkeys = responseInboxPubkeys(event);
  if (!pubkeys.length) return [];
  const lists = await Promise.all(pubkeys.map(async (pk) => (await authorInbox(pk)).slice(0, 4)));
  return uniqueRelayUrls(lists.flat());
}
