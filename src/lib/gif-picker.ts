/**
 * Kind 1090 reaction-clip catalog (Find) + draft builder for Import.
 * Matches Imwald: insert URL + imeta; never re-upload Find picks.
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { cleanTrackingUrl } from './clean-url';
import { relayPool } from './nostr/pool';
import { socialStack } from './nostr/selector';
import { withClientTag } from './sign';

export const GIF_RELAY_URLS = [
  'wss://thecitadel.nostr1.com',
  'wss://primus.nostr1.com',
  'wss://nos.lol'
] as const;

export const GIF_TOPIC_TAG = 'gif';
export const REACTION_CLIP_EMOTION_NAMESPACE = 'emotion';
export const REACTION_CLIP_MAX_EMOTIONS = 6;
export const REACTION_CLIP_DEFAULT_EMOTION = 'joy';

export const REACTION_CLIP_EMOTIONS = [
  'joy',
  'laughter',
  'love',
  'sadness',
  'anger',
  'disbelief',
  'fear',
  'surprise',
  'awkward',
  'celebration',
  'approval',
  'disapproval'
] as const;

export type ReactionClipEmotion = (typeof REACTION_CLIP_EMOTIONS)[number];

const EMOTION_SET = new Set<string>(REACTION_CLIP_EMOTIONS);
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type GifPickerItem = {
  url: string;
  description?: string;
  sha256?: string;
  mimeType?: string;
  dim?: string;
  size?: number;
  sourceKind: number;
  eventId: string;
  pubkey: string;
  createdAt: number;
};

function imetaField(parts: string[], name: string): string {
  const prefix = `${name} `;
  const inline = parts.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  return '';
}

function normalizeUrl(raw: string): string {
  const cleaned = cleanTrackingUrl(raw.trim()) || raw.trim();
  return cleaned.replace(/\/+$/, '');
}

export function normalizeReactionEmotions(
  raw: readonly string[],
  description = ''
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const e = item.trim().toLowerCase();
    if (!e || seen.has(e) || !EMOTION_SET.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= REACTION_CLIP_MAX_EMOTIONS) return out;
  }
  if (out.length) return out;
  for (const token of description.split(/[\s,]+/)) {
    const e = token.replace(/^#/, '').trim().toLowerCase();
    if (!e || seen.has(e) || !EMOTION_SET.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= REACTION_CLIP_MAX_EMOTIONS) break;
  }
  return out.length ? out : [REACTION_CLIP_DEFAULT_EMOTION];
}

export function gifItemFromEvent(event: Event): GifPickerItem | null {
  if (event.kind !== KIND.REACTION_CLIP) return null;
  let url = '';
  let mime = '';
  let sha = '';
  let dim = '';
  let size: number | undefined;
  let alt = '';
  for (const tag of event.tags) {
    if (tag[0] === 'imeta') {
      const parts = tag.slice(1);
      url = imetaField(parts, 'url') || url;
      mime = imetaField(parts, 'm') || mime;
      sha = imetaField(parts, 'x') || sha;
      dim = imetaField(parts, 'dim') || dim;
      const sizeRaw = imetaField(parts, 'size');
      if (sizeRaw) {
        const n = Number(sizeRaw);
        if (Number.isFinite(n) && n > 0) size = n;
      }
      alt = imetaField(parts, 'alt') || alt;
    } else if (tag[0] === 'url' && tag[1]?.trim()) {
      url = url || tag[1].trim();
    } else if (tag[0] === 'x' && tag[1]?.trim()) {
      sha = sha || tag[1].trim().toLowerCase();
    } else if (tag[0] === 'alt' && tag[1]?.trim()) {
      alt = alt || tag[1].trim();
    }
  }
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return {
    url: cleanTrackingUrl(url) || url,
    description: alt || undefined,
    sha256: SHA256_HEX.test(sha.toLowerCase()) ? sha.toLowerCase() : undefined,
    mimeType: mime || 'image/gif',
    dim: dim || undefined,
    size,
    sourceKind: event.kind,
    eventId: event.id,
    pubkey: event.pubkey.toLowerCase(),
    createdAt: event.created_at
  };
}

/** Deduplicate by normalized URL, then by sha256. Prefer newer created_at. */
export function dedupeGifItems(items: readonly GifPickerItem[]): GifPickerItem[] {
  const byUrl = new Map<string, GifPickerItem>();
  const byHash = new Map<string, GifPickerItem>();
  for (const item of items) {
    const urlKey = normalizeUrl(item.url).toLowerCase();
    const prevUrl = byUrl.get(urlKey);
    if (!prevUrl || item.createdAt > prevUrl.createdAt) byUrl.set(urlKey, item);
    if (item.sha256) {
      const prevHash = byHash.get(item.sha256);
      if (!prevHash || item.createdAt > prevHash.createdAt) byHash.set(item.sha256, item);
    }
  }
  const out: GifPickerItem[] = [];
  const seen = new Set<string>();
  for (const item of byUrl.values()) {
    const key = item.sha256 ? `x:${item.sha256}` : `u:${normalizeUrl(item.url).toLowerCase()}`;
    if (seen.has(key)) continue;
    // Prefer hash-winner when URL and hash collide on different rows.
    const preferred = item.sha256 ? (byHash.get(item.sha256) ?? item) : item;
    const prefKey = preferred.sha256
      ? `x:${preferred.sha256}`
      : `u:${normalizeUrl(preferred.url).toLowerCase()}`;
    if (seen.has(prefKey)) continue;
    seen.add(prefKey);
    out.push(preferred);
  }
  return out;
}

