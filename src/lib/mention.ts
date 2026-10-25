import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { parseKind0 } from './profile-fields';

export type MentionQuery = {
  /** Index of the `@` that opened the query. */
  start: number;
  query: string;
};

export type MentionCandidate = {
  pubkey: string;
  npub: string;
  title: string;
  detail: string;
  name: string;
  displayName: string;
  nip05: string;
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
  fields: { name: string; displayName: string; nip05: string; npub: string }
): number {
  const q = query.trim().toLowerCase().replace(/^nostr:/, '');
  if (!q) return 0;
  const name = fields.name.trim().toLowerCase();
  const display = fields.displayName.trim().toLowerCase();
  const nip = fields.nip05.trim().toLowerCase();
  const npub = fields.npub.trim().toLowerCase();
  if (npub === q) return 100;
  if (nip === q) return 95;
  if (name === q || display === q) return 90;
  if (nip.startsWith(q)) return 80;
  if (name.startsWith(q) || display.startsWith(q)) return 70;
  if (q.startsWith('npub1') && npub.startsWith(q)) return 65;
  if (name.includes(q) || display.includes(q) || nip.includes(q)) return 40;
  return 0;
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
  const title = fields.displayName || fields.name || `${npub.slice(0, 12)}…`;
  const detail = fields.nip05 || (fields.name && fields.name !== title ? `@${fields.name}` : npub);
  return {
    pubkey,
    npub,
    title,
    detail,
    name: fields.name,
    displayName: fields.displayName,
    nip05: fields.nip05
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
      nip05: ''
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
  npub: string
): { value: string; selectionStart: number; selectionEnd: number } | null {
  if (source[start] !== '@' || end < start || end > source.length) return null;
  if (!npub.startsWith('npub1')) return null;
  const token = `nostr:${npub}`;
  const after = source.slice(end);
  const spacer = after.length === 0 || /^\s/.test(after) ? '' : ' ';
  const value = source.slice(0, start) + token + spacer + after;
  const cursor = start + token.length + spacer.length;
  return { value, selectionStart: cursor, selectionEnd: cursor };
}
