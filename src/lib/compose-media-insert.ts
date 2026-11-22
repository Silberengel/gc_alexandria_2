/**
 * Shared media insert helpers for compose / reply toolbars.
 */
import type { Event } from 'nostr-tools';
import {
  blossomServersFromTags,
  imetaTagFromUpload,
  mergeBlossomServers,
  uploadToBlossomServers,
  type SignedNostrEvent
} from './blossom';
import { cleanTrackingUrl } from './clean-url';
import { KIND } from './constants';
import { lruDelete, lruGet, lruSet } from './compose-lru';
import { cachedIdentityEvent, rememberIdentityEvent } from './nostr/identity-cache';
import { pickLatestReplaceable } from './nostr/replaceable';
import { relayPool } from './nostr/pool';
import { profileStack, socialStack, writeStack } from './nostr/selector';
import { session } from './stores/session';
import { signUnsigned } from './sign';

export function appendMediaUrl(content: string, url: string): string {
  const cleaned = cleanTrackingUrl(url.trim()) || url.trim();
  if (!cleaned) return content;
  if (content.includes(cleaned)) return content;
  const sep = content.trim() ? (content.endsWith('\n') ? '' : '\n') : '';
  return `${content}${sep}${cleaned}`;
}

export function appendImeta(imetaTags: string[][], tag: string[]): string[][] {
  if (!tag.length || tag[0] !== 'imeta') return imetaTags;
  const urlPart = tag.find((p) => p.startsWith('url '));
  const url = urlPart?.slice(4).trim().toLowerCase() ?? '';
  if (url) {
    const exists = imetaTags.some((row) =>
      row.some((c) => c.toLowerCase() === `url ${url}` || c.toLowerCase() === url)
    );
    if (exists) return imetaTags;
  }
  return [...imetaTags, [...tag]];
}

function blossomCacheKey(pubkey: string): string {
  return `blossom-servers:${pubkey.trim().toLowerCase()}`;
}

/** Drop cached kind-10063 server list for a pubkey (after Replace/publish). */
export function invalidateBlossomServerCache(pubkey?: string | null): void {
  const pk = pubkey?.trim().toLowerCase() ?? '';
  if (pk) lruDelete(blossomCacheKey(pk));
}

function serversFromEvent(ev: Event | null | undefined): string[] {
  if (!ev || ev.kind !== KIND.BLOSSOM_SERVER_LIST) return [];
  return blossomServersFromTags(ev.tags);
}

/**
 * Resolve Blossom upload hosts for a pubkey.
 * Prefers the viewer's kind 10063 list (identity cache → session metadata → relays),
 * then appends presets only as fallbacks after those URLs.
 */
export async function resolveBlossomServers(pubkey?: string | null): Promise<string[]> {
  const pk = pubkey?.trim().toLowerCase() ?? '';
  if (!pk) return mergeBlossomServers([]);

  const cacheKey = blossomCacheKey(pk);
  const cached = lruGet<string[]>(cacheKey);
  if (cached?.length) return mergeBlossomServers(cached);

  let user: string[] = [];

  const cachedEv = cachedIdentityEvent(KIND.BLOSSOM_SERVER_LIST, pk);
  user = serversFromEvent(cachedEv);

  if (!user.length) {
    const fromSession = pickLatestReplaceable(
      session.getMetadata().filter((e) => e.kind === KIND.BLOSSOM_SERVER_LIST && e.pubkey.toLowerCase() === pk),
      KIND.BLOSSOM_SERVER_LIST,
      pk
    );
    user = serversFromEvent(fromSession);
    if (fromSession) rememberIdentityEvent(fromSession);
  }

  if (!user.length) {
    try {
      const relays = [
        ...new Set([...writeStack(), ...profileStack(), ...socialStack()])
      ].slice(0, 12);
      const hits = await relayPool.query(
        relays.length ? relays : profileStack(),
        [{ authors: [pk], kinds: [KIND.BLOSSOM_SERVER_LIST], limit: 5 }],
        5000,
        6
      );
      const latest = pickLatestReplaceable(hits, KIND.BLOSSOM_SERVER_LIST, pk);
      if (latest) {
        rememberIdentityEvent(latest);
        session.rememberEvent(latest);
        user = serversFromEvent(latest);
      }
    } catch {
      /* presets only */
    }
  }

  if (user.length) lruSet(cacheKey, user);
  return mergeBlossomServers(user);
}

export type BlossomUploadResult = {
  url: string;
  mime: string;
  name: string;
  sha256: string;
  server: string;
  imeta: string[];
};

export async function uploadComposeMedia(opts: {
  file: File;
  pubkey?: string | null;
  signAuth?: (partial: {
    kind: number;
    content: string;
    tags: string[][];
  }) => Promise<SignedNostrEvent | null>;
}): Promise<BlossomUploadResult> {
  const bytes = new Uint8Array(await opts.file.arrayBuffer());
  const servers = await resolveBlossomServers(opts.pubkey);
  const result = await uploadToBlossomServers({
    servers,
    bytes,
    mimeType: opts.file.type || undefined,
    signAuth: opts.signAuth ?? (async (partial) => signUnsigned(partial))
  });
  let width: number | undefined;
  let height: number | undefined;
  if (opts.file.type.startsWith('image/')) {
    try {
      const bmp = await createImageBitmap(opts.file);
      width = bmp.width;
      height = bmp.height;
      bmp.close();
    } catch {
      /* ignore */
    }
  }
  const imeta = imetaTagFromUpload({
    url: result.url,
    mime: opts.file.type || undefined,
    sha256: result.sha256,
    width,
    height
  });
  return {
    url: result.url,
    mime: opts.file.type || '',
    name: opts.file.name,
    sha256: result.sha256,
    server: result.server,
    imeta
  };
}
