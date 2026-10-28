import {
  BLOSSOM_PRESET_SERVERS,
  blossomServersFromTags,
  imetaTagFromUpload,
  mergeBlossomServers,
  uploadToBlossomServers
} from '$lib/blossom';
import { relayPool } from '$lib/nostr/pool';
import { profileStack } from '$lib/nostr/selector';
import { signUnsigned } from '$lib/sign';
import { DEFAULT_DRAW_SIZE } from './types';

export type DrawingUploadResult = {
  url: string;
  sha256: string;
  imeta: string[];
};

async function blossomServerList(pubkey: string): Promise<string[]> {
  let user: string[] = [];
  try {
    const hits = await relayPool.query(
      profileStack(),
      [{ authors: [pubkey], kinds: [10063], limit: 1 }],
      4000,
      2
    );
    const ev = hits[0];
    if (ev) user = blossomServersFromTags(ev.tags);
  } catch {
    /* presets */
  }
  return mergeBlossomServers(user, BLOSSOM_PRESET_SERVERS);
}

/** Upload a drawing image (PNG or GIF) and return URL + imeta tag parts. */
export async function uploadDrawingImage(
  blob: Blob,
  pubkey: string,
  mimeType?: string
): Promise<DrawingUploadResult> {
  const raw = (mimeType?.trim() || blob.type?.trim() || 'image/png').toLowerCase();
  const mime = raw === 'image/gif' || raw === 'image/png' || raw === 'image/webp' || raw === 'image/jpeg'
    ? raw
    : 'image/png';
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const servers = await blossomServerList(pubkey);
  const result = await uploadToBlossomServers({
    servers,
    bytes,
    mimeType: mime,
    signAuth: async (partial) => signUnsigned(partial)
  });
  const imeta = imetaTagFromUpload({
    url: result.url,
    mime,
    sha256: result.sha256,
    width: DEFAULT_DRAW_SIZE.width,
    height: DEFAULT_DRAW_SIZE.height
  });
  return { url: result.url, sha256: result.sha256, imeta };
}

/** @deprecated Prefer uploadDrawingImage — kept for call-site clarity on GIF uploads. */
export async function uploadDrawingGif(
  blob: Blob,
  pubkey: string
): Promise<DrawingUploadResult> {
  return uploadDrawingImage(blob, pubkey, 'image/gif');
}
