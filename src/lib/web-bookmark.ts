import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { parseAddress } from './library-scope';

/** Turn a NIP-B0 `d` / host-path into an absolute http(s) href. */
export function webBookmarkHrefFromD(d: string): string | null {
  const v = d.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (looksLikeHostPath(v)) return `https://${v.replace(/^\/+/, '')}`;
  return null;
}

/**
 * When a `39701:pubkey:d` coordinate (or naddr identifier) is known but the
 * event is missing, still show the link preview from the d-tag.
 */
export function webBookmarkUrlFromCoordinate(coord: string): string | null {
  const parsed = parseAddress(coord);
  if (!parsed || parsed.kind !== KIND.WEB_BOOKMARK) return null;
  return webBookmarkHrefFromD(parsed.d);
}

/**
 * NIP-B0 web bookmark target URL.
 * Prefer the `r` tag (full URL); fall back to `d` with `https://` restored when needed.
 */
export function webBookmarkUrl(event: Event): string | null {
  if (event.kind !== KIND.WEB_BOOKMARK) return null;

  const r = event.tags.find((tag) => tag[0] === 'r' && tag[1]?.trim())?.[1]?.trim();
  if (r && /^https?:\/\//i.test(r)) return r;
  if (r) {
    const fromR = webBookmarkHrefFromD(r);
    if (fromR) return fromR;
  }

  const d = event.tags.find((tag) => tag[0] === 'd' && tag[1]?.trim())?.[1]?.trim();
  return d ? webBookmarkHrefFromD(d) : null;
}

function looksLikeHostPath(value: string): boolean {
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;
  // `youtu.be/…`, `example.com/page`, `www.example.com`
  return /^[\w.-]+\.[a-z0-9.-]+(?:\/\S*)?$/i.test(v);
}
