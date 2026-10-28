export { PAPERS, paperById } from './papers';
export {
  paintDrawing,
  paintStroke,
  replaySteps,
  mulberry32,
  strokeWidthAt,
  drawCoverImage,
  type DrawBackgroundImage
} from './paint';
export { encodeDrawingGif, encodeDrawingGifForUpload } from './encode-gif';
export { encodeDrawingPng } from './encode-static';
export type { EncodeDrawingPngOpts } from './encode-static';
export {
  UPLOAD_GIF_MAX_BYTES,
  BACKGROUND_MAX_EDGE,
  gifEncodePreset,
  prepareBackgroundForDrawing,
  compressBackgroundDataUrl,
  rasterizeImage,
  downscaleDimensions
} from './compress';
export {
  INK_PALETTE,
  DEFAULT_DRAW_SIZE,
  DEFAULT_TEXT_SIZE,
  DEFAULT_HIGHLIGHTER_SIZE,
  DEFAULT_HIGHLIGHTER_COLOR,
  DRAW_FONTS,
  FREEHAND_TOOLS,
  SHAPE_TOOLS,
  LABEL_TOOLS,
  drawFontById,
  canvasFontString,
  isShapeTool,
  isTextTool,
  type DrawTool,
  type DrawPoint,
  type DrawStroke,
  type DrawFontId,
  type DrawFontDef,
  type PaperId,
  type PaperDef
} from './types';
export { colorWithAlpha } from './paint';
