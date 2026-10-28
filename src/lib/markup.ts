import type { Document } from '@asciidoctor/core';
import DOMPurify from 'dompurify';
import { parse as parseDjot, renderHTML as renderDjot } from '@djot/djot';
import { getKind } from '@silberengel/kind-compose-catalog';
import { KIND } from './constants';
import { normalizeDTag } from './dtag';
import { cropRenderedUrlsInHtml } from './crop-url';
import { preprocessDjotDollarMath } from './katex-math';
import { promoteImageAutolinks, rewriteBareImageUrls } from './media';

/** Catalog-driven body formats. Markdown is not a catalog encoding. */
export type MarkupFormat = 'asciidoc' | 'djot' | 'plaintext';

const REFERENCE_LINK = /(?<!!)\[([^\]\n]+)]\[([^\]]*)]/;
const DJOT_ATTR = /\{[#.][^}\n]+\}/;
const DJOT_INSERT = /\{\+[^\n]+?\+\}/;
const DJOT_DELETE = /\{-[^\n]+?-\}/;
const DJOT_DEFINITION_LIST = /\S\n: \S/;
const ADMONITION_OR_BLOCK_ATTR =
  /^\[\s*(?:NOTE|TIP|WARNING|IMPORTANT|CAUTION|stem|listing|example|discrete)]/im;

/** NKBIP-06 / NIP-94 content MIME, plus optional markup/format aliases. */
const MARKUP_TAG_NAMES = ['m', 'markup', 'format'] as const;

export function markupFromMime(value: string | undefined): MarkupFormat | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v.includes('asciidoc') || v.includes('asciidoctor')) return 'asciidoc';
  if (v.includes('djot')) return 'djot';
  // Legacy markdown tags map to djot (cleanup runs before parse).
  if (v.includes('markdown') || v.includes('commonmark') || v === 'text/markup') return 'djot';
  if (v.includes('plain') || v === 'text/plain') return 'plaintext';
  return null;
}

/** True when a markup tag names Djot itself, not a legacy markdown alias. */
export function tagsDeclareDjot(tags: string[][] | undefined): boolean {
  if (!tags?.length) return false;
  for (const name of MARKUP_TAG_NAMES) {
    for (const tag of tags) {
      if (tag[0] !== name || !tag[1]) continue;
      if (tag[1].toLowerCase().includes('djot')) return true;
    }
  }
  return false;
}

/** Keep non-markup `m` tags (file MIME, rating mark) and record the body format. */
export function withMarkupTag(tags: string[][], format: 'djot' | 'asciidoc'): string[][] {
  const mime = format === 'asciidoc' ? 'text/asciidoc' : 'text/djot';
  let wrote = false;
  const next: string[][] = [];
  for (const tag of tags) {
    const name = tag[0] ?? '';
    if ((name === 'm' || name === 'markup' || name === 'format') && markupFromMime(tag[1])) {
      if (!wrote) next.push(['m', mime]);
      wrote = true;
      continue;
    }
    next.push(tag);
  }
  if (!wrote) next.push(['m', mime]);
  return next;
}

export function markupFromTags(tags: string[][] | undefined): MarkupFormat | null {
  if (!tags?.length) return null;
  for (const name of MARKUP_TAG_NAMES) {
    for (const tag of tags) {
      if (tag[0] !== name || !tag[1]) continue;
      const parsed = markupFromMime(tag[1]);
      if (parsed) return parsed;
    }
  }
  return null;
}

/** Djot / NIP-54 signals (reference wikilinks, attributes, containers). */
export function looksLikeDjot(content: string): boolean {
  if (!content.trim()) return false;
  if (REFERENCE_LINK.test(content)) return true;
  if (DJOT_ATTR.test(content)) return true;
  if (DJOT_INSERT.test(content)) return true;
  if (DJOT_DELETE.test(content)) return true;
  if (DJOT_DEFINITION_LIST.test(content)) return true;
  return false;
}

