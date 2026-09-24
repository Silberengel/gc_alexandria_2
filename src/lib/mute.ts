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

  // Prefer the active session signer (bunker / extension) when available.
  try {
    const { session } = await import('./stores/session');
    const signer = session.getSigner();
    if (looksLikeNip44Ciphertext(content) && signer?.nip44Decrypt) {
      attempts.push((pk, ct) => signer.nip44Decrypt!(pk, ct));
    }
    if (looksLikeNip04Ciphertext(content) && signer?.nip04Decrypt) {
      attempts.push((pk, ct) => signer.nip04Decrypt!(pk, ct));
    }
    // Do not ask a browser extension to decrypt for a bunker session (wrong key / wrong UI).
    if (session.getSignerType() !== 'bunker') {
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

  if (!attempts.length) {
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