export function sortGifItemsForPicker(
  items: readonly GifPickerItem[],
  viewerPubkey?: string | null
): GifPickerItem[] {
  const viewer = viewerPubkey?.trim().toLowerCase() ?? '';
  return [...items].sort((a, b) => {
    if (viewer) {
      const aOwn = a.pubkey === viewer ? 0 : 1;
      const bOwn = b.pubkey === viewer ? 0 : 1;
      if (aOwn !== bOwn) return aOwn - bOwn;
    }
    return b.createdAt - a.createdAt;
  });
}

export function imetaFromGifItem(item: GifPickerItem): string[] {
  const url = cleanTrackingUrl(item.url) || item.url.trim();
  const parts = ['imeta', `url ${url}`];
  const mime = (item.mimeType ?? 'image/gif').trim();
  if (mime) parts.push(`m ${mime}`);
  if (item.sha256 && SHA256_HEX.test(item.sha256)) parts.push(`x ${item.sha256}`);
  if (item.dim?.trim()) parts.push(`dim ${item.dim.trim()}`);
  if (item.size != null && item.size > 0) parts.push(`size ${item.size}`);
  if (item.description?.trim()) parts.push(`alt ${item.description.trim()}`);
  return parts;
}

export function buildReactionClipDraft(opts: {
  url: string;
  sha256: string;
  description?: string;
  mimeType?: string;
  dim?: string;
  size?: number;
  emotions?: string[];
}): { kind: number; content: string; tags: string[][] } | null {
  const clipUrl = cleanTrackingUrl(opts.url.trim()) || opts.url.trim();
  if (!/^https?:\/\//i.test(clipUrl)) return null;
  const hash = opts.sha256.trim().toLowerCase();
  if (!SHA256_HEX.test(hash)) return null;
  const desc = (opts.description ?? '').trim();
  const emotions = normalizeReactionEmotions(opts.emotions ?? [], desc);
  const mime = (opts.mimeType ?? 'image/gif').trim() || 'image/gif';

  const imeta = ['imeta', `url ${clipUrl}`, `m ${mime}`, `x ${hash}`];
  if (opts.dim?.trim()) imeta.push(`dim ${opts.dim.trim()}`);
  if (opts.size != null && opts.size > 0) imeta.push(`size ${opts.size}`);
  if (desc) imeta.push(`alt ${desc}`);

  const tags: string[][] = [
    ['url', clipUrl],
    imeta,
    ['x', hash],
    ['L', REACTION_CLIP_EMOTION_NAMESPACE]
  ];
  for (const emotion of emotions) {
    tags.push(['l', emotion, REACTION_CLIP_EMOTION_NAMESPACE]);
  }
  tags.push(['alt', desc ? `Reaction clip: ${desc}` : 'Reaction clip']);
  tags.push(['t', GIF_TOPIC_TAG]);
  const seenTopics = new Set<string>([GIF_TOPIC_TAG]);
  if (desc) {
    for (const raw of desc.split(/[\s,]+/)) {
      const token = raw.replace(/^#/, '').trim().toLowerCase();
      if (token.length < 2 || seenTopics.has(token)) continue;
      seenTopics.add(token);
      tags.push(['t', token]);
    }
  }

  return {
    kind: KIND.REACTION_CLIP,
    content: '',
    tags: withClientTag(tags)
  };
}

function pickerRelays(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...GIF_RELAY_URLS, ...socialStack().slice(0, 4)]) {
    const key = url.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url.trim());
    if (out.length >= 8) break;
  }
  return out;
}

export async function loadReactionClips(opts: {
  viewerPubkey?: string | null;
  followPubkeys?: readonly string[];
}): Promise<GifPickerItem[]> {
  const viewer = opts.viewerPubkey?.trim().toLowerCase() ?? '';
  const relays = pickerRelays();
  if (!relays.length) return [];

  const filters: Array<Record<string, unknown>> = [
    { kinds: [KIND.REACTION_CLIP], limit: 200 }
  ];
  if (viewer) {
    filters.push({ kinds: [KIND.REACTION_CLIP], authors: [viewer], limit: 120 });
    const follows = (opts.followPubkeys ?? [])
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p && p !== viewer)
      .slice(0, 40);
    if (follows.length) {
      filters.push({ kinds: [KIND.REACTION_CLIP], authors: follows, limit: 120 });
    }
  }

  const hits = await relayPool
    .query(relays, filters, 10_000, 6)
    .catch(() => [] as Event[]);
  const items: GifPickerItem[] = [];
  for (const ev of hits) {
    const item = gifItemFromEvent(ev);
    if (item) items.push(item);
  }
  return sortGifItemsForPicker(dedupeGifItems(items), viewer);
}
