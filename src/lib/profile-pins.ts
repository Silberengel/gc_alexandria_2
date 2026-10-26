/**
 * NIP-51 kind 10001 pin list → profile pinboard slips (pins + latest OPs).
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { coverFullImageUrl, coverImageUrl, firstContentImageUrl } from './cover';
import { ensureMetadata } from './ensure-metadata';
import { isFeedRepost, isOriginalPost } from './feed';
import { cropText } from './listing-table';
import { omitMediaUrls, uniqueMedia } from './media';
import { isAllowedMediaUrl } from './markup';
import { decodeNostrBech32, type RefSegment } from './nostr-refs';
import { memoryGetEvent, rememberEvents } from './nostr/event-memory';
import { fetchByAddress, fetchById, fetchByIds } from './nostr/fetch';
import { firstTag } from './nostr/verify';
import { pickLatestReplaceable } from './nostr/replaceable';
import { eventPreview } from './event-preview';
import { fetchOgPreview, shouldOgPreview, tidyLinkUrl } from './og-preview';
import { peekProfileThumb, profileThumbFromKind0 } from './profile-cache';
import { webBookmarkUrl } from './web-bookmark';
import { parseYouTubeUrl } from './youtube';

const HEX_ID = /^[0-9a-f]{64}$/i;
const CONTENT_HTTP_URL = /https?:\/\/[^\s<>"')\]]+/gi;
const NOSTR_BECH32 = /(?:nostr:)?((?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+)/gi;

/** Max note slips on the profile pinboard. */
export const PROFILE_PINBOARD_LIMIT = 5;

/** Kinds queried when filling the board with original posts. */
export const PROFILE_PINBOARD_OP_KINDS = [
  KIND.TEXT_NOTE,
  KIND.DJOT,
  KIND.PICTURE,
  KIND.VIDEO,
  KIND.SHORT_VIDEO,
  KIND.VOICE,
  KIND.LONG_FORM,
  KIND.WEB_BOOKMARK
] as const;

