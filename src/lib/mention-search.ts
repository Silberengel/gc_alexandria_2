import type { Event } from 'nostr-tools';
import { fetchBrainstormNip50Events } from './brainstorm-search';
import { KIND } from './constants';
import { ensureMetadata } from './ensure-metadata';
import {
  mentionCandidateFromEvent,
  mentionCandidateFromPubkey,
  mentionRank,
  type MentionCandidate
} from './mention';
import { hexPubkey } from './metadata';
import { lookupNip05Pubkey, splitNip05Identifier } from './nip05';
import { memoryAllMetadata, rememberEvents } from './nostr/event-memory';
import { relayPool } from './nostr/pool';
import { profileStack, socialSearchStack } from './nostr/selector';

const LIMIT = 8;

function rememberProfile(event: Event | null | undefined, into: Map<string, Event>): void {
  if (!event || event.kind !== KIND.METADATA || !event.pubkey) return;
  const pk = event.pubkey.toLowerCase();
  const prev = into.get(pk);
  if (!prev || event.created_at >= prev.created_at) into.set(pk, event);
}

function ranked(events: Event[], query: string, pinned: MentionCandidate[]): MentionCandidate[] {
  const byPubkey = new Map<string, MentionCandidate>();
  for (const pin of pinned) byPubkey.set(pin.pubkey, pin);
  for (const event of events) {
    const candidate = mentionCandidateFromEvent(event);
    if (!candidate) continue;
    if (mentionRank(query, candidate) <= 0 && !byPubkey.has(candidate.pubkey)) continue;
    const prev = byPubkey.get(candidate.pubkey);
    if (!prev || candidate.displayName || candidate.name || candidate.nip05) {
      byPubkey.set(candidate.pubkey, candidate);
    }
  }
  return [...byPubkey.values()]
    .sort((a, b) => mentionRank(query, b) - mentionRank(query, a) || a.title.localeCompare(b.title))
    .slice(0, LIMIT);
}

/**
 * People matching a name, username, NIP-05, or npub.
 * Local profiles paint immediately; relays and `/.well-known/nostr.json` fill the rest.
 */
export async function searchMentions(query: string): Promise<MentionCandidate[]> {
  const q = query.trim().replace(/^nostr:/i, '');
  if (!q) return [];

  const profiles = new Map<string, Event>();
  const pinned: MentionCandidate[] = [];

  for (const event of memoryAllMetadata()) {
    const candidate = mentionCandidateFromEvent(event);
    if (candidate && mentionRank(q, candidate) > 0) rememberProfile(event, profiles);
  }

  const direct = hexPubkey(q);
  if (direct) {
    const bare = mentionCandidateFromPubkey(direct);
    if (bare) pinned.push(bare);
    rememberProfile(await ensureMetadata(direct), profiles);
  }

  const network = q.length >= 2;
  if (network) {
    const nip05 = splitNip05Identifier(q);
    const [nip05Pubkey, relayHits, brainstormHits] = await Promise.all([
      nip05 ? lookupNip05Pubkey(q).catch(() => null) : Promise.resolve(null),
      relayPool
        .query(
          [...profileStack(), ...socialSearchStack()],
          [{ kinds: [KIND.METADATA], search: q, limit: 12 }],
          2200
        )
        .catch(() => [] as Event[]),
      fetchBrainstormNip50Events({ query: q, kinds: [KIND.METADATA], limit: 12, timeoutMs: 2200 })
    ]);
    if (nip05Pubkey) {
      const bare = mentionCandidateFromPubkey(nip05Pubkey);
      if (bare) pinned.push({ ...bare, nip05: q, detail: q });
      rememberProfile(await ensureMetadata(nip05Pubkey), profiles);
    }
    for (const event of [...relayHits, ...brainstormHits]) rememberProfile(event, profiles);
    if (profiles.size) rememberEvents([...profiles.values()]);
  }

  return ranked([...profiles.values()], q, pinned);
}
