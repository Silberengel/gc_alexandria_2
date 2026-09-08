import DOMPurify from 'dompurify';
import { parse as parseDjot, renderHTML as renderDjot } from '@djot/djot';
import MarkdownIt from 'markdown-it';
import { KIND } from './constants';
import { normalizeDTag } from './dtag';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

export type MarkupFormat = 'asciidoc' | 'djot' | 'markdown';

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
  if (v.includes('markdown') || v.includes('commonmark') || v === 'text/markup') return 'markdown';
  return null;
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

/** Classic CommonMark signals for kind 11 fallback. */
export function looksLikeLegacyMarkdown(content: string): boolean {
  if (!content.trim()) return false;
  if (/^#{1,6}\s+\S/m.test(content)) return true;
  if (/^```/m.test(content)) return true;
  if (/^>\s?\S/m.test(content)) return true;
  if (/!\[[^\]]*]\([^)\s]+\)/.test(content)) return true;
  if (/(?<!!)\[([^\]\n]+)]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/.test(content)) return true;
  if (/\*\*[^*\n]+\*\*|__[^_\n]+__/.test(content)) return true;
  if (/(?<!\*)\*[^*\s][^*\n]*\*(?!\*)|(?<!_)_[^_\s][^_\n]*_(?!_)/.test(content)) return true;
  if (/^(?:[*+-]|\d+\.)\s+\S/m.test(content)) return true;
  return false;
}

/**
 * Pick a renderer.
 * - 30041 is always AsciiDoc
 * - 30818 is Djot unless tags or native AsciiDoc say otherwise
 * - 11 is Djot unless tags or CommonMark (without Djot signals) say otherwise
 * - everything else is CommonMark
 */
export function resolveMarkup(kind: number, content = '', tags?: string[][]): MarkupFormat {
  const tagged = markupFromTags(tags);
  if (kind === KIND.SECTION) return 'asciidoc';
  if (kind === KIND.WIKI) {
    if (tagged === 'asciidoc' || tagged === 'djot') return tagged;
    if (looksLikeDjot(content)) return 'djot';
    if (looksLikeNativeAsciidoc(content)) return 'asciidoc';
    return 'djot';
  }
  if (kind === KIND.DJOT) {
    if (tagged === 'markdown' || tagged === 'djot') return tagged;
    if (looksLikeDjot(content)) return 'djot';
    if (looksLikeLegacyMarkdown(content)) return 'markdown';
    return 'djot';
  }
  return 'markdown';
}

/** Kind-only default when tags and body are not available. */
export function markupForKind(kind: number): MarkupFormat {
  return resolveMarkup(kind);
}

export function rewriteWikilinks(src: string, format: MarkupFormat = 'markdown'): string {
  const hrefFor = (slug: string) => `#/search?d=${encodeURIComponent(slug)}`;
  const toLink = (label: string, slug: string): string => {
    if (!slug) return label;
    if (format === 'asciidoc') return `link:${hrefFor(slug)}[${label}]`;
    return `[${label}](${hrefFor(slug)})`;
  };

  let out = src;

  // [[target|label]] and [[target]] — skip citation:: markers
  out = out.replace(/\[\[([^\]|#]+)\|([^\]]+)\]\]/g, (match, target: string, label: string) => {
    if (String(target).trim().toLowerCase().startsWith('citation::')) return match;
    const slug = normalizeDTag(String(target).trim());
    return toLink(String(label).trim() || String(target).trim(), slug);
  });
  out = out.replace(/\[\[([^\]|#]+)\]\]/g, (match, target: string) => {
    if (String(target).trim().toLowerCase().startsWith('citation::')) return match;
    const text = String(target).trim();
    return toLink(text, normalizeDTag(text));
  });

  // Djot/MD unresolved reference links: [text][]
  out = out.replace(/\[([^\]\n]+)\]\[\]/g, (_m, target: string) => {
    const text = String(target).trim();
    return toLink(text, normalizeDTag(text));
  });

  // Existing markdown / already-rewritten wiki or d-search links → normalize to d-search
  out = out.replace(
    /\[([^\]]+)\]\((#\/(?:wiki\/d\/|search\?d=)([^)#\s]+))\)/g,
    (_m, label: string, _href: string, raw: string) => {
      const decoded = decodeURIComponent(String(raw).replace(/\+/g, ' '));
      const slug = normalizeDTag(decoded);
      return toLink(String(label).trim() || decoded, slug);
    }
  );

  // AsciiDoc link:#/wiki/d/slug[label] → d-search
  if (format === 'asciidoc') {
    out = out.replace(
      /link:#\/wiki\/d\/([^[\s\]]+)\[([^\]]*)\]/g,
      (_m, raw: string, label: string) => {
        const decoded = decodeURIComponent(String(raw));
        const slug = normalizeDTag(decoded);
        return toLink(String(label).trim() || decoded, slug);
      }
    );
  }

  return out;
}

const ALLOWED_URI = /^(?:(?:https?|mailto):|\/|#)/i;

export function isAllowedHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith('javascript:')) return false;
  if (trimmed.startsWith('#/') || trimmed.startsWith('/')) return true;
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
    asciidoctorLoading = import('@asciidoctor/core').then((mod) => {
      const factory = mod.default;
      const processor = typeof factory === 'function' ? factory() : factory;
      asciidoctorConvert = (src: string) =>
        String(processor.convert(src, { safe: 'secure', standalone: false, doctype: 'article' }));
    });
  }
  await asciidoctorLoading;
  return asciidoctorConvert!;
}

export function renderDjotHtml(src: string): string {
  return renderDjot(parseDjot(src));
}

export function renderMarkdownHtml(src: string): string {
  return md.render(src);
}

async function renderAsciidocHtml(src: string): Promise<string> {
  const convert = await loadAsciidoctor();
  return convert(src);
}

export async function renderFormat(format: MarkupFormat, content: string): Promise<string> {
  const rewritten = rewriteWikilinks(content ?? '', format);
  try {
    if (format === 'asciidoc') return sanitizeHtml(await renderAsciidocHtml(rewritten));
    if (format === 'djot') return sanitizeHtml(renderDjotHtml(rewritten));
    return sanitizeHtml(renderMarkdownHtml(rewritten));
  } catch {
    return sanitizeHtml(renderMarkdownHtml(rewriteWikilinks(content ?? '', 'markdown')));
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

export function markHighlights(html: string, quotes: string[]): string {
  let out = html;
  for (const quote of quotes) {
    const trimmed = quote.replace(/\s+/g, ' ').trim();
    if (trimmed.length < 8) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'i'), `<mark>$&</mark>`);
  }
  return out;
}