/** Native AsciiDoc document signals used by older GitCitadel wiki bodies. */
export function looksLikeNativeAsciidoc(content: string): boolean {
  if (!content.trim()) return false;
  const trimmed = content.trimStart();
  if (/^=+ \S/.test(trimmed)) return true;
  if (/^==+ \S/m.test(content)) return true;
  if (/\[source[^\]]*]\s*\n\s*----/.test(content)) return true;
  if (ADMONITION_OR_BLOCK_ATTR.test(content)) return true;
  if (/^(image|link|video|audio|include)::/m.test(content)) return true;
  return false;
}

/**
 * Collapse CommonMark double-marker emphasis to Djot singles on non-fenced lines.
 * Skips inline `code` spans. Does not touch `****` thematic breaks (no inner text).
 * Port of imwald DjotPreprocessor.normalizeMarkdownEmphasis.
 */
export function normalizeMarkdownEmphasis(content: string): string {
  return processLinesSkippingFences(content, (line) =>
    transformSkippingInlineCode(line, (segment) => {
      let s = segment;
      s = s.replace(/\*\*(?!\*)([^*\n]+?)\*\*(?!\*)/g, '*$1*');
      s = s.replace(/__(?!_)([^_\n]+?)__(?!_)/g, '_$1_');
      s = s.replace(/~~(?!~)([^~\n]+?)~~(?!~)/g, '{-$1-}');
      return s;
    })
  );
}

const FENCE_LINE = /^(`{3,}|~{3,})/;

/**
 * Djot treats a fence that continues a paragraph as a multiline inline `code`
 * span; the intended closer then opens a real code block and can swallow the
 * rest of the document (CommonMark interrupts the paragraph instead).
 * Insert a blank line before *opening* fences that follow non-empty prose.
 */
export function ensureBlockFences(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const isFence = FENCE_LINE.test(line.trimStart());
    if (isFence) {
      if (!inFence && out.length > 0 && out[out.length - 1]!.trim() !== '') {
        out.push('');
      }
      inFence = !inFence;
    }
    out.push(line);
  }
  return out.join('\n');
}

function processLinesSkippingFences(content: string, transform: (line: string) => string): string {
  const lines = content.split('\n');
  let inFence = false;
  return lines
    .map((line) => {
      if (FENCE_LINE.test(line.trimStart())) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : transform(line);
    })
    .join('\n');
}

function transformSkippingInlineCode(line: string, transform: (segment: string) => string): string {
  if (!line.includes('`')) return transform(line);
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const open = line.indexOf('`', i);
    if (open < 0) {
      out.push(transform(line.slice(i)));
      break;
    }
    if (open > i) out.push(transform(line.slice(i, open)));
    const close = line.indexOf('`', open + 1);
    if (close < 0) {
      out.push(line.slice(open));
      break;
    }
    out.push(line.slice(open, close + 1));
    i = close + 1;
  }
  return out.join('');
}

/** `getDocumentTitle()` is a string, or a partitioned {@link Document.Title}. */
function asciidocTitleText(title: ReturnType<Document['getDocumentTitle']>): string {
  if (title == null) return '';
  if (typeof title === 'string') return title.trim();
  return (title.getCombined() || title.getMain()).trim();
}

