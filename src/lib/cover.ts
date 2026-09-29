import type { Event } from 'nostr-tools';
import { isBibleSection } from './bible-verse';
import { firstTag } from './nostr/verify';
import { toNostrBuildThumbUrl } from './nostr-build';

const GUTENBERG_EBOOK_URL = /gutenberg\.org\/ebooks\/(\d+)/i;
const GUTENBERG_FILES_URL = /gutenberg\.org\/files\/(\d+)/i;
const GUTENBERG_CACHE_URL = /gutenberg\.org\/cache\/epub\/(\d+)/i;
const GUTENBERG_DTAG = /^pg(\d+)(?:-.*)?$/i;
const GUTENBERG_IDENTIFIER = /(?:^gutenberg:|[/\s]pg)(\d+)/i;
const DIRECT_IMAGE = /^https?:\/\//i;

export function gutenbergCoverUrl(ebookId: string, size: 'small' | 'medium' = 'medium'): string {
  const id = ebookId.trim();
  return `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.${size}.jpg`;
}

function gutenbergIdFromText(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  for (const pattern of [GUTENBERG_EBOOK_URL, GUTENBERG_FILES_URL, GUTENBERG_CACHE_URL, GUTENBERG_IDENTIFIER]) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  const d = trimmed.match(GUTENBERG_DTAG);
  return d?.[1] ?? null;
}

function imetaImageUrl(event: Event): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue;
    const joined = tag.slice(1);
    const urlField = joined.find((item) => item.startsWith('url '));
    if (urlField) return urlField.slice(4).trim();
    const urlIdx = joined.indexOf('url');
    if (urlIdx >= 0 && joined[urlIdx + 1]) return joined[urlIdx + 1];
    const bare = joined.find((item) => /^https?:\/\//i.test(item));
    if (bare) return bare;
  }
  return undefined;
}

/** Full-resolution cover URL (no nostr.build thumb rewrite). */
export function coverFullImageUrl(event: Event): string | undefined {
  const image = firstTag(event, 'image')?.trim();
  if (image && DIRECT_IMAGE.test(image)) {
    const id = gutenbergIdFromText(image);
    return id ? gutenbergCoverUrl(id) : image;
  }

  const imeta = imetaImageUrl(event);
  if (imeta) return imeta;

  const source = firstTag(event, 's') ?? firstTag(event, 'source');
  const fromSource = gutenbergIdFromText(source);
  if (fromSource) return gutenbergCoverUrl(fromSource);

  const identifier = firstTag(event, 'i');
  const fromId = gutenbergIdFromText(identifier);
  if (fromId) return gutenbergCoverUrl(fromId);

  const fromD = gutenbergIdFromText(firstTag(event, 'd'));
  if (fromD) return gutenbergCoverUrl(fromD);

  return undefined;
}

/** Cover from `image`, then `imeta`, then Gutenberg id on s / i / d (thumbs when available). */
export function coverImageUrl(event: Event): string | undefined {
  const full = coverFullImageUrl(event);
  return full ? toNostrBuildThumbUrl(full) : undefined;
}

/** Explicit `image` tag for reader section/index heroes (no Gutenberg/imeta fallback). */
export function sectionHeroImageUrl(event: Event): string | undefined {
  const image = firstTag(event, 'image')?.trim();
  if (image && DIRECT_IMAGE.test(image)) return toNostrBuildThumbUrl(image);
  return undefined;
}

/** Full-size section/edition hero (no thumb rewrite). */
export function sectionHeroFullImageUrl(event: Event): string | undefined {
  const image = firstTag(event, 'image')?.trim();
  if (image && DIRECT_IMAGE.test(image)) return image;
  return undefined;
}

function heroUrlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Generic asset stems — too common to use as cross-host identity. */
const GENERIC_HERO_STEM =
  /^(cover|image|img|photo|hero|thumb|avatar|logo|banner|default|untitled|header|picture|pic|media|file|asset|attachment)$/i;

/**
 * Distinctive filename stem so the same plate on two hosts still matches
 * (e.g. blog…/laeserin_logo-iPPO3wF.png ↔ git…/laeserin_logo.png).
 */
