import type { Event } from 'nostr-tools';

export type MediaItem = { type: 'image' | 'video' | 'audio'; url: string };

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

function pushUnique(out: MediaItem[], url: string, type: MediaItem['type']): void {
  if (!isHttpUrl(url)) return;
  if (out.some((item) => item.url === url)) return;
  out.push({ type, url });
}

function imetaUrl(tag: string[]): { url: string; mime?: string } | null {
  const joined = tag.slice(1);
  const urlField = joined.find((item) => item.startsWith('url '));
  const mimeField = joined.find((item) => item.startsWith('m '));
  let url = urlField ? urlField.slice(4).trim() : '';
  if (!url) {
    const urlIdx = joined.indexOf('url');
    if (urlIdx >= 0 && joined[urlIdx + 1]) url = joined[urlIdx + 1]!;
  }
  if (!url) url = joined.find((item) => /^https?:\/\//i.test(item)) ?? '';
  if (!url) return null;
  return { url, mime: mimeField ? mimeField.slice(2).trim() : undefined };
}

export function uniqueMedia(event: Event): MediaItem[] {
  const out: MediaItem[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'imeta') {
      const meta = imetaUrl(tag);
      if (!meta) continue;
      const type = classify(meta.url, meta.mime) ?? 'image';
      pushUnique(out, meta.url, type);
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

export function contentWithoutMediaUrls(content: string, media: MediaItem[]): string {
  let out = content;
  for (const item of media) {
    out = out.split(item.url).join('');
  }
  return out.replace(/\s+/g, ' ').trim();
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
  format: 'asciidoc' | 'djot' | 'markdown'
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
