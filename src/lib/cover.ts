import type { Event } from 'nostr-tools';
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

/** Cover from `image`, then `imeta`, then Gutenberg id on s / i / d. */
export function coverImageUrl(event: Event): string | undefined {
  const image = firstTag(event, 'image')?.trim();
  if (image && DIRECT_IMAGE.test(image)) {
    const id = gutenbergIdFromText(image);
    return toNostrBuildThumbUrl(id ? gutenbergCoverUrl(id) : image);
  }

  const imeta = imetaImageUrl(event);
  if (imeta) return toNostrBuildThumbUrl(imeta);

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
