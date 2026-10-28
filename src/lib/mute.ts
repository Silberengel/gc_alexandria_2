import { get, writable } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { isDeprecatedFollowSetMute, pickMuteList } from './nip51-deprecated-lists';
import { isNewerReplaceable, pickLatestReplaceable } from './nostr/replaceable';

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * NIP-51 mute list (kind 10000), matching Amethyst's merge of public + private tags:
 * `p` pubkeys, `e` threads, `t` hashtags, `word` lowercase strings.
 */
export type MuteState = {
  pubkeys: Set<string>;
  eventIds: Set<string>;
  hashtags: Set<string>;
  words: Set<string>;
};

export const emptyMuteState = (): MuteState => ({
  pubkeys: new Set(),
  eventIds: new Set(),
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
    hashtags: new Set(state.hashtags),
    words: new Set(state.words)
  });
}

export function clearMute(): void {
  muteState.set(emptyMuteState());
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
  const id = event.id.toLowerCase();
  if (state.eventIds.has(id)) return true;
  // Thread mute: hide replies whose root (or first e) is muted.
  if (state.eventIds.size) {
    const root = muteThreadRootId(event);
    if (state.eventIds.has(root)) return true;
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

function parseMuteTagRows(plain: string): string[][] | null {
  try {
    const parsed = JSON.parse(plain) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((row): row is string[] => Array.isArray(row) && typeof row[0] === 'string');
  } catch {
    return null;
  }
}

/** NIP-04: base64?iv=base64. Rejects plaintext error strings that nos2x would log on. */
export function looksLikeNip04Ciphertext(content: string): boolean {
  const i = content.indexOf('?iv=');
  if (i <= 0) return false;
  const body = content.slice(0, i);
  const iv = content.slice(i + 4);
  return body.length > 0 && iv.length > 0 && !/\s/.test(content);
}

/**
 * NIP-44 payloads are base64(url) without whitespace. Short English error strings
 * (e.g. "Could not decrypt the message") must not be sent to the signer.
 */
export function looksLikeNip44Ciphertext(content: string): boolean {
  if (content.length < 48 || /\s/.test(content) || content.includes('?iv=')) return false;
  return /^[A-Za-z0-9+/_=-]+$/.test(content);
}

export async function decryptPrivateMuteTags(event: Event): Promise<string[][]> {
  const content = event.content?.trim();
  if (!content) return [];
  // Some mute lists store private tags as plaintext JSON; never treat that as ciphertext.
  if (content.startsWith('[')) return parseMuteTagRows(content) ?? [];

  const attempts: Array<(pubkey: string, ciphertext: string) => Promise<string>> = [];
  /** When true, never fall back to window.nostr (wrong key while Amber/bunker is the session). */
  let bunkerSession = false;

  // Prefer the active session signer (bunker / extension) when available.
  try {
    const { session } = await import('./stores/session');
    bunkerSession = session.getSignerType() === 'bunker';
    const signer = session.getSigner();
    if (looksLikeNip44Ciphertext(content) && signer?.nip44Decrypt) {
      attempts.push((pk, ct) => signer.nip44Decrypt!(pk, ct));
    }
    if (looksLikeNip04Ciphertext(content) && signer?.nip04Decrypt) {
      attempts.push((pk, ct) => signer.nip04Decrypt!(pk, ct));
    }
    // Do not ask a browser extension to decrypt for a bunker session (wrong key / wrong UI).
    if (!bunkerSession) {
      const ext = typeof window !== 'undefined' ? window.nostr : undefined;
      if (looksLikeNip44Ciphertext(content) && typeof ext?.nip44?.decrypt === 'function') {
        attempts.push(ext.nip44.decrypt.bind(ext.nip44));
      }
      if (looksLikeNip04Ciphertext(content) && typeof ext?.nip04?.decrypt === 'function') {
        attempts.push(ext.nip04.decrypt.bind(ext.nip04));
      }
    }
  } catch {
    /* session unavailable */
  }

  // Anonymous / NIP-07 paint with no signer attached yet — extension only, never for bunker.
  if (!attempts.length && !bunkerSession) {
    const ext = typeof window !== 'undefined' ? window.nostr : undefined;
    if (looksLikeNip44Ciphertext(content) && typeof ext?.nip44?.decrypt === 'function') {
      attempts.push(ext.nip44.decrypt.bind(ext.nip44));
    }
    if (looksLikeNip04Ciphertext(content) && typeof ext?.nip04?.decrypt === 'function') {
      attempts.push(ext.nip04.decrypt.bind(ext.nip04));
    }
  }
  for (const decrypt of attempts) {
    try {
      // Huge private mute lists can freeze the UI for minutes in nos2x-fox — bail out.
      const plain = await Promise.race([
        decrypt(event.pubkey, content),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500))
      ]);
      if (plain == null) continue;
      const rows = parseMuteTagRows(plain);
      if (rows) return rows;
    } catch {
      /* try next decryptor */
    }
  }
  return [];
}

/** Newest event of `kind` (NIP-01 created_at, then lowest id). */
export function latestReplaceable(events: Event[], kind: number): Event | null {
  return pickLatestReplaceable(events, kind);
}

export function followPubkeysFromMetadata(events: Event[]): Set<string> {
  const out = new Set<string>();
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
      if (tag[0] === 'p' && tag[1] && HEX64.test(tag[1])) {
        out.add(tag[1].toLowerCase());
      }
    }
  }
  return out;
}
