import { DEFAULT_DRAW_SIZE } from './types';

/** Soft cap for blossom GIF uploads (bytes). */
export const UPLOAD_GIF_MAX_BYTES = 900_000;

/** Max edge for backgrounds kept in the editor / draft. */
export const BACKGROUND_MAX_EDGE = 720;

export type GifEncodeQuality = 'preview' | 'upload';

export type GifEncodePreset = {
  maxFrames: number;
  colors: number;
  pointsPerFrame: number;
  delayMs: number;
};

export function gifEncodePreset(quality: GifEncodeQuality): GifEncodePreset {
  if (quality === 'upload') {
    return { maxFrames: 24, colors: 128, pointsPerFrame: 6, delayMs: 90 };
  }
  return { maxFrames: 36, colors: 192, pointsPerFrame: 4, delayMs: 80 };
}

export function downscaleDimensions(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number; scale: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale
  };
}

function sourceSize(img: CanvasImageSource & { width: number; height: number }): {
  width: number;
  height: number;
} {
  if (img instanceof HTMLImageElement) {
    return {
      width: Math.max(1, img.naturalWidth || img.width || 1),
      height: Math.max(1, img.naturalHeight || img.height || 1)
    };
  }
  return {
    width: Math.max(1, Number(img.width) || 1),
    height: Math.max(1, Number(img.height) || 1)
  };
}

/** Draw `img` into a new canvas, optionally downscaled. */
export function rasterizeImage(
  img: CanvasImageSource & { width: number; height: number },
  opts?: { maxEdge?: number }
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const { width: iw, height: ih } = sourceSize(img);
  const { width, height } = downscaleDimensions(iw, ih, opts?.maxEdge ?? BACKGROUND_MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, width, height);
  } catch {
    return null;
  }
  return canvas;
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image load failed'));
    image.src = url;
  });
}

/**
 * Downscale a photo for the drawing canvas (and drafts). Returns a JPEG-backed
 * image when the source is larger than {@link BACKGROUND_MAX_EDGE}.
 */
export async function prepareBackgroundForDrawing(
  img: HTMLImageElement,
  opts?: { maxEdge?: number }
): Promise<{ image: HTMLImageElement; objectUrl: string | null }> {
  const maxEdge = opts?.maxEdge ?? BACKGROUND_MAX_EDGE;
  const { width: iw, height: ih } = sourceSize(img);
  if (Math.max(iw, ih) <= maxEdge) {
    return { image: img, objectUrl: null };
  }

  const canvas = rasterizeImage(img, { maxEdge });
  if (!canvas) return { image: img, objectUrl: null };

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82)
  );
  if (!blob) return { image: img, objectUrl: null };

  const url = URL.createObjectURL(blob);
  try {
    const prepared = await loadHtmlImage(url);
    return { image: prepared, objectUrl: url };
  } catch {
    URL.revokeObjectURL(url);
    return { image: img, objectUrl: null };
  }
}

/** JPEG data URL for sessionStorage drafts (size-capped). */
export function compressBackgroundDataUrl(
  img: CanvasImageSource & { width: number; height: number },
  opts?: { maxEdge?: number; maxChars?: number; quality?: number }
): string | null {
  const canvas = rasterizeImage(img, { maxEdge: opts?.maxEdge ?? BACKGROUND_MAX_EDGE });
  if (!canvas) return null;
  const maxChars = opts?.maxChars ?? 1_200_000;
  let quality = opts?.quality ?? 0.78;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > maxChars && quality > 0.35) {
    quality -= 0.12;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length > maxChars) return null;
  return dataUrl;
}

/** Drawing surface size used for GIF encode. */
export function gifPixelSize(): { width: number; height: number } {
  return { width: DEFAULT_DRAW_SIZE.width, height: DEFAULT_DRAW_SIZE.height };
}