/** Title, author line, and revision. Embedded conversion omits this header. */
function asciidocDocumentHeader(doc: Document): string {
  const title = asciidocTitleText(doc.getDocumentTitle());
  if (!title) return '';
  const authors = doc.getAuthors?.() ?? [];
  const people = authors
    .map((author) => {
      const name = String(author.getName?.() ?? '').trim();
      const email = String(author.getEmail?.() ?? '').trim();
      if (!name && !email) return '';
      const nameHtml = name ? `<span class="author">${escapePlainHtml(name)}</span>` : '';
      const emailHtml = email
        ? `<span class="email"><a href="mailto:${escapePlainHtml(email)}">${escapePlainHtml(email)}</a></span>`
        : '';
      return `<span class="author-line">${[nameHtml, emailHtml].filter(Boolean).join(' ')}</span>`;
    })
    .filter(Boolean);
  const revNumber = String(doc.getRevisionNumber?.() ?? '').trim();
  const revDate = String(doc.getRevisionDate?.() ?? '').trim();
  const revRemark = String(doc.getRevisionRemark?.() ?? '').trim();
  const rev = [revNumber ? `version ${revNumber}` : '', revDate, revRemark].filter(Boolean).join(', ');
  const details = [
    people.length ? people.join('') : '',
    rev ? `<span class="rev">${escapePlainHtml(rev)}</span>` : ''
  ]
    .filter(Boolean)
    .join('');
  const byline = details ? `<p class="details">${details}</p>` : '';
  return `<header class="asciidoc-doc-header"><h1>${escapePlainHtml(title)}</h1>${byline}</header>`;
}

function escapePlainHtml(src: string): string {
  return src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Pick a renderer from catalog `content.encoding` (imwald ContentMarkupDetector).
 * - asciidoc → AsciiDoc
 * - djot → Djot (wiki may still select AsciiDoc on native AD signals)
 * - plaintext / json / empty / url / unknown → plaintext (NostrRichText)
 */
export function resolveMarkup(kind: number, content = '', tags?: string[][]): MarkupFormat {
  const tagged = markupFromTags(tags);
  const encoding = getKind(kind)?.content?.encoding;

  // Sections are AsciiDoc unless the event explicitly says Djot (`m` = text/djot).
  // Legacy markdown tags stay AsciiDoc.
  if (kind === KIND.SECTION || encoding === 'asciidoc') {
    if (tagsDeclareDjot(tags)) return 'djot';
    return 'asciidoc';
  }

  // Catalog djot kinds (and wiki, which is catalogued as djot).
  if (encoding === 'djot' || kind === KIND.WIKI) {
    if (tagged === 'asciidoc') return 'asciidoc';
    if (tagged === 'djot') return 'djot';
    // Wiki may still publish native AsciiDoc when Djot signals are absent.
    if (
      kind === KIND.WIKI &&
      looksLikeNativeAsciidoc(content) &&
      !looksLikeDjot(content)
    ) {
      return 'asciidoc';
    }
    return 'djot';
  }

  if (tagged === 'asciidoc') return 'asciidoc';
  if (tagged === 'djot') return 'djot';
  return 'plaintext';
}

export function rewriteWikilinks(src: string, format: MarkupFormat = 'djot'): string {
  const hrefFor = (slug: string) => `#/search?d=${encodeURIComponent(slug)}`;

  /** Asciidoctor default sectids: idprefix `_`, idseparator `_`, lowercased. */
  const sectionAnchorId = (fragment: string): string => {
    const folded = fragment.normalize('NFD').replace(/\p{M}/gu, '');
    let out = '';
    for (const ch of folded) {
      if (/\s/u.test(ch) || ch === '-' || ch === '.' || ch === '_') out += '_';
      else if (/[0-9A-Za-z]/u.test(ch)) out += ch.toLowerCase();
    }
    const core = out.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return core ? `_${core}` : '';
  };

  const parseTarget = (raw: string): { slug: string; fragment: string } => {
    const t = raw.trim();
    if (!t) return { slug: '', fragment: '' };
    if (t.startsWith('#')) return { slug: '', fragment: t.slice(1).trim() };
    const hash = t.indexOf('#');
    if (hash >= 0) {
      return { slug: t.slice(0, hash).trim(), fragment: t.slice(hash + 1).trim() };
    }
    return { slug: t, fragment: '' };
  };

  const toLink = (label: string, targetRaw: string): string => {
    const { slug, fragment } = parseTarget(targetRaw);
    let text = label.trim();
    if (text.startsWith('#')) text = text.slice(1).trim() || fragment;
    if (!text) text = slug || fragment;
    if (!slug && fragment) {
      const id = sectionAnchorId(fragment);
      if (!id) return text;
      const href = `#${id}`;
      if (format === 'asciidoc') return `link:${href}[${text}]`;
      return `[${text}](${href})`;
    }
    const d = normalizeDTag(slug);
    if (!d) return text;
    if (format === 'asciidoc') return `link:${hrefFor(d)}[${text}]`;
    return `[${text}](${hrefFor(d)})`;
  };

  let out = src;

  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (match, target: string, label: string) => {
    if (String(target).trim().toLowerCase().startsWith('citation::')) return match;
    return toLink(String(label), String(target));
  });
  // Nostrdown / MediaWiki display form: [[topic][Label]]
  out = out.replace(/\[\[([^\]|]+)\]\[([^\]]+)\]\]/g, (match, target: string, label: string) => {
    if (String(target).trim().toLowerCase().startsWith('citation::')) return match;
    return toLink(String(label), String(target));
  });
  out = out.replace(/\[\[([^\]|]+)\]\]/g, (match, target: string) => {
    if (String(target).trim().toLowerCase().startsWith('citation::')) return match;
    const text = String(target).trim();
    return toLink(text, text);
  });

  // Djot / CommonMark reference link with empty destination → treat label as wiki slug.
  out = out.replace(/\[([^\]\n]+)\]\[\]/g, (_m, target: string) => {
    const text = String(target).trim();
    return toLink(text, text);
  });

  out = out.replace(
    /\[([^\]]+)\]\((#\/(?:wiki\/d\/|search\?d=)([^)#\s]+))\)/g,
    (_m, label: string, _href: string, raw: string) => {
      const decoded = decodeURIComponent(String(raw).replace(/\+/g, ' '));
      return toLink(String(label).trim() || decoded, decoded);
    }
  );

  if (format === 'asciidoc') {
    out = out.replace(
      /link:#\/wiki\/d\/([^[\s\]]+)\[([^\]]*)\]/g,
      (_m, raw: string, label: string) => {
        const decoded = decodeURIComponent(String(raw));
        return toLink(String(label).trim() || decoded, decoded);
      }
    );
  }

  return out;
}

