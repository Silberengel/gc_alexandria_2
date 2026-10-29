import { cssRgb } from './palette';
import { snoPosition, type SnoObject } from './parse';

export type SnoViewState = {
  yaw: number;
  pitch: number;
  distance: number;
  /** Orbit center. The mesh bounds, not the origin. */
  target: [number, number, number];
};

/** Bounding sphere of the vertex positions. `extent` is only a grid hint. */
export function snoFrame(sno: SnoObject): { center: [number, number, number]; radius: number } {
  const n = sno.vertices.length;
  if (!n) return { center: [0, 0, 0], radius: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const p = snoPosition(sno, i);
    pts.push(p);
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    minZ = Math.min(minZ, p[2]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
    maxZ = Math.max(maxZ, p[2]);
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  let radius = 0;
  for (const p of pts) {
    radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
  }
  return { center, radius: Math.max(radius, 0.75) };
}

export function defaultView(sno: SnoObject): SnoViewState {
  const frame = snoFrame(sno);
  // project() uses focal length 0.42 × canvas. This distance puts the bounding
  // sphere across about 62% of the square at every spin angle. `extent` is only
  // the lattice hint and must not park the camera.
  const distance = (2 * frame.radius * 0.42) / 0.62;
  return { yaw: 0.6, pitch: 0.35, distance, target: frame.center };
}

function project(
  x: number,
  y: number,
  z: number,
  view: SnoViewState,
  width: number,
  height: number
): { x: number; y: number; z: number } {
  const target = view.target ?? [0, 0, 0];
  const px = x - target[0];
  const py = y - target[1];
  const pz = z - target[2];
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  // yaw around Y, then pitch around X
  const x1 = px * cy + pz * sy;
  const z1 = -px * sy + pz * cy;
  const y2 = py * cp - z1 * sp;
  const z2 = py * sp + z1 * cp;
  const dist = view.distance;
  const f = Math.min(width, height) * 0.42;
  const depth = z2 + dist;
  const scale = f / Math.max(0.5, depth);
  return {
    x: width / 2 + x1 * scale,
    y: height / 2 - y2 * scale,
    z: depth
  };
}

function projectedBounds(
  sno: SnoObject,
  view: SnoViewState,
  size: number
): { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < sno.vertices.length; i++) {
    const [x, y, z] = snoPosition(sno, i);
    const p = project(x, y, z, view, size, size);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: size / 2, cy: size / 2 };
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Longest screen-space axis of the mesh, in CSS pixels. */
export function meshScreenSpan(sno: SnoObject, view: SnoViewState, size: number): number {
  const box = projectedBounds(sno, view, size);
  return Math.max(box.maxX - box.minX, box.maxY - box.minY);
}

function uniqueEdges(faces: Array<[number, number, number]>): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const [a, b, c] of faces) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a]
    ] as const) {
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      const key = `${lo}:${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([lo, hi]);
    }
  }
  return out;
}

/** Soft orbit render on a 2d canvas (painter's algorithm for solids). */
export function renderSno(
  ctx: CanvasRenderingContext2D,
  sno: SnoObject,
  view: SnoViewState,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'color-mix(in srgb, #1a2030 92%, #000)';
  // Fallback if color-mix unsupported in offscreen tests
  ctx.fillStyle = '#151a24';
  ctx.fillRect(0, 0, width, height);

  const projected = sno.vertices.map((_, i) => {
    const [x, y, z] = snoPosition(sno, i);
    return project(x, y, z, view, width, height);
  });

  const drawPoint = (i: number, r = 2.4) => {
    const p = projected[i]!;
    const rgb = sno.colorsRgb[i]!;
    ctx.fillStyle = cssRgb(rgb);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  if (sno.mode === 'points' || sno.faces.length === 0) {
    if (sno.mode === 'lines' && sno.faces.length === 0) {
      // polyline through vertices
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let i = 1; i < projected.length; i++) {
        const a = projected[i - 1]!;
        const b = projected[i]!;
        const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, cssRgb(sno.colorsRgb[i - 1]!));
        g.addColorStop(1, cssRgb(sno.colorsRgb[i]!));
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    for (let i = 0; i < projected.length; i++) drawPoint(i, sno.mode === 'points' ? 3.2 : 1.8);
    return;
  }

  if (sno.mode === 'lines') {
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    for (const [u, v] of uniqueEdges(sno.faces)) {
      const a = projected[u]!;
      const b = projected[v]!;
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, cssRgb(sno.colorsRgb[u]!));
      g.addColorStop(1, cssRgb(sno.colorsRgb[v]!));
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let i = 0; i < projected.length; i++) drawPoint(i, 1.6);
    return;
  }

  // solid — sort faces by average depth
  const tris = sno.faces.map((face, fi) => {
    const [a, b, c] = face;
    const pa = projected[a]!;
    const pb = projected[b]!;
    const pc = projected[c]!;
    const depth = (pa.z + pb.z + pc.z) / 3;
    const fill = sno.faceColorsRgb?.[fi] ?? averageRgb(sno.colorsRgb[a]!, sno.colorsRgb[b]!, sno.colorsRgb[c]!);
    // Face normal for simple lighting
    const [ax, ay, az] = snoPosition(sno, a);
    const [bx, by, bz] = snoPosition(sno, b);
    const [cx, cy, cz] = snoPosition(sno, c);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const light = Math.max(0.35, (nx / len) * 0.25 + (ny / len) * 0.7 + (nz / len) * 0.35);
    return { pa, pb, pc, depth, fill, light };
  });
  tris.sort((a, b) => b.depth - a.depth);

  for (const t of tris) {
    const [r, g, b] = t.fill;
    ctx.fillStyle = cssRgb([
      Math.round(r * t.light),
      Math.round(g * t.light),
      Math.round(b * t.light)
    ]);
    ctx.beginPath();
    ctx.moveTo(t.pa.x, t.pa.y);
    ctx.lineTo(t.pb.x, t.pb.y);
    ctx.lineTo(t.pc.x, t.pc.y);
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < projected.length; i++) drawPoint(i, 1.4);
}

function averageRgb(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number]
): [number, number, number] {
  return [
    Math.round((a[0] + b[0] + c[0]) / 3),
    Math.round((a[1] + b[1] + c[1]) / 3),
    Math.round((a[2] + b[2] + c[2]) / 3)
  ];
}
