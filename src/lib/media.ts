import type { Event } from 'nostr-tools';

export type MediaItem = {
  type: 'image' | 'video' | 'audio';
  url: string;
  alt?: string;
  poster?: string;
  width?: number;
  height?: number;
};

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?|#|$)/i;
const VIDEO_EXT = /\.(?:mp4|webm|ogv|mov)(?:\?|#|$)/i;
const AUDIO_EXT = /\.(?:mp3|ogg|wav|m4a|aac)(?:\?|#|$)/i;

/** Bare http(s) URL that looks like a raster/vector image (path or query). */
export const BARE_IMAGE_URL_RE =
  /https?:\/\/[^\s<>"'\)\]]+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^\s<>"'\)\]]*)?/gi;

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function classify(url: string, hint?: string): MediaItem['type'] | null {
  if (hint === 'image' || IMAGE_EXT.test(url) || /image\//i.test(hint ?? '')) return 'image';
  if (hint === 'video' || VIDEO_EXT.test(url) || /video\//i.test(hint ?? '')) return 'video';
  if (hint === 'audio' || AUDIO_EXT.test(url) || /audio\//i.test(hint ?? '')) return 'audio';
  return null;
}

export function isImageUrl(url: string): boolean {
  return classify(url.trim()) === 'image' && isHttpUrl(url);
}

const SHA256_RE = /(?:^|[^a-f0-9])([a-f0-9]{64})(?![a-f0-9])/i;
const MEDIA_FILE_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|mp4|webm|ogv|mov|m4v|mp3|ogg|wav|m4a|aac)$/i;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'");
}

/**
 * Identity keys for one file. Query strings on a real file are ignored so
 * `pic.jpg` and `pic.jpg?w=800` match, and a blossom sha256 matches with or
 * without an extension. Two different `?id=` URLs on a non-file path do not.
 */
export function mediaMatchKeys(url: string): string[] {
  const keys = new Set<string>();
  let text = decodeEntities(url.trim());
  if (!text) return [];
  try {
    text = decodeURI(text);
  } catch {
    /* keep the raw string */
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return [];
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];
  const host = parsed.hostname.replace(/\.$/, '').toLowerCase();
  let path = parsed.pathname.replace(/\/+$/, '') || '/';
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the encoded path */
  }
  const paths = [path];
  if (host === 'i.nostr.build' && path.startsWith('/thumb/')) {
    paths.push(path.slice('/thumb'.length) || '/');
  }
  for (const item of paths) {
    const hash = SHA256_RE.exec(item)?.[1]?.toLowerCase();
    const fileLike = MEDIA_FILE_EXT.test(item) || Boolean(hash);
    keys.add(`${host}${item}${parsed.search}`);
    if (fileLike) keys.add(`${host}${item}`);
    if (hash) keys.add(`sha256:${hash}`);
  }
  return [...keys];
}

/** True when both URLs point at the same file, including size and thumb variants. */
export function sameMedia(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const keys = new Set(mediaMatchKeys(a));
  if (!keys.size) return false;
  return mediaMatchKeys(b).some((key) => keys.has(key));
}

function prefersDisplayUrl(current: string, next: string): boolean {
  return /\/thumb\//i.test(current) && !/\/thumb\//i.test(next);
}

function pushUnique(out: MediaItem[], url: string, type: MediaItem['type']): void {
  if (!isHttpUrl(url)) return;
  const existing = out.find((item) => sameMedia(item.url, url));
  if (existing) {
    if (prefersDisplayUrl(existing.url, url)) existing.url = url;
    return;
  }
  out.push({ type, url });
}

function imetaField(parts: string[], name: string): string {
  const prefix = `${name} `;
  const inline = parts.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const idx = parts.indexOf(name);
  const next = idx >= 0 ? parts[idx + 1]?.trim() : '';
  return next && !/^(?:url|m|dim|alt|image|fallback|blurhash|thumbhash|x|size|ox)\b/i.test(next)
    ? next
    : '';
}

/** NIP-92 `imeta`: `url`, `m`, `dim`, `alt`, and an optional poster `image`. */
function parseImeta(tag: string[]): MediaItem | null {
  const parts = tag.slice(1);
  let url = imetaField(parts, 'url');
  if (!url) url = parts.find((item) => /^https?:\/\//i.test(item)) ?? '';
  if (!url || !isHttpUrl(url)) return null;
  const mime = imetaField(parts, 'm');
  const type = classify(url, mime) ?? (mime ? null : 'image');
  if (!type) return null;
  const dim = imetaField(parts, 'dim').match(/^(\d+)x(\d+)$/);
  const poster = imetaField(parts, 'image');
  return {
    type,
    url,
    alt: imetaField(parts, 'alt'),
    poster: poster && isHttpUrl(poster) ? poster : undefined,
    width: dim ? Number(dim[1]) : undefined,
    height: dim ? Number(dim[2]) : undefined
  };
}

export function imetaMedia(event: Event): MediaItem[] {
  const out: MediaItem[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue;
    const item = parseImeta(tag);
    if (!item) continue;
    pushUnique(out, item.url, item.type);
    const stored = out.find((row) => sameMedia(row.url, item.url));
    if (!stored) continue;
    if (item.alt) stored.alt = item.alt;
    if (item.poster) stored.poster = item.poster;
    if (item.width) stored.width = item.width;
    if (item.height) stored.height = item.height;
  }
  return out;
}

export function uniqueMedia(event: Event): MediaItem[] {
  const out: MediaItem[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'imeta') {
      const meta = parseImeta(tag);
      if (!meta) continue;
      pushUnique(out, meta.url, meta.type);
    }
    if ((tag[0] === 'image' || tag[0] === 'img') && tag[1]) {
      pushUnique(out, tag[1], 'image');
    }
    if (tag[0] === 'url' && tag[1]) {
      const type = classify(tag[1]) ?? (event.kind === 21 ? 'video' : event.kind === 20 ? 'image' : null);
      if (type) pushUnique(out, tag[1], type);
    }
    if (tag[0] === 'thumb' && tag[1]) {
      pushUnique(out, tag[1], 'image');
    }
  }
  const contentUrls = event.content.match(URL_RE) ?? [];
  for (const url of contentUrls) {
    const type = classify(url);
    if (type) pushUnique(out, url, type);
  }
  return out;
}

const CONTENT_URL_RE = /https?:\/\/[^\s<>"']+/gi;

function contentUrlVariants(raw: string): string[] {
  const trimmed = decodeEntities(raw.trim());
  const peeled = trimmed.replace(/[.,;:!?)\]]+$/u, '');
  return peeled && peeled !== trimmed ? [trimmed, peeled] : [trimmed];
}

function matchesMedia(url: string, keys: Set<string>): boolean {
  return mediaMatchKeys(url).some((key) => keys.has(key));
}

function mediaKeySet(urls: Array<string | undefined>): Set<string> {
  const keys = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    for (const key of mediaMatchKeys(url)) keys.add(key);
  }
  return keys;
}

/** Remove file URLs from note text without flattening paragraph breaks. */
export function omitMediaUrls(content: string, media: MediaItem[]): string {
  const keys = mediaKeySet(media.flatMap((item) => [item.url, item.poster]));
  if (!content || !keys.size) return content.replace(/[ \t]{2,}/g, ' ').trim();
  let out = content.replace(CONTENT_URL_RE, (raw) =>
    contentUrlVariants(raw).some((url) => matchesMedia(url, keys)) ? '' : raw
  );
  out = out
    .replace(/!\[[^\]]*\]\(\s*(?:["'][^"']*["'])?\s*\)/g, '')
    .replace(/image::\s*\[\s*\]/gi, '')
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']\s*["'][^>]*>/gi, '');
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function contentWithoutMediaUrls(content: string, media: MediaItem[]): string {
  return omitMediaUrls(content, media).replace(/\s+/g, ' ').trim();
}

function tagAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  const raw = match?.[2]?.trim();
  if (!raw) return null;
  return decodeEntities(raw);
}

function anchorTextIsMediaUrl(text: string, href: string): boolean {
  const compact = decodeEntities(text).replace(/\s+/g, '');
  if (!compact) return false;
  if (contentUrlVariants(compact).some((url) => sameMedia(url, href))) return true;
  const cropped = compact.split('...');
  if (cropped.length === 2) {
    const [head, tail] = cropped;
    if (head && tail && href.startsWith(head) && href.endsWith(tail)) return true;
  }
  return false;
}

/**
 * Drop rendered pictures, players, and bare media links that repeat a file
 * already shown from `imeta` (or another tag).
 */
export function stripRenderedMedia(html: string, urls: Array<string | undefined>): string {
  const keys = mediaKeySet(urls);
  if (!html || !keys.size) return html;
  const srcMatches = (tag: string) => {
    const src = tagAttr(tag, 'src');
    if (src && matchesMedia(src, keys)) return true;
    return [...tag.matchAll(/<source\b[^>]*>/gi)].some((part) => {
      const source = tagAttr(part[0], 'src');
      return Boolean(source && matchesMedia(source, keys));
    });
  };
  let out = html.replace(/<img\b[^>]*>/gi, (tag) => (srcMatches(tag) ? '' : tag));
  out = out.replace(/<(video|audio)\b[\s\S]*?<\/\1>/gi, (tag) => (srcMatches(tag) ? '' : tag));
  out = out.replace(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>[\s\S]*?<\/a>/gi, (full, _q: string, href: string) => {
    const target = decodeEntities(href);
    if (!matchesMedia(target, keys)) return full;
    const text = full.replace(/<[^>]+>/g, '');
    return anchorTextIsMediaUrl(text, target) ? '' : full;
  });
  return out.replace(/<(p|div|figure)>\s*<\/\1>/gi, '').trim();
}

