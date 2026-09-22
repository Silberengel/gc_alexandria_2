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

export type HtmlSegment = { type: 'html'; html: string };
export type RenderSegment = HtmlSegment | RefSegment;

const TOKEN = /(?:nostr:)?(n(?:pub|profile|addr|event|ote|sec)1[02-9ac-hj-np-z]+)/gi;
/** Whole citation macros — must be peeled before bare nevent tokens inside them. */
const CITATION = /\[\[citation::([^:\]]+)::([^\]]+)\]\]/gi;

/** Opaque token that survives AsciiDoc / Djot / Markdown rendering. */
export function nostrRefPlaceholder(index: number): string {
  return `ZZNOSTRREF${index}ZZ`;
}

const PLACEHOLDER_RE = /ZZNOSTRREF(\d+)ZZ/g;

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

function cleanCitationId(raw: string): string {
  let id = raw.trim();
  while (id.toLowerCase().startsWith('nostr:')) id = id.slice(6);
  return id;
}

/**
 * Split content into text and nostr ref segments (for short notes / comments).
 * Do **not** use this before AsciiDoc/Djot render — it tears listing and table blocks.
 */
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

type Hit = { start: number; end: number; ref: RefSegment };

/**
 * True when `index` sits inside an AsciiDoc autolink / link / image target
 * (e.g. `https://njump.me/npub1…[label]`). Replacing those tokens breaks the macro.
 */
export function isInsideAsciiDocTarget(content: string, index: number): boolean {
  if (index <= 0) return false;
  let i = index - 1;
  while (i >= 0) {
    const ch = content[i]!;
    if (/\s/.test(ch) || ch === '[') break;
    i--;
  }
  const prefix = content.slice(i + 1, index);
  if (!prefix) return false;
  if (/^(?:https?:\/\/|link:|mailto:|image::?)/i.test(prefix)) return true;
  if (/https?:\/\//i.test(prefix)) return true;
  if (/(?:^|[^a-z])(?:link|image):/i.test(prefix)) return true;
  return false;
}

/**
 * Replace citation macros and nostr bech32 tokens with placeholders so a full
 * AsciiDoc / Djot / Markdown document can be rendered in one pass.
 * Skips tokens that are part of AsciiDoc URL/link/image targets.
 */
export function protectNostrRefsForMarkup(content: string): {
  text: string;
  refs: RefSegment[];
} {
  if (!content) return { text: '', refs: [] };

  const hits: Hit[] = [];

  const citationRe = new RegExp(CITATION.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = citationRe.exec(content))) {
    const id = cleanCitationId(m[2] ?? '');
    const ref = decodeNostrBech32(id);
    if (!ref) continue;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      ref: { ...ref, raw: m[0] }
    });
  }

  const tokenRe = new RegExp(TOKEN.source, 'gi');
  while ((m = tokenRe.exec(content))) {
    const start = m.index;
    const end = start + m[0].length;
    if (hits.some((h) => start >= h.start && end <= h.end)) continue;
    if (isInsideAsciiDocTarget(content, start)) continue;
    const full = m[0];
    const token = m[1]!;
    const ref = decodeNostrBech32(token);
    if (!ref) continue;
    hits.push({
      start,
      end,
      ref: {
        ...ref,
        raw: full.toLowerCase().includes('nostr:') ? full : `nostr:${token}`
      }
    });
  }

  hits.sort((a, b) => a.start - b.start);
  const kept: Hit[] = [];
  for (const hit of hits) {
    if (kept.some((k) => hit.start < k.end && hit.end > k.start)) continue;
    kept.push(hit);
  }

  const refs: RefSegment[] = [];
  let out = '';
  let cursor = 0;
  for (const hit of kept) {
    out += content.slice(cursor, hit.start);
    out += nostrRefPlaceholder(refs.length);
    refs.push(hit.ref);
    cursor = hit.end;
  }
  out += content.slice(cursor);
  return { text: out, refs };
}

/** Re-split rendered HTML on placeholders into html chunks and ref embeds. */
export function expandNostrRefPlaceholders(html: string, refs: RefSegment[]): RenderSegment[] {
  if (!refs.length) return [{ type: 'html', html }];
  const segments: RenderSegment[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    if (match.index > last) {
      segments.push({ type: 'html', html: html.slice(last, match.index) });
    }
    const idx = Number(match[1]);
    const ref = refs[idx];
    if (ref) segments.push(ref);
    else segments.push({ type: 'html', html: match[0] });
    last = match.index + match[0].length;
  }
  if (last < html.length) segments.push({ type: 'html', html: html.slice(last) });
  if (!segments.length) segments.push({ type: 'html', html });
  return segments;
}
