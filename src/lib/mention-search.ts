import type { Event } from 'nostr-tools';
import { KIND, PROFILE_RELAYS } from './constants';
import { ensureMetadata } from './ensure-metadata';
import { collectMentionCandidates } from './mention-collect';
import {
  mentionCandidateFromEvent,
  mentionCandidateFromPubkey,
  type MentionCandidate
} from './mention';
import { hexPubkey } from './metadata';
import { followContactsFromMetadata, isMutedAuthor } from './mute';
import { lookupNip05Pubkey, splitNip05Identifier } from './nip05';
import { memoryAllMetadata, rememberEvents } from './nostr/event-memory';
import { cachedIdentityEvents } from './nostr/identity-cache';
import { uniqueRelayUrls } from './nostr/mailboxes';
import { relayPool } from './nostr/pool';
import { getSelectorContext, profileStack } from './nostr/selector';
import { session } from './stores/session';

function visible(rows: MentionCandidate[]): MentionCandidate[] {
  return rows.filter((row) => !isMutedAuthor(row.pubkey));
}

/** Kind 0s already on hand: the signed-in lists, the session index, and the profile cache. */
function cachedProfiles(): Event[] {
  const out: Event[] = [];
  for (const event of session.getMetadata()) {
    if (event.kind === KIND.METADATA) out.push(event);
  }
  out.push(...memoryAllMetadata(), ...cachedIdentityEvents(KIND.METADATA));
  return out;
}

function pinResolved(
  pubkey: string,
  profiles: Event[],
  nip05Label: string,
  into: MentionCandidate[]
): void {
  const event = profiles.find((item) => item.pubkey?.toLowerCase() === pubkey);
  const base = event ? mentionCandidateFromEvent(event) : mentionCandidateFromPubkey(pubkey);
  if (!base) return;
  if (nip05Label && !base.nip05) {
    into.push({ ...base, nip05: nip05Label, detail: nip05Label });
    return;
  }
  into.push(base);
}

/**
 * People matching a name, username, NIP-05, or pet name.
 * Follows first, then the profile cache. Callers paint that immediately.
 */
export function localMentionCandidates(query: string): MentionCandidate[] {
  return visible(
    collectMentionCandidates(query, {
      follows: followContactsFromMetadata(session.getMetadata()),
      cached: cachedProfiles()
    })
  );
}

/**
 * Same order as {@link localMentionCandidates}, then kind 0 search on the
 * profile relays and the viewer's inbox relays.
 */
export async function searchMentions(query: string): Promise<MentionCandidate[]> {
  const q = query.trim().replace(/^nostr:/i, '');
  const follows = followContactsFromMetadata(session.getMetadata());
  const cached = cachedProfiles();
  const direct = hexPubkey(q);
  if (q.length < 2 && !direct) {
    return visible(collectMentionCandidates(q, { follows, cached }));
  }

  const network: Event[] = [];
  const pinned: MentionCandidate[] = [];
  const nip05 = splitNip05Identifier(q);
  const relays = uniqueRelayUrls([
    ...profileStack(),
    ...PROFILE_RELAYS,
    ...getSelectorContext().inbox
  ]);

  const [directMeta, nip05Pubkey, relayHits] = await Promise.all([
    direct ? ensureMetadata(direct).catch(() => null) : Promise.resolve(null),
    nip05 ? lookupNip05Pubkey(q).catch(() => null) : Promise.resolve(null),
    q.length >= 2
      ? relayPool
          .query(
            relays,
            [{ kinds: [KIND.METADATA], search: q, limit: 12 }],
            2200,
            Math.min(8, Math.max(relays.length, 1))
          )
          .catch(() => [] as Event[])
      : Promise.resolve([] as Event[])
  ]);

  if (directMeta) network.push(directMeta);
  let nip05Meta: Event | null = null;
  if (nip05Pubkey) {
    nip05Meta = await ensureMetadata(nip05Pubkey).catch(() => null);
    if (nip05Meta) network.push(nip05Meta);
  }
  for (const event of relayHits) {
    if (event.kind === KIND.METADATA) network.push(event);
  }
  if (network.length) rememberEvents(network);

  const resolved = [...cached, ...network];
  if (direct) pinResolved(direct, resolved, '', pinned);
  if (nip05Pubkey) pinResolved(nip05Pubkey, resolved, q, pinned);

  return visible(collectMentionCandidates(q, { follows, cached, network, pinned }));
}
