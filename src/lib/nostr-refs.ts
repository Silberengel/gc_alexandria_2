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
  /**
   * Nostrdown / citation display label. When set with `presentation: 'inline'`,
   * render as a prose link instead of a block card.
   */
  displayLabel?: string;
  /** Default `block` for bare note/nevent/naddr; nostrdown `ref`/`wiki`/`cite`/`quote` are inline. */
  presentation?: 'inline' | 'block';
};
export type ContentSegment = TextSegment | RefSegment;

export type HtmlSegment = { type: 'html'; html: string };
export type RenderSegment = HtmlSegment | RefSegment;

const TOKEN = /(?:nostr:)?(n(?:pub|profile|addr|event|ote|sec)1[02-9ac-hj-np-z]+)/gi;
/** Whole citation macros — must be peeled before bare nevent tokens inside them. */
const CITATION = /\[\[citation::([^:\]]+)::([^\]]+)\]\]/gi;
/** Nostrdown `{{prefix:target|label}}` / `{{@npub}}` — peel before bare nevent tokens. */
const NOSTRDOWN = /\{\{((?:(?!\}\}).)+)\}\}/g;
const NOSTRDOWN_PREFIXES = new Set([
  'ref',
  'wiki',
  'embed',
  'quote',
  'slot',
  'cite',
  'mention'
]);

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
  // Reuse the full protect path so nostrdown / citation macros win over bare tokens.
  const { text, refs } = protectNostrRefsForMarkup(content);
  if (!refs.length) return [{ type: 'text', text: content }];
  const segments: ContentSegment[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) {
      segments.push({ type: 'text', text: text.slice(last, match.index) });
    }
    const ref = refs[Number(match[1])];
    if (ref) segments.push(ref);
    else segments.push({ type: 'text', text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  if (!segments.length) segments.push({ type: 'text', text: content });
  return trimAdjacentToBlockEmbeds(segments);
}

/** note / nevent / naddr render as block cards — not inline mentions. */
export function isBlockEmbedRef(seg: ContentSegment | RenderSegment): boolean {
  if (seg.type !== 'ref') return false;
  if (seg.presentation === 'inline') return false;
  if (seg.presentation === 'block') return true;
  return seg.kind === 'note' || seg.kind === 'nevent' || seg.kind === 'naddr';
}

export function isInlineLabeledRef(seg: ContentSegment | RenderSegment): boolean {
  return seg.type === 'ref' && seg.presentation === 'inline';
}

/** In-app href for a decoded NIP-19 pointer (hash-router). */
export function nostrRefHref(seg: RefSegment): string {
  if (seg.kind === 'npub' || seg.kind === 'nprofile') {
    return `#/p/${seg.bech32}`;
  }
  if (seg.kind === 'naddr' && seg.naddr) {
    const { kind, pubkey, identifier } = seg.naddr;
    // Prefer article/wiki/spec/publication routes when kind is known.
    if (kind === 30023) {
      try {
        const npub = nip19.npubEncode(pubkey);
        return `#/article/d/${encodeURIComponent(identifier)}/p/${npub}`;
      } catch {
        /* fall through */
      }
    }
    if (kind === 30818) {
      try {
        const npub = nip19.npubEncode(pubkey);
        return `#/wiki/d/${encodeURIComponent(identifier)}/p/${npub}`;
      } catch {
        /* fall through */
      }
    }
    if (kind === 30817) {
      try {
        const npub = nip19.npubEncode(pubkey);
        return `#/spec/d/${encodeURIComponent(identifier)}/p/${npub}`;
      } catch {
        /* fall through */
      }
    }
  }
  return `#/feed?thread=${seg.bech32}`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Prose link for a nostrdown / citation inline reference. */
export function inlineNostrRefHtml(seg: RefSegment): string {
  const label = (seg.displayLabel || seg.bech32).trim() || seg.bech32;
  return `<a class="nostrdown-ref" href="${escapeAttr(nostrRefHref(seg))}">${escapeAttr(label)}</a>`;
}

type NostrdownParsed = {
  prefix: string;
  target: string;
  modifier: string;
  raw: string;
};

/** Parse nostrdown `{{…}}` body into prefix / target / optional label. */
export function parseNostrdownInner(inner: string): NostrdownParsed | null {
  const raw = inner.trim();
  if (!raw) return null;
  if (raw.startsWith('@')) {
    const rest = raw.slice(1);
    const pipe = rest.indexOf('|');
    const target = (pipe < 0 ? rest : rest.slice(0, pipe)).trim();
    const modifier = (pipe < 0 ? '' : rest.slice(pipe + 1)).trim();
    if (!target) return null;
    return { prefix: 'mention', target, modifier, raw };
  }
  const colon = raw.indexOf(':');
  if (colon <= 0) return null;
  const prefix = raw.slice(0, colon).trim().toLowerCase();
  if (!NOSTRDOWN_PREFIXES.has(prefix)) return null;
  const after = raw.slice(colon + 1);
  const pipe = after.indexOf('|');
  const target = (pipe < 0 ? after : after.slice(0, pipe)).trim();
  const modifier = (pipe < 0 ? '' : after.slice(pipe + 1)).trim();
  if (!target) return null;
  return { prefix, target, modifier, raw };
}

function nostrdownToRef(parsed: NostrdownParsed): RefSegment | null {
  const target = parsed.target.replace(/^nostr:/i, '').trim();
  const ref = decodeNostrBech32(target);
  if (!ref) return null;
  const inline =
    parsed.prefix === 'ref' ||
    parsed.prefix === 'wiki' ||
    parsed.prefix === 'cite' ||
    parsed.prefix === 'quote' ||
    parsed.prefix === 'mention';
  return {
    ...ref,
    raw: `{{${parsed.raw}}}`,
    displayLabel: parsed.modifier || undefined,
    presentation: inline ? 'inline' : 'block'
  };
}

export function isInlineMentionRef(seg: ContentSegment): boolean {
  return seg.type === 'ref' && (seg.kind === 'npub' || seg.kind === 'nprofile') && !!seg.pubkey;
}

export type PlainMentionPart =
  | { type: 'text'; text: string }
  | { type: 'mention'; pubkey: string };

export type PlainBodyBlock =
  | { type: 'flow'; parts: PlainMentionPart[] }
  | { type: 'segment'; index: number };

/**
 * Keep npub/nprofile badges inside the sentence they were written in.
 * Plaintext rich-text previously rendered each text chunk as a block `<div>`,
 * which forced a hard break around every mention.
 */
export function coalescePlainMentionFlows(segments: ContentSegment[]): PlainBodyBlock[] {
  const blocks: PlainBodyBlock[] = [];
  let flow: PlainMentionPart[] | null = null;

  const flush = (): void => {
    if (!flow?.length) {
      flow = null;
      return;
    }
    blocks.push({ type: 'flow', parts: flow });
    flow = null;
  };

  segments.forEach((seg, index) => {
    if (seg.type === 'text') {
      if (!flow) flow = [];
      flow.push({ type: 'text', text: seg.text });
      return;
    }
    if (isInlineMentionRef(seg) && seg.pubkey) {
      if (!flow) flow = [];
      flow.push({ type: 'mention', pubkey: seg.pubkey });
      return;
    }
    flush();
    blocks.push({ type: 'segment', index });
  });
  flush();
  return blocks;
}

/** Trailing blank lines only — keep a single space for inline citations. */
function stripTrailingBlankLines(text: string): string {
  return text.replace(/(?:[ \t]*\r?\n)+[ \t]*$/g, '');
}

function stripLeadingBlankLines(text: string): string {
  return text.replace(/^[ \t]*(?:\r?\n[ \t]*)+/g, '');
}

/**
 * Drop blank lines glued to block embeds so cards sit tight under prose
 * (`text\n\nnostr:nevent1…` should not leave an empty padded line).
 */
export function trimAdjacentToBlockEmbeds(segments: ContentSegment[]): ContentSegment[] {
  if (segments.length < 2) return segments;
  const out: ContentSegment[] = segments.map((s) =>
    s.type === 'text' ? { type: 'text', text: s.text } : { ...s }
  );
  for (let i = 0; i < out.length; i++) {
    const seg = out[i]!;
    if (seg.type !== 'text') continue;
    let text = seg.text;
    if (i > 0 && isBlockEmbedRef(out[i - 1]!)) text = stripLeadingBlankLines(text);
    if (i + 1 < out.length && isBlockEmbedRef(out[i + 1]!)) text = stripTrailingBlankLines(text);
    out[i] = { type: 'text', text };
  }
  return out.filter((s) => s.type !== 'text' || s.text.length > 0);
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

  const nostrdownRe = new RegExp(NOSTRDOWN.source, 'g');
  while ((m = nostrdownRe.exec(content))) {
    const parsed = parseNostrdownInner(m[1] ?? '');
    if (!parsed) continue;
    const ref = nostrdownToRef(parsed);
    if (!ref) continue;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      ref
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
    if (isInlineLabeledRef(seg)) {
      if (!flow) flow = [];
      flow.push({ type: 'html', html: inlineNostrRefHtml(seg) });
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
function stripTrailingBlankHtml(html: string): string {
  return html
    .replace(/(?:<p(?:\s[^>]*)?>\s*(?:<br\s*\/?>)?\s*<\/p>\s*)+$/gi, '')
    .replace(/(?:<br\s*\/?>\s*)+$/gi, '');
}

function stripLeadingBlankHtml(html: string): string {
  return html
    .replace(/^(?:\s*<p(?:\s[^>]*)?>\s*(?:<br\s*\/?>)?\s*<\/p>)+/gi, '')
    .replace(/^(?:\s*<br\s*\/?>)+/gi, '');
}

/** Collapse empty paragraphs glued to block embeds in rendered markup. */
export function trimHtmlAdjacentToBlockEmbeds(segments: RenderSegment[]): RenderSegment[] {
  if (segments.length < 2) return segments;
  const out = segments.map((s) => (s.type === 'html' ? { ...s } : { ...s }));
  for (let i = 0; i < out.length; i++) {
    const seg = out[i]!;
    if (seg.type !== 'html') continue;
    let html = seg.html;
    if (i > 0 && isBlockEmbedRef(out[i - 1]!)) html = stripLeadingBlankHtml(html);
    if (i + 1 < out.length && isBlockEmbedRef(out[i + 1]!)) html = stripTrailingBlankHtml(html);
    out[i] = { type: 'html', html };
  }
  return out.filter((s) => s.type !== 'html' || s.html.length > 0);
}

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
  return trimHtmlAdjacentToBlockEmbeds(segments);
}
