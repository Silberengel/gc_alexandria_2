import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { parseKind0 } from './profile-fields';

export type MentionQuery = {
  /** Index of the `@` that opened the query. */
  start: number;
  query: string;
};

export type MentionInsertMode = 'prose' | 'npub';

export type MentionCandidate = {
  pubkey: string;
  npub: string;
  title: string;
  detail: string;
  name: string;
  displayName: string;
  nip05: string;
  /** Kind-0 petname fields and follow-list petnames. */
  petnames: string[];
};

/** `@query` at the caret, when `@` starts a token (not an email address). */
export function activeMention(source: string, caret: number): MentionQuery | null {
  if (caret < 1 || caret > source.length) return null;
  const before = source.slice(0, caret);
  const match = before.match(/(^|[\s([{])@([^\s@]{0,80})$/);
  if (!match) return null;
  const query = match[2] ?? '';
  return { start: before.length - query.length - 1, query };
}

export function mentionRank(
  query: string,
  fields: {
    name: string;
    displayName: string;
    nip05: string;
    npub: string;
    petnames?: string[];
  }
): number {
  const q = query.trim().toLowerCase().replace(/^nostr:/, '');
  if (!q) return 0;
  const name = fields.name.trim().toLowerCase();
  const display = fields.displayName.trim().toLowerCase();
  const nip = fields.nip05.trim().toLowerCase();
  const local = nip.includes('@') ? nip.slice(0, nip.indexOf('@')) : '';
  const npub = fields.npub.trim().toLowerCase();
  const pets = (fields.petnames ?? []).map((pet) => pet.trim().toLowerCase()).filter(Boolean);
  if (npub === q) return 100;
  if (nip === q) return 95;
  if (pets.some((pet) => pet === q)) return 92;
  if (name === q || display === q) return 90;
  if (local === q) return 85;
  if (nip.startsWith(q)) return 80;
  if (pets.some((pet) => pet.startsWith(q))) return 75;
  if (q.length >= 2 && local.startsWith(q)) return 72;
  if (name.startsWith(q) || display.startsWith(q)) return 70;
  if (q.startsWith('npub1') && npub.startsWith(q)) return 65;
  if (pets.some((pet) => pet.includes(q))) return 45;
  if (name.includes(q) || display.includes(q) || nip.includes(q)) return 40;
  return 0;
}

const PETNAME_KEYS = new Set(['petname', 'petnames', 'pet_name', 'pet_names']);

function pushPetname(out: string[], raw: string): void {
  for (const part of raw.split(/[,|\n]/)) {
    const trimmed = part.trim();
    if (trimmed) out.push(trimmed);
  }
}

/** Pet names stored on a kind-0 profile (JSON or tags), not the follow-list column. */
export function petnamesFromKind0(event: Event): string[] {
  const out: string[] = [];
  try {
    const data = JSON.parse(event.content) as Record<string, unknown>;
    for (const key of PETNAME_KEYS) {
      const value = data[key];
      if (typeof value === 'string') pushPetname(out, value);
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') pushPetname(out, item);
        }
      }
    }
  } catch {
    /* kind 0 that is not JSON still may carry petname tags */
  }
  for (const tag of event.tags) {
    const name = tag[0]?.trim().toLowerCase() ?? '';
    if (!PETNAME_KEYS.has(name)) continue;
    const value = tag.slice(1).filter(Boolean).join(' ').trim();
    if (value) pushPetname(out, value);
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const pet of out) {
    const key = pet.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(pet);
  }
  return unique;
}

/** Secondary line in the suggestion list: the field the query actually hit. */
export function mentionSuggestionDetail(hit: MentionCandidate, query: string): string {
  const q = query.trim().toLowerCase().replace(/^nostr:/, '');
  const pet = q ? hit.petnames.find((item) => item.toLowerCase().includes(q)) : hit.petnames[0];
  if (pet) return pet;
  if (hit.nip05) return hit.nip05;
  if (hit.name && hit.displayName && hit.name.toLowerCase() !== hit.displayName.toLowerCase()) {
    return `@${hit.name}`;
  }
  return '';
}

export function mentionCandidateFromEvent(event: Event): MentionCandidate | null {
  const pubkey = event.pubkey?.trim().toLowerCase() ?? '';
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
  let npub = '';
  try {
    npub = nip19.npubEncode(pubkey);
  } catch {
    return null;
  }
  const fields = parseKind0(event);
  const petnames = petnamesFromKind0(event);
  const title = fields.displayName || fields.name || petnames[0] || `${npub.slice(0, 12)}…`;
  const pet = petnames.find((item) => item.toLowerCase() !== title.toLowerCase()) ?? '';
  const detail = fields.nip05 || pet || (fields.name && fields.name !== title ? `@${fields.name}` : npub);
  return {
    pubkey,
    npub,
    title,
    detail,
    name: fields.name,
    displayName: fields.displayName,
    nip05: fields.nip05,
    petnames
  };
}

export function mentionCandidateFromPubkey(pubkey: string): MentionCandidate | null {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return null;
  try {
    const npub = nip19.npubEncode(pk);
    return {
      pubkey: pk,
      npub,
      title: `${npub.slice(0, 12)}…`,
      detail: npub,
      name: '',
      displayName: '',
      nip05: '',
      petnames: []
    };
  } catch {
    return null;
  }
}

/** Replace the `@query` with `nostr:npub…`, plus a trailing space when the next character is not whitespace. */
export function insertMention(
  source: string,
  start: number,
  end: number,
  npub: string,
  mode: MentionInsertMode = 'prose'
): { value: string; selectionStart: number; selectionEnd: number } | null {
  if (source[start] !== '@' || end < start || end > source.length) return null;
  if (!npub.startsWith('npub1')) return null;
  const token = mode === 'npub' ? npub : `nostr:${npub}`;
  const after = source.slice(end);
  const spacer = after.length === 0 || /^\s/.test(after) ? '' : ' ';
  const value = source.slice(0, start) + token + spacer + after;
  const cursor = start + token.length + spacer.length;
  return { value, selectionStart: cursor, selectionEnd: cursor };
}
