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
    if (top && heroUrlKey(top) === heroUrlKey(hero)) return undefined;
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
    if (top && heroUrlKey(top) === heroUrlKey(explicit)) return undefined;
    return explicit;
  }
  if (edition && section.id === edition.id) return coverFullImageUrl(section);
  return undefined;
}
