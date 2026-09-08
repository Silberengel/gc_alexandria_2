import { derived, get, writable } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';

export type MuteState = {
  pubkeys: Set<string>;
  eventIds: Set<string>;
};

const empty: MuteState = { pubkeys: new Set(), eventIds: new Set() };

export const muteState = writable<MuteState>(empty);

export const muteReady = writable(true);

function collectTags(tags: string[][], pubkeys: Set<string>, eventIds: Set<string>): void {
  for (const tag of tags) {
    if (tag[0] === 'p' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
      pubkeys.add(tag[1].toLowerCase());
    }
    if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
      eventIds.add(tag[1].toLowerCase());
    }
  }
}

export function parseMuteList(event: Event | null, extraTags: string[][] = []): MuteState {
  const pubkeys = new Set<string>();
  const eventIds = new Set<string>();
  if (event) collectTags(event.tags, pubkeys, eventIds);
  collectTags(extraTags, pubkeys, eventIds);
  return { pubkeys, eventIds };
}

export function applyMuteList(state: MuteState): void {
  muteState.set({
    pubkeys: new Set(state.pubkeys),
    eventIds: new Set(state.eventIds)
  });
}

export function clearMute(): void {
  muteState.set({ pubkeys: new Set(), eventIds: new Set() });
}

export function isMutedAuthor(pubkey: string, state: MuteState = get(muteState)): boolean {
  return state.pubkeys.has(pubkey.toLowerCase());
}

export function isMutedEvent(event: Event, state: MuteState = get(muteState)): boolean {
  return isMutedAuthor(event.pubkey, state) || state.eventIds.has(event.id.toLowerCase());
}

export function notMuted(event: Event, state: MuteState = get(muteState)): boolean {
  return !isMutedEvent(event, state);
}

export function filterMuted(events: Event[], state: MuteState = get(muteState)): Event[] {
  return events.filter((event) => notMuted(event, state));
}

export function newestMuteList(events: Event[]): Event | null {
  const lists = events.filter((e) => e.kind === KIND.MUTE);
  lists.sort((a, b) => b.created_at - a.created_at);
  return lists[0] ?? null;
}

export async function decryptPrivateMuteTags(event: Event): Promise<string[][]> {
  const content = event.content?.trim();
  if (!content) return [];
  const ext = window.nostr;
  // Prefer nip44; many mute lists are not nip04, and nos2x logs loudly on bad nip04 input.
  const decryptors = [ext?.nip44?.decrypt, ext?.nip04?.decrypt].filter(
    (fn): fn is (pubkey: string, ciphertext: string) => Promise<string> => typeof fn === 'function'
  );
  for (const decrypt of decryptors) {
    try {
      const plain = await decrypt(event.pubkey, content);
      const parsed = JSON.parse(plain) as unknown;
      if (!Array.isArray(parsed)) continue;
      return parsed.filter(
        (row): row is string[] => Array.isArray(row) && typeof row[0] === 'string'
      );
    } catch {
      /* try next decryptor */
    }
  }
  return [];
}

export const mutedPubkeys = derived(muteState, ($s) => $s.pubkeys);

export function latestReplaceable(events: Event[], kind: number): Event | null {
  const hits = events.filter((e) => e.kind === kind);
  hits.sort((a, b) => b.created_at - a.created_at);
  return hits[0] ?? null;
}

export function followPubkeysFromMetadata(events: Event[]): Set<string> {
  const out = new Set<string>();
  for (const event of events) {
    if (event.kind !== KIND.CONTACT_LIST && event.kind !== KIND.FOLLOW_SET) continue;
    for (const tag of event.tags) {
      if (tag[0] === 'p' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
        out.add(tag[1].toLowerCase());
      }
    }
  }
  return out;
}
