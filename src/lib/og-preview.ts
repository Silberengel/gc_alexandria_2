import { OG_PREVIEW_URL } from './constants';
import { isAllowedHref } from './markup';
import { isImageUrl } from './media';
import { urlEmbedsNostrEvent } from './nostr-entity';
import { parseYouTubeUrl } from './youtube';

export type OgPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
};

const MEDIA_FILE =
  /\.(?:png|jpe?g|gif|webp|avif|svg|mp4|webm|ogv|mov|m4v|mp3|ogg|wav|m4a|aac)(?:\?|#|$)/i;

const cache = new Map<string, OgPreview | null>();
const inflight = new Map<string, Promise<OgPreview | null>>();

/** After proxy/TLS hang-ups, skip the sidecar briefly so Vite is not spammed. */
const COOLDOWN_MS = 60_000;
let unavailableUntil = 0;

function ogPreviewSkipped(): boolean {
  return Date.now() < unavailableUntil;
}

function markOgPreviewDown(): void {
  unavailableUntil = Date.now() + COOLDOWN_MS;
}

/** Strip trailing punctuation often glued onto pasted links. */
export function tidyLinkUrl(raw: string): string {
  return raw.trim().replace(/[),.;:!?'"\]]+$/g, '');
}

/**
 * Whether a bare URL should be lifted into an Open Graph card
 * (not YouTube, not direct media).
 */
export function shouldOgPreview(raw: string): boolean {
  const url = tidyLinkUrl(raw);
  if (!url || !isAllowedHref(url)) return false;
  try {
    const parsed = new URL(url);
    // unfold SafeHttpUrl only allows https fetch targets
    if (parsed.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  if (parseYouTubeUrl(url)) return false;
  if (urlEmbedsNostrEvent(url)) return false;
  if (isImageUrl(url)) return false;
  if (MEDIA_FILE.test(url)) return false;
  return true;
}

export function parseOgPreviewHtml(html: string, fallbackUrl: string): OgPreview | null {
  const trimmed = html.trim();
  if (!trimmed) return null;
  if (typeof DOMParser === 'undefined') {
    return parseOgPreviewHtmlRegex(trimmed, fallbackUrl);
  }
  const doc = new DOMParser().parseFromString(trimmed, 'text/html');
  const card = doc.querySelector('.og-preview-card');
  if (!card) return null;
  const title = textOrUndef(card.querySelector('.og-preview-title')?.textContent);
  const description = textOrUndef(card.querySelector('.og-preview-description')?.textContent);
  const image =
    card.querySelector('.og-preview-image img')?.getAttribute('src')?.trim() || undefined;
  const href =
    card.querySelector('.og-preview-title a, .og-preview-image a')?.getAttribute('href')?.trim() ||
    fallbackUrl;
  if (!title && !description && !image) return null;
  return { url: href || fallbackUrl, title, description, image };
}

/** Regex fallback for non-DOM environments (unit tests). */
export function parseOgPreviewHtmlRegex(html: string, fallbackUrl: string): OgPreview | null {
  if (!/\bog-preview-card\b/i.test(html)) return null;
  const title = matchGroup(html, /og-preview-title[\s\S]*?<b>([\s\S]*?)<\/b>/i);
  const description = matchGroup(html, /og-preview-description[^>]*>([\s\S]*?)<\/div>/i);
  const image = matchGroup(html, /og-preview-image[\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
  const href =
    matchGroup(html, /og-preview-title[\s\S]*?<a[^>]+href=["']([^"']+)["']/i) || fallbackUrl;
  const decoded = {
    url: href,
    title: title ? decodeBasicEntities(title) : undefined,
    description: description ? decodeBasicEntities(description) : undefined,
    image: image || undefined
  };
  if (!decoded.title && !decoded.description && !decoded.image) return null;
  return decoded;
}

function textOrUndef(s: string | null | undefined): string | undefined {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t || undefined;
}

function matchGroup(html: string, re: RegExp): string | undefined {
  const m = re.exec(html);
  const g = m?.[1]?.trim();
  return g || undefined;
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * POST `{url}` to the OG preview sidecar (same contract as unfold `/og-preview/`).
 * Returns null on 204 / errors / empty metadata.
 */
export async function fetchOgPreview(
  rawUrl: string,
  opts?: { signal?: AbortSignal }
): Promise<OgPreview | null> {
  const url = tidyLinkUrl(rawUrl);
  if (!shouldOgPreview(url)) return null;
  if (cache.has(url)) return cache.get(url) ?? null;
  const existing = inflight.get(url);
  if (existing) return existing;

  if (ogPreviewSkipped()) return null;

  const job = (async () => {
    try {
      const res = await fetch(OG_PREVIEW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/html' },
        body: JSON.stringify({ url }),
        signal: opts?.signal
      });
      if (res.status === 204) {
        cache.set(url, null);
        return null;
      }
      // 5xx from the Vite proxy (socket hang up / ENOTFOUND) — cool down the sidecar.
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        markOgPreviewDown();
        return null;
      }
      if (!res.ok) {
        cache.set(url, null);
        return null;
      }
      const html = await res.text();
      const parsed = parseOgPreviewHtml(html, url);
      cache.set(url, parsed);
      return parsed;
    } catch {
      // Don't cache aborts / network blips as permanent misses.
      if (opts?.signal?.aborted) return null;
      markOgPreviewDown();
      return null;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, job);
  return job;
}

/** Display hostname for fallback link cards. */
export function ogHostname(url: string): string {
  try {
    return new URL(tidyLinkUrl(url)).hostname.replace(/^www\./i, '');
  } catch {
    return tidyLinkUrl(url);
  }
}
