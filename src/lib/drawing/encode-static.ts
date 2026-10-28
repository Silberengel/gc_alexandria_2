import { paintDrawing, type DrawBackgroundImage } from './paint';
import { DEFAULT_DRAW_SIZE, type DrawStroke, type PaperId } from './types';

export type EncodeDrawingPngOpts = {
  strokes: DrawStroke[];
  paperId: PaperId;
  width?: number;
  height?: number;
  mirror?: boolean;
  backgroundImage?: DrawBackgroundImage | null;
};

function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
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
  throw new Error('No canvas available for PNG encode');
}

/** Encode the finished drawing as a single-frame PNG. */
export async function encodeDrawingPng(opts: EncodeDrawingPngOpts): Promise<Blob> {
  const width = opts.width ?? DEFAULT_DRAW_SIZE.width;
  const height = opts.height ?? DEFAULT_DRAW_SIZE.height;
  const { canvas, ctx } = makeCanvas(width, height);
  paintDrawing(ctx as CanvasRenderingContext2D, {
    width,
    height,
    paperId: opts.paperId,
    strokes: opts.strokes,
    mirror: opts.mirror,
    backgroundImage: opts.backgroundImage ?? null
  });

  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png');
    });
    if (!blob) throw new Error('PNG encode failed');
    return blob;
  }

  const off = canvas as OffscreenCanvas;
  if (typeof off.convertToBlob === 'function') {
    return off.convertToBlob({ type: 'image/png' });
  }
  throw new Error('PNG encode failed');
}