function heroBasenameFingerprint(url: string): string | null {
  try {
    const u = new URL(url);
    let path = u.pathname || '/';
    path = path.replace(/\/thumb\//gi, '/');
    const base = path.split('/').filter(Boolean).pop() || '';
    let stem = base.replace(/\.[a-z0-9]+$/i, '');
    // Vite / CDN content hashes: name-AbCdEf12 or name.a1b2c3d4
    stem = stem.replace(/-[a-zA-Z0-9_]{6,14}$/, '');
    stem = stem.replace(/\.[a-f0-9]{8,16}$/i, '');
    stem = stem.trim().toLowerCase();
    if (stem.length < 8 || GENERIC_HERO_STEM.test(stem)) return null;
    return `name:${stem}`;
  } catch {
    return null;
  }
}

/** Match keys for a cover URL, including i.nostr.build thumb ↔ full variants. */
export function heroImageMatchKeys(url: string): string[] {
  const keys = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    keys.add(heroUrlKey(t));
    const finger = heroBasenameFingerprint(t);
    if (finger) keys.add(finger);
    try {
      const u = new URL(t);
      if (u.hostname === 'i.nostr.build') {
        const p = u.pathname || '/';
        if (p.startsWith('/thumb/')) {
          u.pathname = p.slice('/thumb'.length) || '/';
          keys.add(heroUrlKey(u.toString()));
          const f2 = heroBasenameFingerprint(u.toString());
          if (f2) keys.add(f2);
        } else if (p !== '/thumb' && !p.startsWith('/thumb/')) {
          const thumb = toNostrBuildThumbUrl(t);
          keys.add(heroUrlKey(thumb));
          const f2 = heroBasenameFingerprint(thumb);
          if (f2) keys.add(f2);
        }
      }
    } catch {
      /* ignore */
    }
  };
  add(url);
  return [...keys];
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function imgSrcFromTag(tag: string): string | null {
  const m = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i) ?? tag.match(/\bsrc\s*=\s*([^\s>]+)/i);
  if (!m?.[1]) return null;
  const raw = (m[2] ?? m[1]).trim();
  if (!raw) return null;
  return decodeBasicEntities(raw);
}

function heroMatchKeySet(heroUrls: Array<string | undefined | null>): Set<string> {
  const keys = new Set<string>();
  for (const u of heroUrls) {
    if (!u?.trim()) continue;
    for (const k of heroImageMatchKeys(u)) keys.add(k);
  }
  return keys;
}

/** First ~two blank-line blocks (or 8KB) — same “early” window as body dedupe. */
function earlyContentWindow(content: string): string {
  const text = content.replace(/^\uFEFF/, '');
  const parts = text.split(/\n\s*\n/);
  if (parts.length <= 2) return text.slice(0, 8000);
  return parts.slice(0, 2).join('\n\n').slice(0, 8000);
}

/** Image URLs that appear near the start of raw markdown / HTML / AsciiDoc. */
export function extractEarlyContentImageUrls(content: string): string[] {
  if (!content?.trim()) return [];
  const window = earlyContentWindow(content);
  const found: string[] = [];
  const push = (raw: string | undefined) => {
    const t = raw?.trim();
    if (t) found.push(decodeBasicEntities(t));
  };

  for (const m of window.matchAll(/!\[[^\]]*\]\((?:<)?([^)\s>]+)(?:>)?/g)) push(m[1]);
  for (const m of window.matchAll(/<img\b[^>]*>/gi)) push(imgSrcFromTag(m[0]) ?? undefined);
  for (const m of window.matchAll(/image::([^\s\[]+)/gi)) push(m[1]);
  for (const m of window.matchAll(
    /^(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?\S*)?)\s*$/gim
  )) {
    push(m[1]);
  }
  for (const m of window.matchAll(/^(https?:\/\/(?:i\.)?nostr\.build\/\S+)\s*$/gim)) {
    push(m[1]);
  }
  return found;
}

/**
 * True when raw body content already opens with the cover/hero plate — the reader
 * should hide the decorative hero and keep the content image.
 */
export function contentHasEarlyHeroImage(
  content: string,
  heroUrls: Array<string | undefined | null>
): boolean {
  const keys = heroMatchKeySet(heroUrls);
  if (!content?.trim() || !keys.size) return false;
  for (const src of extractEarlyContentImageUrls(content)) {
    if (heroImageMatchKeys(src).some((k) => keys.has(k))) return true;
  }
  return false;
}

