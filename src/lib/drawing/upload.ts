import { imetaTagFromUpload, uploadToBlossomServers } from '$lib/blossom';
import { resolveBlossomServers } from '$lib/compose-media-insert';
import { signUnsigned } from '$lib/sign';
import { DEFAULT_DRAW_SIZE } from './types';

export type DrawingUploadResult = {
  url: string;
  sha256: string;
  imeta: string[];
};

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
  const servers = await resolveBlossomServers(pubkey);
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