const ALLOWED_URI = /^(?:(?:https?|mailto):|\/|#)/i;

export function isAllowedHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith('javascript:')) return false;
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function isAllowedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hookPurify(purify: typeof DOMPurify): void {
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    for (const attr of ['href', 'src', 'xlink:href', 'poster']) {
      if (!node.hasAttribute(attr)) continue;
      const value = node.getAttribute(attr) ?? '';
      const ok = attr === 'href' ? isAllowedHref(value) : isAllowedMediaUrl(value);
      if (!ok) node.removeAttribute(attr);
    }
  });
}

let hooked = false;

export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') {
    return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+=/gi, ' ');
  }
  if (!hooked) {
    hookPurify(DOMPurify);
    hooked = true;
  }
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['srcdoc'],
    ALLOWED_URI_REGEXP: ALLOWED_URI
  });
}

let asciidoctorConvert: ((src: string) => string) | null = null;
let asciidoctorLoading: Promise<void> | null = null;

async function loadAsciidoctor(): Promise<(src: string) => string> {
  if (asciidoctorConvert) return asciidoctorConvert;
  if (!asciidoctorLoading) {
    asciidoctorLoading = Promise.all([
      import('@asciidoctor/core'),
      import('./highlight'),
      import('./katex-math')
    ]).then(([mod, { highlightCodeBlocks }, { preprocessAsciidocDollarMath, renderMathInHtml }]) => {
      const factory = mod.default;
      const processor = typeof factory === 'function' ? factory() : factory;
      asciidoctorConvert = (src: string) => {
        const prepared = preprocessAsciidocDollarMath(src);
        const doc = processor.load(prepared, {
          safe: 'secure',
          standalone: false,
          doctype: 'article',
          attributes: {
            'source-highlighter': 'highlight.js',
            // menu:, btn:, and kbd: are UI macros. AsciiDoc leaves them as
            // source text unless this attribute is set.
            experimental: '',
            // Prefer TeX/LaTeX so stem:/latexmath: emit \(…\) / \[…\] for KaTeX.
            stem: 'latexmath'
          }
        });
        const html = asciidocDocumentHeader(doc) + String(doc.convert());
        return renderMathInHtml(highlightCodeBlocks(html));
      };
    });
  }
  await asciidoctorLoading;
  return asciidoctorConvert!;
}