/**
 * Drop an early body `<img>` that duplicates the hero/cover so the page does not
 * show the same plate twice (common when long-form content repeats the `image` tag).
 * Removes the first matching image when it appears before more than one prior block.
 */
export function stripEarlyDuplicateHeroImage(
  html: string,
  heroUrls: Array<string | undefined | null>
): string {
  const keys = heroMatchKeySet(heroUrls);
  if (!html || !keys.size) return html;

  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html)) !== null) {
    const src = imgSrcFromTag(match[0]);
    if (!src) continue;
    const srcKeys = heroImageMatchKeys(src);
    if (!srcKeys.some((k) => keys.has(k))) continue;

    const before = html.slice(0, match.index);
    const blocksBefore = (before.match(/<\/(?:p|h[1-6]|blockquote|ul|ol|pre|table|div|section)>/gi) ?? [])
      .length;
    // Allow a short lede (one block) before the repeated cover; further down, keep it.
    if (blocksBefore > 1) return html;

    let start = match.index;
    let end = match.index + match[0].length;

    // Unwrap a surrounding <a>…</a> that only wraps this image.
    const openA = before.match(/<a\b[^>]*>\s*$/i);
    if (openA) {
      const after = html.slice(end);
      const closeA = after.match(/^\s*<\/a>/i);
      if (closeA) {
        start = match.index - openA[0].length;
        end = end + closeA[0].length;
      }
    }

    // Drop an otherwise-empty <p>/<figure>/<div> wrapper.
    const before2 = html.slice(0, start);
    const after2 = html.slice(end);
    const openWrap = before2.match(/<(p|figure|div)(\s[^>]*)?>\s*$/i);
    if (openWrap) {
      const closeWrap = after2.match(new RegExp(`^\\s*</${openWrap[1]}>`, 'i'));
      if (closeWrap) {
        start = start - openWrap[0].length;
        end = end + closeWrap[0].length;
      }
    }

    return `${html.slice(0, start)}${html.slice(end)}`.replace(/^\s+/, '');
  }
  return html;
}

/** Remote cover URLs that the reading header may show as a hero. */
export function eventHeroImageUrls(event: Event): string[] {
  const urls = [
    sectionHeroFullImageUrl(event),
    sectionHeroImageUrl(event),
    coverFullImageUrl(event),
    coverImageUrl(event)
  ];
  return [...new Set(urls.filter((u): u is string => Boolean(u?.trim())))];
}

/**
 * Hero for a reading-pane section. Nested indexes/sections that repeat the
 * top-level edition image are omitted — that double-hero is redundant.
 * Edition root falls back to the same cover sources as {@link coverImageUrl}
 * (image / imeta / Gutenberg) so Gutenberg plates match the info page.
 */
export function readerSectionHeroUrl(section: Event, edition: Event | null | undefined): string | undefined {
  // Bible verse sections inherit the edition plate — never repeat it per verse.
  if (isBibleSection(section)) return undefined;
  const hero = sectionHeroImageUrl(section);
  if (hero) {
    if (!edition || section.id === edition.id) return hero;
    const top = sectionHeroImageUrl(edition) ?? coverImageUrl(edition);
    if (top && heroUrlsMatch(top, hero)) return undefined;
    return hero;
  }
  // No explicit image tag — edition root still shows Gutenberg/imeta covers.
  if (edition && section.id === edition.id) return coverImageUrl(section);
  return undefined;
}

/** Full-size hero for media viewer — edition root includes Gutenberg/imeta sources. */
export function readerSectionHeroFullUrl(
  section: Event,
  edition: Event | null | undefined
): string | undefined {
  if (isBibleSection(section)) return undefined;
  const explicit = sectionHeroFullImageUrl(section);
  if (explicit) {
    if (!edition || section.id === edition.id) return explicit;
    const top = sectionHeroFullImageUrl(edition) ?? coverFullImageUrl(edition);
    if (top && heroUrlsMatch(top, explicit)) return undefined;
    return explicit;
  }
  if (edition && section.id === edition.id) return coverFullImageUrl(section);
  return undefined;
}

function heroUrlsMatch(a: string, b: string): boolean {
  const keysB = new Set(heroImageMatchKeys(b));
  return heroImageMatchKeys(a).some((k) => keysB.has(k));
}