/** Ordered unique `#e` ids from a pin list (kind 10001). */
export function pinEventIds(pinList: Event | null | undefined): string[] {
  if (!pinList || pinList.kind !== KIND.PIN) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of pinList.tags) {
    if (tag[0] !== 'e') continue;
    const id = (tag[1] ?? '').trim().toLowerCase();
    if (!HEX_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Latest kind-10001 for `pubkey` from a batch of replaceable candidates. */
export function pickPinList(events: Event[], pubkey: string): Event | null {
  return pickLatestReplaceable(events, KIND.PIN, pubkey);
}

/**
 * Resolve pin `#e` ids via event-memory, then `fetchByIds` for misses.
 * Preserves pin-list order; drops unresolved ids.
 */
export async function resolvePinnedNotes(
  pinList: Event | null | undefined,
  opts?: { limit?: number; fetchIds?: (ids: string[]) => Promise<Event[]> }
): Promise<Event[]> {
  const ids = pinEventIds(pinList).slice(0, opts?.limit ?? 24);
  if (!ids.length) return [];

  const byId = new Map<string, Event>();
  const missing: string[] = [];
  for (const id of ids) {
    const warm = memoryGetEvent(id);
    if (warm) byId.set(id, warm);
    else missing.push(id);
  }

  if (missing.length) {
    const fetchIds = opts?.fetchIds ?? ((need: string[]) => fetchByIds(need));
    const found = await fetchIds(missing);
    rememberEvents(found);
    for (const event of found) {
      if (event?.id) byId.set(event.id.toLowerCase(), event);
    }
  }

  return ids.map((id) => byId.get(id)).filter((e): e is Event => !!e);
}

/** True when both lists have the same event ids in the same order. */
export function samePinnedNoteIds(a: Event[], b: Event[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((event, i) => event.id.toLowerCase() === (b[i]?.id ?? '').toLowerCase());
}

export type ProfilePinboard = {
  slips: Event[];
  /** True when at least one slip came from the pin list (heading = Pinned). */
  hasPins: boolean;
};

/** Newest original posts for the pinboard fill (excludes boosts). */
export function pickOriginalPostsForPinboard(events: Event[], limit = PROFILE_PINBOARD_LIMIT): Event[] {
  return [...events]
    .filter((e) => e?.id && isOriginalPost(e) && !isFeedRepost(e))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, Math.max(0, limit));
}

/**
 * Pins first (list order), then newest OPs not already included, up to `limit`.
 * Empty when both sources are empty.
 */
export function composeProfilePinboardSlips(
  pins: Event[],
  originals: Event[],
  limit = PROFILE_PINBOARD_LIMIT
): ProfilePinboard {
  const cap = Math.max(0, limit);
  const slips: Event[] = [];
  const seen = new Set<string>();
  let hasPins = false;

  for (const event of pins) {
    if (slips.length >= cap) break;
    const id = event?.id?.toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    slips.push(event);
    hasPins = true;
  }

  const ops = pickOriginalPostsForPinboard(originals, cap);
  for (const event of ops) {
    if (slips.length >= cap) break;
    const id = event.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    slips.push(event);
  }

  return { slips, hasPins };
}

/** Short text for a pinboard slip face (media URLs and nostr: refs stripped). */
export function pinboardSlipPreview(event: Event, maxChars = 160): string {
  const media = uniqueMedia(event);
  const body = omitMediaUrls(event.content ?? '', media)
    .replace(NOSTR_BECH32, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (body) return cropText(body, maxChars);
  // Web bookmarks and other tagged posts often have empty content.
  const title = firstTag(event, 'title')?.trim();
  if (title) return cropText(title, maxChars);
  return '';
}

/** First note / nevent / naddr reference embedded in the note content. */
export function pinboardFirstEventRef(event: Event): RefSegment | null {
  for (const token of contentNostrTokens(event.content)) {
    const ref = decodeNostrBech32(token);
    if (!ref) continue;
    if (ref.kind === 'note' || ref.kind === 'nevent' || ref.kind === 'naddr') return ref;
  }
  return null;
}

async function fetchPinboardRef(
  ref: RefSegment,
  opts?: { signal?: AbortSignal }
): Promise<Event | null> {
  if (opts?.signal?.aborted) return null;
  if ((ref.kind === 'note' || ref.kind === 'nevent') && ref.id) {
    return (
      memoryGetEvent(ref.id) ??
      (await fetchById(ref.id, {
        hintRelays: ref.relays,
        authorPubkey: ref.pubkey
      }))
    );
  }
  if (ref.kind === 'naddr' && ref.naddr) {
    const coord = `${ref.naddr.kind}:${ref.naddr.pubkey}:${ref.naddr.identifier}`;
    return fetchByAddress(coord, { hintRelays: ref.naddr.relays });
  }
  return null;
}

/** Plain excerpt from a resolved event (prefers body text, then card preview fields). */
export function pinboardEventExcerpt(event: Event, maxChars = 160): string {
  const plain = pinboardSlipPreview(event, maxChars);
  if (plain) return plain;
  const preview = eventPreview(event);
  const fallback = [preview.body, preview.summary, preview.headline].find(
    (s) => s && !/^KIND:/u.test(s)
  );
  return fallback ? cropText(fallback, maxChars) : '';
}

/**
 * Resolve the first embedded note/nevent/naddr and return a slip-ready excerpt
 * (and remember the event for face-image lookups).
 */
export async function pinboardResolveEmbeddedExcerpt(
  event: Event,
  opts?: { signal?: AbortSignal; maxChars?: number }
): Promise<string> {
  const ref = pinboardFirstEventRef(event);
  if (!ref) return '';
  const hit = await fetchPinboardRef(ref, opts);
  if (!hit || opts?.signal?.aborted) return '';
  rememberEvents([hit]);
  return pinboardEventExcerpt(hit, opts?.maxChars ?? 160);
}

/** First allowed image URL on the event, if any. */
export function pinboardSlipImage(event: Event): string | null {
  for (const item of uniqueMedia(event)) {
    if (item.type !== 'image') continue;
    if (!isAllowedMediaUrl(item.url)) continue;
    return item.url;
  }
  return null;
}

/** YouTube hqdefault still for a watch URL. */
export function youtubeStillUrl(raw: string): string | null {
  const ref = parseYouTubeUrl(raw);
  if (!ref) return null;
  return `https://i.ytimg.com/vi/${ref.videoId}/hqdefault.jpg`;
}

function contentHttpUrls(content: string | undefined): string[] {
  return (content?.match(CONTENT_HTTP_URL) ?? []).map(tidyLinkUrl);
}

function contentNostrTokens(content: string | undefined): string[] {
  if (!content) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(NOSTR_BECH32)) {
    const token = (m[1] ?? '').toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function acceptImageUrl(url: string | null | undefined): string | null {
  const u = (url ?? '').trim();
  if (!u || !isAllowedMediaUrl(u)) return null;
  return u;
}

/**
 * Immediate face image: tagged media, content images, covers, YouTube stills,
 * cached profile thumbs for embedded npub/nprofile.
 */
export function pinboardSyncFaceImage(event: Event): string | null {
  const tagged = pinboardSlipImage(event);
  if (tagged) return tagged;

  const fromContent = acceptImageUrl(firstContentImageUrl(event.content));
  if (fromContent) return fromContent;

  const cover = acceptImageUrl(coverImageUrl(event) ?? coverFullImageUrl(event));
  if (cover) return cover;

  for (const url of contentHttpUrls(event.content)) {
    const yt = youtubeStillUrl(url);
    if (yt) return yt;
  }

  for (const token of contentNostrTokens(event.content)) {
    const ref = decodeNostrBech32(token);
    if (!ref) continue;
    if ((ref.kind === 'npub' || ref.kind === 'nprofile') && ref.pubkey) {
      const pic = peekProfileThumb(ref.pubkey)?.picture;
      const ok = acceptImageUrl(pic);
      if (ok) return ok;
    }
    if ((ref.kind === 'note' || ref.kind === 'nevent') && ref.id) {
      const hit = memoryGetEvent(ref.id);
      if (hit) {
        const nested = pinboardSlipImage(hit) || acceptImageUrl(firstContentImageUrl(hit.content));
        if (nested) return nested;
      }
    }
  }

  return null;
}

/** First https URL suitable for an Open Graph card (content, then web-bookmark d/r). */
export function pinboardFirstOgUrl(event: Event): string | null {
  for (const url of contentHttpUrls(event.content)) {
    if (shouldOgPreview(url)) return url;
  }
  const bookmark = webBookmarkUrl(event);
  if (bookmark && shouldOgPreview(bookmark)) return bookmark;
  return null;
}

/**
 * Resolve a face image for a pin slip: sync sources first, then OG previews,
 * then nostr profile / embedded-event images.
 */
export async function pinboardResolveFaceImage(
  event: Event,
  opts?: { signal?: AbortSignal }
): Promise<string | null> {
  const sync = pinboardSyncFaceImage(event);
  if (sync) return sync;

  const bookmarkOg = pinboardFirstOgUrl(event);
  const ogTargets = [...contentHttpUrls(event.content)];
  if (bookmarkOg) ogTargets.push(bookmarkOg);
  const seenOg = new Set<string>();
  for (const url of ogTargets) {
    if (opts?.signal?.aborted) return null;
    if (seenOg.has(url)) continue;
    seenOg.add(url);
    const yt = youtubeStillUrl(url);
    if (yt) return yt;
    if (!shouldOgPreview(url)) continue;
    const og = await fetchOgPreview(url, { signal: opts?.signal });
    const img = acceptImageUrl(og?.image);
    if (img) return img;
  }

  for (const token of contentNostrTokens(event.content)) {
    if (opts?.signal?.aborted) return null;
    const ref = decodeNostrBech32(token);
    if (!ref) continue;

    if (ref.kind === 'npub' || ref.kind === 'nprofile') {
      if (!ref.pubkey) continue;
      const warm = acceptImageUrl(peekProfileThumb(ref.pubkey)?.picture);
      if (warm) return warm;
      const meta = await ensureMetadata(ref.pubkey);
      if (!meta) continue;
      const pic = acceptImageUrl(
        peekProfileThumb(ref.pubkey)?.picture || profileThumbFromKind0(meta).picture
      );
      if (pic) return pic;
      continue;
    }

    if ((ref.kind === 'note' || ref.kind === 'nevent') && ref.id) {
      const hit =
        memoryGetEvent(ref.id) ??
        (await fetchById(ref.id, {
          hintRelays: ref.relays,
          authorPubkey: ref.pubkey
        }));
      if (!hit) continue;
      const nested =
        pinboardSyncFaceImage(hit) ||
        acceptImageUrl(firstContentImageUrl(hit.content));
      if (nested) return nested;
      const nestedOg = pinboardFirstOgUrl(hit);
      if (nestedOg) {
        const og = await fetchOgPreview(nestedOg, { signal: opts?.signal });
        const img = acceptImageUrl(og?.image);
        if (img) return img;
      }
      continue;
    }

    if (ref.kind === 'naddr' && ref.naddr) {
      const coord = `${ref.naddr.kind}:${ref.naddr.pubkey}:${ref.naddr.identifier}`;
      const hit = await fetchByAddress(coord, { hintRelays: ref.naddr.relays });
      if (!hit) continue;
      const nested =
        pinboardSyncFaceImage(hit) ||
        acceptImageUrl(coverImageUrl(hit) ?? coverFullImageUrl(hit));
      if (nested) return nested;
    }
  }

  return null;
}

/**
 * Short non-link text for a handwriting overlay on the hero OG photo
 * (e.g. "GM" from a GM + links note).
 */
export function pinboardHandText(event: Event, maxChars = 40): string {
  const media = uniqueMedia(event);
  let body = omitMediaUrls(event.content ?? '', media);
  body = body
    .replace(CONTENT_HTTP_URL, ' ')
    .replace(NOSTR_BECH32, ' ')
    .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (body) return cropText(body, maxChars);
  const title = firstTag(event, 'title')?.trim();
  return title ? cropText(title, maxChars) : '';
}
