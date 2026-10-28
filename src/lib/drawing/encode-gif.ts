import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import {
  UPLOAD_GIF_MAX_BYTES,
  gifEncodePreset,
  type GifEncodeQuality
} from './compress';
import { paintDrawing, replaySteps, type DrawBackgroundImage } from './paint';
import { DEFAULT_DRAW_SIZE, type DrawStroke, type PaperId } from './types';

export type EncodeDrawingGifOpts = {
  strokes: DrawStroke[];
  paperId: PaperId;
  width?: number;
  height?: number;
  mirror?: boolean;
  backgroundImage?: DrawBackgroundImage | null;
  /** Delay between frames in ms. */
  delayMs?: number;
  maxFrames?: number;
  /** Palette size (2–256). */
  colors?: number;
  pointsPerFrame?: number;
  /** Named preset — overrides frame/color defaults when set. */
  quality?: GifEncodeQuality;
};

function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  // Prefer a DOM canvas so page web fonts (Literata, Caveat, …) paint into GIFs.
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas 2d context');
    return { canvas, ctx };
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create OffscreenCanvas 2d context');
    return { canvas, ctx };
  }
  throw new Error('No canvas available for GIF encode');
}

function readRgba(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number
): Uint8ClampedArray {
  return ctx.getImageData(0, 0, width, height).data;
}

/**
 * Encode a stroke-replay GIF (Amethyst-style): paper + progressive strokes, looping.
 */
export async function encodeDrawingGif(opts: EncodeDrawingGifOpts): Promise<Blob> {
  const preset = gifEncodePreset(opts.quality ?? 'preview');
  const width = opts.width ?? DEFAULT_DRAW_SIZE.width;
  const height = opts.height ?? DEFAULT_DRAW_SIZE.height;
  const delay = opts.delayMs ?? preset.delayMs;
  const maxFrames = opts.maxFrames ?? preset.maxFrames;
  const pointsPerFrame = opts.pointsPerFrame ?? preset.pointsPerFrame;
  const colors = Math.max(2, Math.min(256, opts.colors ?? preset.colors));
  const { ctx } = makeCanvas(width, height);
  const steps = replaySteps(opts.strokes, { maxFrames, pointsPerFrame });

  const gif = GIFEncoder();
  let sharedPalette: number[][] | null = null;

  const bg = opts.backgroundImage ?? null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.strokeIndex < 0) {
      paintDrawing(ctx as CanvasRenderingContext2D, {
        width,
        height,
        paperId: opts.paperId,
        strokes: [],
        mirror: opts.mirror,
        backgroundImage: bg
      });
    } else {
      paintDrawing(ctx as CanvasRenderingContext2D, {
        width,
        height,
        paperId: opts.paperId,
        strokes: opts.strokes,
        mirror: opts.mirror,
        backgroundImage: bg,
        replay: step
      });
    }
    const rgba = readRgba(ctx, width, height);
    if (!sharedPalette) {
      sharedPalette = quantize(rgba, colors);
    }
    const index = applyPalette(rgba, sharedPalette);
    gif.writeFrame(index, width, height, {
      palette: sharedPalette,
      delay,
      // First frame clears; later frames also replace fully (simplest, paper-safe).
      dispose: 1
    });
  }

  // Hold the finished drawing a beat longer.
  if (opts.strokes.length) {
    paintDrawing(ctx as CanvasRenderingContext2D, {
      width,
      height,
      paperId: opts.paperId,
      strokes: opts.strokes,
      mirror: opts.mirror,
      backgroundImage: bg
    });
    const rgba = readRgba(ctx, width, height);
    const palette = sharedPalette ?? quantize(rgba, colors);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, width, height, { palette, delay: delay * 8, dispose: 1 });
  }

  gif.finish();
  const bytes = gif.bytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'image/gif' });
}

/**
 * Encode for blossom: start at upload quality, then tighten if still over the size cap.
 */
export async function encodeDrawingGifForUpload(
  opts: Omit<EncodeDrawingGifOpts, 'quality'>
): Promise<Blob> {
  let blob = await encodeDrawingGif({ ...opts, quality: 'upload' });
  if (blob.size <= UPLOAD_GIF_MAX_BYTES) return blob;

  blob = await encodeDrawingGif({
    ...opts,
    quality: 'upload',
    maxFrames: 16,
    colors: 96,
    pointsPerFrame: 8
  });
  if (blob.size <= UPLOAD_GIF_MAX_BYTES) return blob;

  // Last resort: nearly static replay of the finished frame.
  return encodeDrawingGif({
    ...opts,
    quality: 'upload',
    maxFrames: 2,
    colors: 96,
    pointsPerFrame: 64
  });
}
