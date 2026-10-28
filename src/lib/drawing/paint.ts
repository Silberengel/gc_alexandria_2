import { paperById } from './papers';
import {
  isShapeTool,
  isTextTool,
  type DrawPoint,
  type DrawStroke,
  type PaperId
} from './types';

export type DrawBackgroundImage = CanvasImageSource & {
  width: number;
  height: number;
};

/** Cover-fit an image into the canvas (centered, may crop). */
export function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: DrawBackgroundImage,
  width: number,
  height: number
): void {
  const iw = Math.max(1, Number(img.width) || 1);
  const ih = Math.max(1, Number(img.height) || 1);
  const scale = Math.max(width / iw, height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

/** Mulberry32 — deterministic PRNG for spray dots. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function strokeWidthAt(stroke: DrawStroke, pressure: number): number {
  const p = Number.isFinite(pressure) && pressure > 0 ? Math.min(1, pressure) : 0.5;
  if (stroke.tool === 'pencil') return Math.max(0.6, stroke.width * 0.55 * (0.7 + p * 0.6));
  if (stroke.tool === 'spray') return stroke.width;
  if (stroke.tool === 'highlighter') {
    // Wide, soft tip — good for marking photos and paper.
    return Math.max(6, stroke.width * 2.4 * (0.85 + p * 0.35));
  }
  return Math.max(0.8, stroke.width * (0.55 + p * 0.9));
}

/** Parse #rgb / #rrggbb (and optional alpha) into an rgba() stroke color. */
export function colorWithAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const raw = color.trim();
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(raw);
  if (short) {
    const r = parseInt(short[1]! + short[1]!, 16);
    const g = parseInt(short[2]! + short[2]!, 16);
    const b = parseInt(short[3]! + short[3]!, 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const full = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(raw);
  if (full) {
    const r = parseInt(full[1]!, 16);
    const g = parseInt(full[2]!, 16);
    const b = parseInt(full[3]!, 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return raw;
}

function drawPaperBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  paperId: PaperId,
  backgroundImage?: DrawBackgroundImage | null
): void {
  const paper = paperById(paperId);
  ctx.fillStyle = paper.background;
  ctx.fillRect(0, 0, width, height);

  if (backgroundImage) {
    drawCoverImage(ctx, backgroundImage, width, height);
    return;
  }

  if (paper.id === 'sticky') {
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, 0, width, Math.max(10, height * 0.06));
  }

  ctx.strokeStyle = paper.patternColor;
  ctx.fillStyle = paper.patternColor;
  const step = Math.max(16, Math.round(Math.min(width, height) / 22));

  if (paper.pattern === 'lined') {
    ctx.lineWidth = 1;
    const top = step * 1.5;
    for (let y = top; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(step * 0.6, y);
      ctx.lineTo(width - step * 0.4, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(180, 70, 70, 0.35)';
    ctx.beginPath();
    ctx.moveTo(step * 1.4, 0);
    ctx.lineTo(step * 1.4, height);
    ctx.stroke();
  } else if (paper.pattern === 'grid') {
    ctx.lineWidth = 1;
    for (let x = step; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = step; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  } else if (paper.pattern === 'dots') {
    for (let y = step; y < height; y += step) {
      for (let x = step; x < width; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function paintSpray(
  ctx: CanvasRenderingContext2D,
  stroke: DrawStroke,
  points: DrawPoint[],
  mirror: boolean,
  width: number
): void {
  const rand = mulberry32(stroke.seed);
  ctx.fillStyle = stroke.color;
  for (const pt of points) {
    const radius = stroke.width * 1.4;
    const dots = 6 + Math.floor(rand() * 8);
    for (let i = 0; i < dots; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * radius;
      const x = pt.x + Math.cos(a) * d;
      const y = pt.y + Math.sin(a) * d;
      const r = 0.4 + rand() * 1.4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (mirror) {
        ctx.beginPath();
        ctx.arc(width - x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function paintPolyline(
  ctx: CanvasRenderingContext2D,
  stroke: DrawStroke,
  points: DrawPoint[],
  mirror: boolean,
  canvasWidth: number
): void {
  if (!points.length) return;
  const erase = stroke.tool === 'eraser';
  const highlight = stroke.tool === 'highlighter';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Multiply tints paper/photos so the mark reads as a highlighter, not opaque ink.
  ctx.globalCompositeOperation = erase
    ? 'destination-out'
    : highlight
      ? 'multiply'
      : 'source-over';
  const ink = erase
    ? 'rgba(0,0,0,1)'
    : highlight
      ? colorWithAlpha(stroke.color, 0.72)
      : stroke.color;
  ctx.strokeStyle = ink;

  const drawPath = (flip: boolean) => {
    if (points.length === 1) {
      const p = points[0]!;
      const x = flip ? canvasWidth - p.x : p.x;
      const w = strokeWidthAt(stroke, p.pressure);
      ctx.beginPath();
      ctx.fillStyle = ink;
      ctx.arc(x, p.y, w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const ax = flip ? canvasWidth - a.x : a.x;
      const bx = flip ? canvasWidth - b.x : b.x;
      ctx.beginPath();
      ctx.lineWidth = strokeWidthAt(stroke, (a.pressure + b.pressure) / 2);
      ctx.moveTo(ax, a.y);
      ctx.lineTo(bx, b.y);
      ctx.stroke();
    }
  };

  drawPath(false);
  if (mirror) drawPath(true);
  ctx.restore();
}

function paintShape(
  ctx: CanvasRenderingContext2D,
  stroke: DrawStroke,
  points: DrawPoint[],
  mirror: boolean,
  canvasWidth: number
): void {
  if (!points.length) return;
  const a = points[0]!;
  const b = points[points.length - 1] ?? a;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(1, stroke.width);
  ctx.globalCompositeOperation = 'source-over';

  const drawOnce = (flip: boolean) => {
    const ax = flip ? canvasWidth - a.x : a.x;
    const bx = flip ? canvasWidth - b.x : b.x;
    const ay = a.y;
    const by = b.y;
    ctx.beginPath();
    if (stroke.tool === 'line') {
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      return;
    }
    const left = Math.min(ax, bx);
    const top = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    if (stroke.tool === 'rect') {
      if (w < 0.5 && h < 0.5) {
        ctx.arc(ax, ay, stroke.width / 2, 0, Math.PI * 2);
        ctx.fillStyle = stroke.color;
        ctx.fill();
      } else {
        ctx.strokeRect(left, top, Math.max(w, 0.5), Math.max(h, 0.5));
      }
      return;
    }
    // ellipse inscribed in the drag rect
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;
    const rx = Math.max(0.5, w / 2);
    const ry = Math.max(0.5, h / 2);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  };

  drawOnce(false);
  if (mirror) drawOnce(true);
  ctx.restore();
}

function paintText(
  ctx: CanvasRenderingContext2D,
  stroke: DrawStroke,
  points: DrawPoint[],
  mirror: boolean,
  canvasWidth: number
): void {
  const label = stroke.text?.trim();
  if (!label || !points.length) return;
  const anchor = points[0]!;
  const fontSize = Math.max(10, Math.min(160, stroke.width));
  const family = stroke.fontFamily?.trim() || 'system-ui, sans-serif';
  const style = stroke.fontStyle === 'italic' ? 'italic' : 'normal';
  const weight = stroke.fontWeight ?? 'normal';

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = stroke.color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `${style} ${weight} ${fontSize}px ${family}`;

  const drawOnce = (flip: boolean) => {
    const x = flip ? canvasWidth - anchor.x : anchor.x;
    if (flip) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.fillText(label, -x, anchor.y);
      ctx.restore();
    } else {
      ctx.fillText(label, x, anchor.y);
    }
  };

  drawOnce(false);
  if (mirror) drawOnce(true);
  ctx.restore();
}

/** Paint a single stroke (or a prefix of its points) onto an existing canvas. */
export function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: DrawStroke,
  opts?: { pointCount?: number; mirror?: boolean; canvasWidth?: number }
): void {
  const count = opts?.pointCount ?? stroke.points.length;
  const points = stroke.points.slice(0, Math.max(0, count));
  if (!points.length) return;
  const mirror = opts?.mirror ?? false;
  const canvasWidth = opts?.canvasWidth ?? ctx.canvas.width;
  if (stroke.tool === 'spray') {
    paintSpray(ctx, stroke, points, mirror, canvasWidth);
  } else if (isTextTool(stroke.tool)) {
    paintText(ctx, stroke, points, mirror, canvasWidth);
  } else if (isShapeTool(stroke.tool)) {
    paintShape(ctx, stroke, points, mirror, canvasWidth);
  } else {
    paintPolyline(ctx, stroke, points, mirror, canvasWidth);
  }
}

/** Full frame: paper + optional photo + all strokes (optionally truncated for replay). */
export function paintDrawing(
  ctx: CanvasRenderingContext2D,
  opts: {
    width: number;
    height: number;
    paperId: PaperId;
    strokes: DrawStroke[];
    mirror?: boolean;
    backgroundImage?: DrawBackgroundImage | null;
    /** Inclusive end: paint strokes[0..strokeIndex] with points up to pointIndex on the last. */
    replay?: { strokeIndex: number; pointIndex: number };
  }
): void {
  const { width, height, paperId, strokes, mirror = false, backgroundImage = null } = opts;
  drawPaperBackground(ctx, width, height, paperId, backgroundImage);

  const endStroke = opts.replay ? Math.min(opts.replay.strokeIndex, strokes.length - 1) : strokes.length - 1;
  for (let i = 0; i <= endStroke; i++) {
    const stroke = strokes[i];
    if (!stroke) continue;
    const pointCount =
      opts.replay && i === endStroke ? opts.replay.pointIndex + 1 : stroke.points.length;
    paintStroke(ctx, stroke, { pointCount, mirror, canvasWidth: width });
  }
}

/** Flatten strokes into progressive (strokeIndex, pointIndex) steps for GIF replay. */
export function replaySteps(
  strokes: DrawStroke[],
  opts?: { maxFrames?: number; pointsPerFrame?: number }
): Array<{ strokeIndex: number; pointIndex: number }> {
  const maxFrames = opts?.maxFrames ?? 48;
  const pointsPerFrame = opts?.pointsPerFrame ?? 3;
  const steps: Array<{ strokeIndex: number; pointIndex: number }> = [];
  if (!strokes.length) {
    steps.push({ strokeIndex: -1, pointIndex: -1 });
    return steps;
  }
  for (let si = 0; si < strokes.length; si++) {
    const stroke = strokes[si]!;
    for (let pi = 0; pi < stroke.points.length; pi += pointsPerFrame) {
      steps.push({ strokeIndex: si, pointIndex: Math.min(pi + pointsPerFrame - 1, stroke.points.length - 1) });
    }
    const last = stroke.points.length - 1;
    if (!steps.length || steps[steps.length - 1]!.pointIndex !== last || steps[steps.length - 1]!.strokeIndex !== si) {
      steps.push({ strokeIndex: si, pointIndex: last });
    }
  }
  if (steps.length <= maxFrames) return steps;
  const out: typeof steps = [];
  for (let i = 0; i < maxFrames; i++) {
    const idx = Math.round((i * (steps.length - 1)) / (maxFrames - 1));
    out.push(steps[idx]!);
  }
  return out;
}
