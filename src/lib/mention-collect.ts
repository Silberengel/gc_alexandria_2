import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  mentionCandidateFromEvent,
  mentionCandidateFromPubkey,
  mentionRank,
  type MentionCandidate
} from './mention';
import type { FollowContact } from './mute';

const LIMIT = 8;

function rememberProfile(event: Event | null | undefined, into: Map<string, Event>): void {
  if (!event || event.kind !== KIND.METADATA || !event.pubkey) return;
  const pubkey = event.pubkey.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return;
  const prev = into.get(pubkey);
  if (!prev || event.created_at >= prev.created_at) into.set(pubkey, event);
}

function mergePetnames(base: MentionCandidate, extra: string[]): MentionCandidate {
  const petnames: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...base.petnames, ...extra]) {
    const pet = raw.trim();
    if (!pet) continue;
    const key = pet.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    petnames.push(pet);
  }
  if (!extra.some((pet) => pet.trim()) && petnames.length === base.petnames.length) return base;
  const title = base.displayName || base.name || petnames[0] || base.title;
  const pet = petnames.find((item) => item.toLowerCase() !== title.toLowerCase()) ?? '';
  const detail = base.nip05 || pet || (base.name && base.name !== title ? `@${base.name}` : base.npub);
  return { ...base, title, petnames, detail };
}

function candidateFrom(
  pubkey: string,
  event: Event | undefined,
  extraPets: string[]
): MentionCandidate | null {
  const base = event ? mentionCandidateFromEvent(event) : mentionCandidateFromPubkey(pubkey);
  if (!base) return null;
  return mergePetnames(base, extraPets);
}

function byRank(query: string) {
  return (a: MentionCandidate, b: MentionCandidate) =>
    mentionRank(query, b) - mentionRank(query, a) || (query ? a.title.localeCompare(b.title) : 0);
}

/**
 * Suggestion order: follows, then an exact npub/NIP-05 resolution, then the
 * profile cache, then relay hits. An empty query lists follows only.
 */
export function collectMentionCandidates(
  query: string,
  input: {
    follows: FollowContact[];
    cached: Event[];
    network?: Event[];
    pinned?: MentionCandidate[];
  }
): MentionCandidate[] {
  const q = query.trim().replace(/^nostr:/i, '');
  const cached = new Map<string, Event>();
  const network = new Map<string, Event>();
  for (const event of input.cached) rememberProfile(event, cached);
  for (const event of input.network ?? []) rememberProfile(event, network);
  const all = new Map(cached);
  for (const event of network.values()) rememberProfile(event, all);

  const followIds = new Set<string>();
  const followRows: MentionCandidate[] = [];
  for (const row of input.follows) {
    const pubkey = row.pubkey.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(pubkey) || followIds.has(pubkey)) continue;
    followIds.add(pubkey);
    const candidate = candidateFrom(pubkey, all.get(pubkey), row.petname ? [row.petname] : []);
    if (!candidate) continue;
    if (q && mentionRank(q, candidate) <= 0) continue;
    followRows.push(candidate);
  }

  const cacheRows: MentionCandidate[] = [];
  const networkRows: MentionCandidate[] = [];
  if (q) {
    for (const event of cached.values()) {
      const pubkey = event.pubkey.toLowerCase();
      if (followIds.has(pubkey)) continue;
      const candidate = candidateFrom(pubkey, event, []);
      if (candidate && mentionRank(q, candidate) > 0) cacheRows.push(candidate);
    }
    for (const event of network.values()) {
      const pubkey = event.pubkey.toLowerCase();
      if (followIds.has(pubkey) || cached.has(pubkey)) continue;
      const candidate = candidateFrom(pubkey, event, []);
      if (candidate && mentionRank(q, candidate) > 0) networkRows.push(candidate);
    }
  }

  const sort = byRank(q);
  const chosen = new Set<string>();
  const out: MentionCandidate[] = [];
  const take = (rows: MentionCandidate[]) => {
    for (const row of rows) {
      if (chosen.has(row.pubkey)) continue;
      chosen.add(row.pubkey);
      out.push(row);
      if (out.length >= LIMIT) return;
    }
  };
  take(followRows.sort(sort));
  take([...(input.pinned ?? [])].sort(sort));
  take(cacheRows.sort(sort));
  take(networkRows.sort(sort));
  return out;
}
