import type { Event } from 'nostr-tools';
import { KIND } from './constants';

/**
 * NIP-B0 web bookmark target URL.
 * Prefer the `r` tag (full URL); fall back to `d` with `https://` restored when needed.
 */
export function webBookmarkUrl(event: Event): string | null {
  if (event.kind !== KIND.WEB_BOOKMARK) return null;

  const r = event.tags.find((tag) => tag[0] === 'r' && tag[1]?.trim())?.[1]?.trim();
  if (r && /^https?:\/\//i.test(r)) return r;

  const d = event.tags.find((tag) => tag[0] === 'd' && tag[1]?.trim())?.[1]?.trim();
  if (!d) return r && looksLikeHostPath(r) ? `https://${r.replace(/^\/+/, '')}` : null;
  if (/^https?:\/\//i.test(d)) return d;
  if (looksLikeHostPath(d)) return `https://${d.replace(/^\/+/, '')}`;
  return null;
}

function looksLikeHostPath(value: string): boolean {
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;
  // `youtu.be/…`, `example.com/page`, `www.example.com`
  return /^[\w.-]+\.[a-z0-9.-]+(?:\/\S*)?$/i.test(v);
}