/** Block-drawing / shade characters used as decorative “cursed” letterforms. */
const ASCII_GLYPH_CHARS =
  /[\u2580-\u259F\u25A0-\u25FF\u28A0-\u28FF░▒▓█▀▄▌▐■□▪▫]/u;

function isAsciiGlyphArt(text: string): boolean {
  const trimmed = text.replace(/\s+$/u, '');
  if (!trimmed || trimmed.length < 8) return false;
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 3 || lines.length > 16) return false;
  let glyph = 0;
  let other = 0;
  for (const ch of trimmed) {
    if (/\s/u.test(ch)) continue;
    if (ASCII_GLYPH_CHARS.test(ch)) glyph += 1;
    else if (/[A-Za-z]/u.test(ch)) other += 1;
    else other += 1;
  }
  if (glyph < 20) return false;
  return glyph >= other * 3;
}

/** Pull a trailing latin fragment (`e`, `nd`, `olari`…) out of an ASCII-art letter fence. */
function splitAsciiGlyphTail(text: string): { art: string; tail: string } {
  const trimmed = text.replace(/\s+$/u, '');
  const m = /^(.*?)[ \t]*([A-Za-z]{1,16})[ \t]*$/su.exec(trimmed);
  if (!m?.[1] || !m[2]) return { art: trimmed, tail: '' };
  if (!isAsciiGlyphArt(m[1])) return { art: trimmed, tail: '' };
  return { art: m[1].replace(/\s+$/u, ''), tail: m[2] };
}

export function renderDjotHtml(src: string): string {
  // Dollar math → Djot `$`tex`` so `_` / `*` inside TeX are not emphasis.
  const normalized = preprocessDjotDollarMath(
    normalizeMarkdownEmphasis(ensureBlockFences(src))
  );
  try {
    return renderDjot(parseDjot(normalized), {
      overrides: {
        // Unlabeled `:::` is a neutral call-out; named ones keep note/tip/sidebar/…
        div(node, renderer) {
          const attrs = node.attributes;
          if (attrs?.class?.trim()) return renderer.renderAstNodeDefault(node);
          const prev = node.attributes;
          node.attributes = { ...(attrs ?? {}), class: 'callout' };
          const html = renderer.renderAstNodeDefault(node);
          node.attributes = prev;
          return html;
        },
        // Native checkbox inputs inherit full-width form styles and look like bars.
        task_list_item(node, renderer) {
          const checked = node.checkbox === 'checked';
          const body = renderer.renderChildren(node);
          const cls = checked ? 'task-list-item is-checked' : 'task-list-item';
          return `<li class="${cls}">${body}</li>\n`;
        },
        // `{source="…"}` is only an HTML attribute, so the preview and reader never showed it.
        block_quote(node, renderer) {
          const html = renderer.renderAstNodeDefault(node);
          const source = node.attributes?.source?.trim();
          if (!source) return html;
          const cite = `<footer class="djot-source">${renderer.escape(source)}</footer>\n`;
          return html.replace(/<\/blockquote>\s*$/, `${cite}</blockquote>\n`);
        },
        // Decorative block-char “letters” (e.g. cursed-software essays) — compact, keep tail.
        code_block(node, renderer) {
          const text = String(node.text ?? '');
          if (!isAsciiGlyphArt(text) && !isAsciiGlyphArt(splitAsciiGlyphTail(text).art)) {
            return renderer.renderAstNodeDefault(node);
          }
          const { art, tail } = splitAsciiGlyphTail(text);
          const body = renderer.escape(art);
          const glyph = `<pre class="ascii-glyph" aria-hidden="true">${body}</pre>`;
          if (!tail) return `<span class="ascii-glyph-wrap">${glyph}</span>\n`;
          return `<span class="ascii-glyph-wrap">${glyph}<span class="ascii-glyph-tail">${renderer.escape(tail)}</span></span>\n`;
        }
      }
    });
  } catch {
    return `<pre>${escapePlainHtml(normalized)}</pre>`;
  }
}

