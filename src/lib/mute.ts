import { get, writable } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { isDeprecatedFollowSetMute, pickMuteList } from './nip51-deprecated-lists';
import { isNewerReplaceable, pickLatestReplaceable } from './nostr/replaceable';
import {
  decryptPrivateTags,
  looksLikeNip04Ciphertext,
  looksLikeNip44Ciphertext
} from './private-tags';
import { isAddressableKind } from './nostr/replaceable';
import { firstTag } from './nostr/verify';
import {
  applyViewerHideState,
  isViewerHidden,
  viewerHideFromMuteEventIds
} from './viewer-hide';

export { looksLikeNip04Ciphertext, looksLikeNip44Ciphertext };

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * NIP-51 mute list (kind 10000), matching Amethyst's merge of public + private tags:
 * `p` pubkeys, `e` threads, `t` hashtags, `word` lowercase strings.
 */
export type MuteState = {
  pubkeys: Set<string>;
  eventIds: Set<string>;
  /** Optional Alexandria `a` tags on kind 10000 (addressable hide). */
  addresses: Set<string>;
  hashtags: Set<string>;
  words: Set<string>;
};

export const emptyMuteState = (): MuteState => ({
  pubkeys: new Set(),
  eventIds: new Set(),
  addresses: new Set(),
  hashtags: new Set(),
  words: new Set()
});

const empty: MuteState = emptyMuteState();

export const muteState = writable<MuteState>(empty);

