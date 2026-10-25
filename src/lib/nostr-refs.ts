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
  /** Relay hints from nevent / nprofile (and naddr via {@link naddr}.relays). */
  relays?: string[];
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
      return {
        type: 'ref',
        kind: 'nevent',
        raw: token,
        bech32,
        id: decoded.data.id,
        pubkey: decoded.data.author,
        relays: decoded.data.relays
      };
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

export type MentionPart = { type: 'html'; html: string } | { type: 'mention'; pubkey: string };

export type InlineBodyBlock =
  | { type: 'html'; html: string }
  | { type: 'flow'; parts: MentionPart[] }
  | { type: 'ref'; index: number };

/** If `html` ends inside an open `<p>`, split off that unfinished paragraph text. */
export function peelUnclosedParagraph(html: string): { done: string; open: string } {
  const tagRe = /<\/?p\b[^>]*>/gi;
  let depth = 0;
  let openAt = -1;
  let openLen = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    const closing = match[0].startsWith('</');
    if (closing) {
      depth = Math.max(0, depth - 1);
    } else {
      if (depth === 0) {
        openAt = match.index;
        openLen = match[0].length;
      }
      depth += 1;
    }
  }
  if (depth > 0 && openAt >= 0) {
    return { done: html.slice(0, openAt), open: html.slice(openAt + openLen) };
  }
  return { done: html, open: '' };
}

/**
 * Keep `npub` / `nprofile` mentions inside the paragraph they were written in.
 * A mention between two HTML chunks is one inline run, not its own row.
 */
export function coalesceInlineMentions(segments: RenderSegment[]): InlineBodyBlock[] {
  const blocks: InlineBodyBlock[] = [];
  let flow: MentionPart[] | null = null;

  const flush = (): void => {
    if (!flow?.length) {
      flow = null;
      return;
    }
    const parts = flow.filter((part) => part.type !== 'html' || part.html.length > 0);
    if (parts.length) blocks.push({ type: 'flow', parts });
    flow = null;
  };

  const pushHtml = (html: string): void => {
    if (!html) return;
    if (flow) {
      const closed = /^([\s\S]*?)<\/p\b[^>]*>([\s\S]*)$/i.exec(html);
      if (closed) {
        if (closed[1]) flow.push({ type: 'html', html: closed[1] });
        flush();
        pushHtml(closed[2] ?? '');
        return;
      }
      flow.push({ type: 'html', html });
      return;
    }
    const { done, open } = peelUnclosedParagraph(html);
    if (open) {
      if (done.trim()) blocks.push({ type: 'html', html: done });
      flow = [{ type: 'html', html: open }];
      return;
    }
    blocks.push({ type: 'html', html });
  };

  segments.forEach((seg, index) => {
    if (seg.type === 'html') {
      pushHtml(seg.html);
      return;
    }
    if ((seg.kind === 'npub' || seg.kind === 'nprofile') && seg.pubkey) {
      if (!flow) flow = [];
      flow.push({ type: 'mention', pubkey: seg.pubkey });
      return;
    }
    flush();
    blocks.push({ type: 'ref', index });
  });
  flush();
  return blocks;
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