/** Keep the first URL of each file. */
export function dedupeMediaUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const url of urls) {
    if (!url || out.some((have) => sameMedia(have, url))) continue;
    out.push(url);
  }
  return out;
}

export function posterUrl(event: Event): string | undefined {
  return event.tags.find((t) => t[0] === 'thumb' || t[0] === 'image')?.[1];
}

/**
 * Turn bare image URLs into format-native image markup so readers/cards show them inline
 * instead of linkified text (e.g. a lone tenor.gif / nostr.build URL in a section body).
 */
export function rewriteBareImageUrls(
  src: string,
  format: 'asciidoc' | 'djot' | 'plaintext'
): string {
  if (!src) return src;
  return src.replace(BARE_IMAGE_URL_RE, (url, offset: number) => {
    if (!isImageUrl(url)) return url;
    const before = src.slice(Math.max(0, offset - 16), offset);
    // Skip URLs already used as markdown/djot/asciidoc image or link targets.
    if (/(?:!\[|\]\(|image::?|src=["']|href=["']|link:)$/i.test(before)) return url;
    if (/\[[^\]]*$/.test(before) && !before.includes('](')) return url;
    if (format === 'asciidoc') return `\nimage::${url}[]\n`;
    return `![](${url})`;
  });
}

/** After linkify, turn identical-text image anchors into <img>. */
export function promoteImageAutolinks(html: string): string {
  return html.replace(
    /<a\s+([^>]*?)href=(["'])(https?:\/\/[^"']+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^"']*)?)\2([^>]*)>\s*\3\s*<\/a>/gi,
    (_full, pre: string, _q: string, url: string, post: string) => {
      if (!isHttpUrl(url)) return _full;
      void pre;
      void post;
      return `<img src="${url}" alt="" loading="lazy" />`;
    }
  );
}
