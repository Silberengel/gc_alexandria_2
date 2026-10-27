import { cleanTrackingUrl, tidyPastedUrl } from './clean-url';

const MEDIA_EXT =
  /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|ogv|mkv|mp3|ogg|wav|m4a|flac|aac|opus)(\?|#|$)/i;

/** True when clipboard/plain text is a single http(s) media URL. */
export function looksLikeMediaUrl(text: string): boolean {
  const raw = tidyPastedUrl(text);
  if (!raw || /\s/.test(raw)) return false;
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return MEDIA_EXT.test(url.pathname) || MEDIA_EXT.test(url.href);
  } catch {
    return false;
  }
}

function fileFromClipboardItem(item: DataTransferItem): File | null {
  if (item.kind !== 'file') return null;
  return item.getAsFile();
}

/** Deduped image/video/audio files from a paste or drop. */
export function mediaFilesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const out: File[] = [];
  const seen = new Set<string>();

  const push = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      // Screenshots sometimes omit type — allow empty type when named like media.
      if (file.type && !MEDIA_EXT.test(file.name)) return;
    }
    const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };

  for (const file of Array.from(data.files ?? [])) push(file);
  for (const item of Array.from(data.items ?? [])) push(fileFromClipboardItem(item));
  return out;
}

function guessNameFromUrl(url: string, mime: string): string {
  try {
    const path = new URL(url).pathname;
    const base = path.split('/').pop() || '';
    if (base && /\.[a-z0-9]+$/i.test(base)) return decodeURIComponent(base);
  } catch {
    /* ignore */
  }
  const ext =
    mime === 'image/jpeg'
      ? 'jpg'
      : mime === 'image/png'
        ? 'png'
        : mime === 'image/webp'
          ? 'webp'
          : mime === 'image/gif'
            ? 'gif'
            : mime.startsWith('video/')
              ? 'mp4'
              : mime.startsWith('audio/')
                ? 'mp3'
                : 'bin';
  return `media.${ext}`;
}

/**
 * Fetch a remote media URL (after scrubbing trackers) as a File for Blossom upload.
 * Throws when the URL is invalid or the browser cannot fetch it (CORS, etc.).
 */
export async function fetchRemoteMediaFile(rawUrl: string): Promise<File> {
  const cleaned = cleanTrackingUrl(rawUrl);
  if (!cleaned) throw new Error('That does not look like a usable media URL.');

  let response: Response;
  try {
    response = await fetch(cleaned, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
  } catch {
    throw new Error(
      'Could not fetch that URL from the browser (blocked or offline). Download the file and upload it instead.'
    );
  }
  if (!response.ok) {
    throw new Error(`Could not fetch media (${response.status}). Download the file and upload it instead.`);
  }

  const mime = (response.headers.get('content-type') || '').split(';')[0]?.trim() || '';
  if (mime && !mime.startsWith('image/') && !mime.startsWith('video/') && !mime.startsWith('audio/')) {
    throw new Error('That URL is not an image, video, or audio file.');
  }
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new Error('That URL returned an empty file.');

  const type = mime || 'application/octet-stream';
  return new File([buffer], guessNameFromUrl(cleaned, type), { type });
}
