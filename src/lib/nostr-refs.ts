import { nip19 } from 'nostr-tools';

export type NostrRefKind = 'npub' | 'nprofile' | 'naddr' | 'nevent' | 'note';

export type TextSegment = { type: 'text'; text: string };
export type RefSegment = {
  type: 'ref';
  kind: NostrRefKind;
  raw: string;
  bech32: string;
  pubkey?: string;
  id?: string;
  naddr?: { kind: number; pubkey: string; identifier: string; relays?: string[] };
};
export type ContentSegment = TextSegment | RefSegment;

const TOKEN = /(?:nostr:)?(n(?:pub|profile|addr|event|ote|sec)1[02-9ac-hj-np-z]+)/gi;

export function decodeNostrBech32(token: string): RefSegment | null {
  const bech32 = token.replace(/^nostr:/i, '');
  try {
    const decoded = nip19.decode(bech32);
    if (decoded.type === 'nsec') return null;
    if (decoded.type === 'npub') {
      return { type: 'ref', kind: 'npub', raw: token, bech32, pubkey: decoded.data };
    }
    if (decoded.type === 'nprofile') {
      return { type: 'ref', kind: 'nprofile', raw: token, bech32, pubkey: decoded.data.pubkey };
    }
    if (decoded.type === 'note') {
      return { type: 'ref', kind: 'note', raw: token, bech32, id: decoded.data };
    }
    if (decoded.type === 'nevent') {
      return { type: 'ref', kind: 'nevent', raw: token, bech32, id: decoded.data.id, pubkey: decoded.data.author };
    }
    if (decoded.type === 'naddr') {
      return {
        type: 'ref',
        kind: 'naddr',
        raw: token,
        bech32,
        naddr: {
          kind: decoded.data.kind,
          pubkey: decoded.data.pubkey,
          identifier: decoded.data.identifier,
          relays: decoded.data.relays
        }
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function splitNostrRefs(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const re = new RegExp(TOKEN.source, 'gi');
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const full = match[0];
    const token = match[1]!;
    if (match.index > last) segments.push({ type: 'text', text: content.slice(last, match.index) });
    const ref = decodeNostrBech32(token);
    if (ref) {
      segments.push({
        ...ref,
        raw: full.toLowerCase().includes('nostr:') ? full : `nostr:${token}`
      });
    } else {
      segments.push({ type: 'text', text: full });
    }
    last = match.index + full.length;
  }
  if (last < content.length) segments.push({ type: 'text', text: content.slice(last) });
  if (!segments.length) segments.push({ type: 'text', text: content });
  return segments;
}