function normalizeHashtag(raw: string): string {
  return raw.trim().replace(/^#/, '').toLowerCase();
}

function normalizeWord(raw: string): string {
  return raw.trim().toLowerCase();
}

function collectTags(tags: string[][], state: MuteState): void {
  for (const tag of tags) {
    const name = tag[0];
    const value = tag[1];
    if (!name || value == null || !String(value).trim()) continue;
    if (name === 'p' && HEX64.test(value)) {
      state.pubkeys.add(value.toLowerCase());
    } else if (name === 'e' && HEX64.test(value)) {
      state.eventIds.add(value.toLowerCase());
    } else if (name === 'a' && value.includes(':')) {
      state.addresses.add(value.toLowerCase());
    } else if (name === 't') {
      const t = normalizeHashtag(value);
      if (t) state.hashtags.add(t);
    } else if (name === 'word') {
      const w = normalizeWord(value);
      if (w) state.words.add(w);
    }
  }
}

export function parseMuteList(event: Event | null, extraTags: string[][] = []): MuteState {
  const state = emptyMuteState();
  if (event) collectTags(event.tags, state);
  collectTags(extraTags, state);
  return state;
}

export function applyMuteList(state: MuteState): void {
  muteState.set({
    pubkeys: new Set(state.pubkeys),
    eventIds: new Set(state.eventIds),
    addresses: new Set(state.addresses),
    hashtags: new Set(state.hashtags),
    words: new Set(state.words)
  });
  applyViewerHideState(viewerHideFromMuteEventIds(state.eventIds, state.addresses));
}

export function clearMute(): void {
  muteState.set(emptyMuteState());
  applyViewerHideState(viewerHideFromMuteEventIds([]));
}

export function isMutedAuthor(pubkey: string, state: MuteState = get(muteState)): boolean {
  return state.pubkeys.has(pubkey.toLowerCase());
}

function tagThreadMarker(tag: string[]): 'root' | 'reply' | null {
  for (let i = 2; i < tag.length; i += 1) {
    const slot = (tag[i] ?? '').toLowerCase();
    if (slot === 'root' || slot === 'reply') return slot;
  }
  return null;
}

/**
 * Amethyst-style thread root for mute `e` tags: NIP-22 `E`, marked NIP-10 root,
 * else first `e`, else the event itself.
 */
export function muteThreadRootId(event: Event): string {
  for (const tag of event.tags) {
    if (tag[0] === 'E' && tag[1] && HEX64.test(tag[1])) return tag[1].toLowerCase();
  }
  const eTags = event.tags.filter((t) => t[0] === 'e' && t[1] && HEX64.test(t[1]));
  const markedRoot = eTags.find((t) => tagThreadMarker(t) === 'root');
  if (markedRoot?.[1]) return markedRoot[1].toLowerCase();
  if (eTags[0]?.[1]) return eTags[0][1].toLowerCase();
  return event.id.toLowerCase();
}

function eventHasMutedHashtag(event: Event, hashtags: Set<string> | undefined): boolean {
  if (!hashtags?.size) return false;
  for (const tag of event.tags) {
    if (tag[0] !== 't' || !tag[1]) continue;
    if (hashtags.has(normalizeHashtag(tag[1]))) return true;
  }
  return false;
}

/** Text scanned for muted words: content plus common title/summary tags. */
function eventMuteText(event: Event): string {
  const parts = [event.content ?? ''];
  for (const tag of event.tags) {
    if ((tag[0] === 'title' || tag[0] === 'summary' || tag[0] === 'T' || tag[0] === 'subject') && tag[1]) {
      parts.push(tag[1]);
    }
  }
  return parts.join('\n').toLowerCase();
}

function eventHasMutedWord(event: Event, words: Set<string> | undefined): boolean {
  if (!words?.size) return false;
  const hay = eventMuteText(event);
  if (!hay) return false;
  for (const word of words) {
    if (word && hay.includes(word)) return true;
  }
  return false;
}

export function isMutedEvent(event: Event, state: MuteState = get(muteState)): boolean {
  if (isMutedAuthor(event.pubkey, state)) return true;
  if (isViewerHidden(event)) return true;
  const id = event.id.toLowerCase();
  if (state.eventIds.has(id)) return true;
  if (state.addresses.size && isAddressableKind(event.kind)) {
    const d = firstTag(event, 'd');
    if (d != null) {
      const coord = `${event.kind}:${event.pubkey.toLowerCase()}:${d}`.toLowerCase();
      if (state.addresses.has(coord)) return true;
    }
  }
  // Thread mute: hide replies whose root (or first e) is muted.
  if (state.eventIds.size) {
    const root = muteThreadRootId(event);
    if (state.eventIds.has(root)) return true;
  }
  // Comments / replies that a-tag a muted addressable root.
  if (state.addresses.size) {
    for (const tag of event.tags) {
      if ((tag[0] === 'a' || tag[0] === 'A') && tag[1] && state.addresses.has(tag[1].toLowerCase())) {
        return true;
      }
    }
  }
  if (eventHasMutedHashtag(event, state.hashtags)) return true;
  if (eventHasMutedWord(event, state.words)) return true;
  return false;
}

export function notMuted(event: Event, state: MuteState = get(muteState)): boolean {
  return !isMutedEvent(event, state);
}

export function filterMuted(events: Event[], state: MuteState = get(muteState)): Event[] {
  return events.filter((event) => notMuted(event, state));
}

/** Prefer kind 10000; fall back to deprecated 30000 `d=mute`. */
export function newestMuteList(events: Event[]): Event | null {
  return pickMuteList(events);
}

/** NIP-51 mute: decrypt private tag rows from content (shared private-tags helper). */
export async function decryptPrivateMuteTags(event: Event): Promise<string[][]> {
  return decryptPrivateTags(event);
}

/** Newest event of `kind` (NIP-01 created_at, then lowest id). */
export function latestReplaceable(events: Event[], kind: number): Event | null {
  return pickLatestReplaceable(events, kind);
}

export type FollowContact = { pubkey: string; petname: string };

/** Pubkeys on the contact list and follow sets, with a NIP-02 petname when one was set. */
export function followContactsFromMetadata(events: Event[]): FollowContact[] {
  const byPk = new Map<string, FollowContact>();
  const contact = pickLatestReplaceable(events, KIND.CONTACT_LIST);
  // Addressable follow sets: one winner per d (prune keeps latest per coord).
  // Skip deprecated 30000 d=mute — those are mute lists, not follows.
  const followSets = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== KIND.FOLLOW_SET) continue;
    if (isDeprecatedFollowSetMute(event)) continue;
    const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
    const key = `${event.pubkey.toLowerCase()}:${d}`;
    const prev = followSets.get(key);
    if (!prev || isNewerReplaceable(event, prev)) followSets.set(key, event);
  }
  for (const event of [contact, ...followSets.values()]) {
    if (!event) continue;
    for (const tag of event.tags) {
      if (tag[0] !== 'p' || !tag[1] || !HEX64.test(tag[1])) continue;
      const pubkey = tag[1].toLowerCase();
      const petname = (tag[3] ?? '').trim();
      const prev = byPk.get(pubkey);
      if (!prev) {
        byPk.set(pubkey, { pubkey, petname });
        continue;
      }
      if (!prev.petname && petname) prev.petname = petname;
    }
  }
  return [...byPk.values()];
}

export function followPubkeysFromMetadata(events: Event[]): Set<string> {
  return new Set(followContactsFromMetadata(events).map((row) => row.pubkey));
}