async function highlightRenderedHtml(html: string): Promise<string> {
  const [{ highlightCodeBlocks }, { renderMathInHtml }] = await Promise.all([
    import('./highlight'),
    import('./katex-math')
  ]);
  return renderMathInHtml(highlightCodeBlocks(html));
}

async function renderAsciidocHtml(src: string): Promise<string> {
  const convert = await loadAsciidoctor();
  return convert(src);
}

/** Escaped paragraphs for catalog plaintext when NostrRichText is not used. */
export function renderPlaintextHtml(src: string): string {
  const escaped = escapePlainHtml(src);
  return escaped
    .split(/\n\n+/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function applyMathToHtml(html: string): Promise<string> {
  const { renderMathInHtml } = await import('./katex-math');
  return renderMathInHtml(html);
}

/** Hashtag after start or a non-word character. Body is letters, numbers, underscore. */
const TOPIC_HASHTAG = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,64})/gu;
/** Bare http(s) URL in text nodes (Djot does not autolink). */
const BARE_HTTP_URL = /(https?:\/\/[^\s<>"')\]]+)/gi;
const LINKIFY_SKIP_TAGS = new Set(['a', 'pre', 'code', 'script', 'style']);

function topicSearchHref(tag: string): string {
  return `#/search?subject=${encodeURIComponent(tag)}`;
}

function escapeHrefAttr(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function linkifyHashtagText(segment: string): string {
  return segment.replace(TOPIC_HASHTAG, (_full, prefix: string, tag: string) => {
    return `${prefix}<a href="${topicSearchHref(tag)}">#${tag}</a>`;
  });
}

/** Strip trailing punctuation often glued onto pasted links. */
function tidyBareUrl(raw: string): string {
  return raw.trim().replace(/[),.;:!?'"\]]+$/g, '');
}

function linkifyHttpText(segment: string): string {
  return segment.replace(BARE_HTTP_URL, (raw) => {
    const url = tidyBareUrl(raw);
    const trail = raw.slice(url.length);
    if (!isAllowedHref(url)) return raw;
    return `<a href="${escapeHrefAttr(url)}" rel="noopener noreferrer" target="_blank">${escapeHrefAttr(url)}</a>${trail}`;
  });
}

/** Walk text nodes; skip tags that already link or hold code. */
function mapHtmlTextNodes(html: string, transform: (text: string) => string): string {
  let out = '';
  let i = 0;
  let skip = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end < 0) {
        out += html.slice(i);
        break;
      }
      const tag = html.slice(i, end + 1);
      const name = /^<\/?\s*([a-zA-Z0-9]+)/.exec(tag)?.[1]?.toLowerCase();
      if (name && LINKIFY_SKIP_TAGS.has(name)) {
        const closing = /^<\s*\//.test(tag);
        const selfClosing = /\/>\s*$/.test(tag);
        if (!selfClosing) skip = Math.max(0, skip + (closing ? -1 : 1));
      }
      out += tag;
      i = end + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const text = html.slice(i, next === -1 ? html.length : next);
    out += skip > 0 ? text : transform(text);
    if (next === -1) break;
    i = next;
  }
  return out;
}

/** Turn `#topic` in rendered text into a subject search link. Leaves links and code alone. */
export function linkifyTopicHashtags(html: string): string {
  if (!html.includes('#')) return html;
  return mapHtmlTextNodes(html, linkifyHashtagText);
}

/** Turn bare `https://…` in rendered text into anchors (Djot leaves them plain). */
export function linkifyBareHttpUrls(html: string): string {
  if (!/https?:\/\//i.test(html)) return html;
  return mapHtmlTextNodes(html, linkifyHttpText);
}

/**
 * AsciiDoc `image:url[alt,100]` emits `width="100"`, but prose layout CSS
 * (max-height, object-fit, …) does not honor HTML presentational width/height.
 * Copy numeric attrs into `style` so the authored size sticks (still capped by max-width).
 */
export function honorHtmlImageSizeAttrs(html: string): string {
  if (!/<img\b/i.test(html) || !/\b(?:width|height)\s*=/i.test(html)) return html;
  return html.replace(/<img\b([^>]*?)>/gi, (full, rawAttrs: string) => {
    const width = /\bwidth\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i.exec(rawAttrs);
    const height = /\bheight\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i.exec(rawAttrs);
    const w = width?.[1] ?? width?.[2] ?? width?.[3];
    const h = height?.[1] ?? height?.[2] ?? height?.[3];
    if (!w && !h) return full;

    const styleMatch = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(rawAttrs);
    let style = (styleMatch?.[2] ?? styleMatch?.[3] ?? '').trim();
    const hasWidth = /(?:^|;)\s*width\s*:/i.test(style);
    const hasHeight = /(?:^|;)\s*height\s*:/i.test(style);
    const bits: string[] = [];
    if (w && !hasWidth) bits.push(`width:${w}px`);
    if (h && !hasHeight) bits.push(`height:${h}px`);
    else if (w && !h && !hasHeight) bits.push('height:auto');
    if (!bits.length) return full;

    const addition = bits.join(';');
    if (styleMatch) {
      const next = (style ? `${style.replace(/;?\s*$/, '')};` : '') + addition;
      const quote = styleMatch[0].includes("'") ? "'" : '"';
      return `<img${rawAttrs.replace(styleMatch[0], ` style=${quote}${next}${quote}`)}>`;
    }
    return `<img${rawAttrs} style="${addition}">`;
  });
}

function presentHtml(html: string): string {
  return linkifyTopicHashtags(
    cropRenderedUrlsInHtml(
      sanitizeHtml(honorHtmlImageSizeAttrs(promoteImageAutolinks(linkifyBareHttpUrls(html))))
    )
  );
}

export async function renderFormat(format: MarkupFormat, content: string): Promise<string> {
  if (format === 'plaintext') {
    return presentHtml(await applyMathToHtml(renderPlaintextHtml(content ?? '')));
  }
  const rewritten = rewriteBareImageUrls(rewriteWikilinks(content ?? '', format), format);
  try {
    if (format === 'asciidoc') return presentHtml(await renderAsciidocHtml(rewritten));
    return presentHtml(await highlightRenderedHtml(renderDjotHtml(rewritten)));
  } catch {
    return presentHtml(await applyMathToHtml(renderPlaintextHtml(content ?? '')));
  }
}

export async function renderMarkup(
  kind: number,
  content: string,
  tags?: string[][]
): Promise<string> {
  return renderFormat(resolveMarkup(kind, content, tags), content);
}

export async function renderWithFallback(
  kind: number,
  content: string,
  tags?: string[][]
): Promise<string> {
  return renderMarkup(kind, content, tags);
}

export type HighlightQuote = {
  quote: string;
  pubkey?: string;
  eventId?: string;
  /** NIP-84 `comment` tag on the highlight. */
  note?: string;
  /** Ink-note GIF URL (kind 1111 quote + drawing). */
  inkUrl?: string;
  /** Ink-note event id for thread deep-link (may differ from highlight id). */
  inkEventId?: string;
};

function escapeHighlightAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Allow markup tags / whitespace between words so quotes still match after AsciiDoc/Djot render. */
export function flexibleQuotePattern(quote: string): string {
  const words = quote
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return '';
  return words.join('(?:\\s|\\u00a0|&nbsp;|&#160;|<[^>]+>)+');
}

function highlightOpenTag(item: {
  pubkey?: string;
  eventId?: string;
  note?: string;
  inkUrl?: string;
  inkEventId?: string;
}): string {
  const pk = (item.pubkey ?? '').trim().toLowerCase();
  const id = (item.eventId ?? '').trim().toLowerCase();
  const inkId = (item.inkEventId ?? '').trim().toLowerCase();
  const note = (item.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  const inkUrl = (item.inkUrl ?? '').trim();
  const parts = ['class="text-highlight"'];
  if (/^[0-9a-f]{64}$/.test(pk)) parts.push(`data-highlight-pubkey="${pk}"`);
  if (/^[0-9a-f]{64}$/.test(id)) parts.push(`data-highlight-id="${id}"`);
  if (note) parts.push(`data-highlight-note="${escapeHighlightAttr(note)}"`);
  if (/^https?:\/\//i.test(inkUrl)) parts.push(`data-ink-url="${escapeHighlightAttr(inkUrl)}"`);
  if (/^[0-9a-f]{64}$/.test(inkId)) parts.push(`data-ink-id="${inkId}"`);
  return `<mark ${parts.join(' ')}><span class="text-highlight-text">`;
}

export function markHighlights(html: string, quotes: Array<string | HighlightQuote>): string {
  let out = html;
  for (const item of quotes) {
    const quote = typeof item === 'string' ? item : item.quote;
    const meta =
      typeof item === 'string'
        ? {}
        : {
            pubkey: item.pubkey,
            eventId: item.eventId,
            note: item.note,
            inkUrl: item.inkUrl,
            inkEventId: item.inkEventId
          };
    const trimmed = quote.replace(/\s+/g, ' ').trim();
    if (trimmed.length < 8) continue;
    const open = highlightOpenTag(meta);
    const close = '</span></mark>';

    const exact = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactRe = new RegExp(exact, 'i');
    if (exactRe.test(out) && !out.match(exactRe)?.[0]?.includes('<mark')) {
      out = out.replace(exactRe, (m) => `${open}${m}${close}`);
      continue;
    }

    const flexible = flexibleQuotePattern(trimmed);
    if (!flexible) continue;
    const flexRe = new RegExp(flexible, 'i');
    const hit = out.match(flexRe)?.[0];
    if (!hit || hit.includes('<mark')) continue;
    out = out.replace(flexRe, `${open}${hit}${close}`);
  }
  return out;
}

/** NIP-84 `context` tag — surrounding passage for the highlighted subset. */
export function highlightContextTag(tags: string[][] | undefined): string {
  if (!tags?.length) return '';
  return tags.find((t) => t[0] === 'context' && t[1])?.[1]?.trim() ?? '';
}

/** NIP-84 quote-highlight `comment` tag — the highlighter's note on the quote. */
export function highlightCommentTag(tags: string[][] | undefined): string {
  if (!tags?.length) return '';
  return tags.find((t) => t[0] === 'comment' && t[1])?.[1]?.trim() ?? '';
}

/**
 * Render a kind-9802 body: prefer `context` as the passage and wrap `.content`
 * (the quote) in {@link markHighlights}. Falls back to the quote alone when
 * there is no usable surrounding context.
 */
export async function renderHighlightEventHtml(opts: {
  content: string;
  tags?: string[][];
  pubkey?: string;
}): Promise<string> {
  const quote = (opts.content ?? '').replace(/\s+/g, ' ').trim();
  const context = highlightContextTag(opts.tags);
  const passage = context || quote;
  if (!passage) return '';
  const html = await renderFormat('plaintext', passage);
  if (!quote || quote.length < 8) return html;
  const normPassage = passage.replace(/\s+/g, ' ').trim();
  if (normPassage.toLowerCase() === quote.toLowerCase()) return html;
  return markHighlights(html, [{ quote, pubkey: opts.pubkey }]);
}
