import { BUILTIN_PALETTE } from './palette';

export type SnoMode = 'solid' | 'lines' | 'points';

export type SnoObject = {
  v: 1 | 2;
  name: string;
  unit: number;
  extent: number;
  mode: SnoMode;
  /** Whole-unit XYZ per vertex. */
  vertices: Array<[number, number, number]>;
  /** Tick remainders 0..119 per vertex (expanded). */
  ticks: Array<[number, number, number]>;
  /** Resolved RGB 0..255 per vertex. */
  colorsRgb: Array<[number, number, number]>;
  faces: Array<[number, number, number]>;
  /** Optional per-face RGB after expansion; null = interpolate vertices. */
  faceColorsRgb: Array<[number, number, number]> | null;
  palette: Uint8Array;
  up: boolean;
  spin: number;
  constrain?: string;
};

export class SnoParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnoParseError';
  }
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

function expandTicks(raw: unknown, vertexCount: number): Array<[number, number, number]> {
  if (raw == null) {
    return Array.from({ length: vertexCount }, () => [0, 0, 0]);
  }
  if (!Array.isArray(raw)) throw new SnoParseError('ticks must be an array');
  const out: Array<[number, number, number]> = [];
  for (const entry of raw) {
    if (isInt(entry) && entry < 0) {
      const n = -entry;
      for (let i = 0; i < n; i++) out.push([0, 0, 0]);
      continue;
    }
    if (
      Array.isArray(entry) &&
      entry.length === 3 &&
      entry.every((c) => isInt(c) && c >= 0 && c <= 119)
    ) {
      out.push([entry[0], entry[1], entry[2]]);
      continue;
    }
    throw new SnoParseError('invalid ticks entry');
  }
  if (out.length !== vertexCount) {
    throw new SnoParseError(`ticks expands to ${out.length}, expected ${vertexCount}`);
  }
  return out;
}

function expandFaceColors(
  raw: unknown,
  faceCount: number,
  paletteLen: number
): number[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new SnoParseError('facecolors must be an array');
  if (!raw.length) throw new SnoParseError('facecolors empty');
  if (!isInt(raw[0]) || raw[0]! < 0) throw new SnoParseError('facecolors must start with an index');
  const out: number[] = [];
  let prev = -1;
  for (const entry of raw) {
    if (!isInt(entry)) throw new SnoParseError('facecolors entry not integer');
    if (entry < 0) {
      if (prev < 0) throw new SnoParseError('facecolors run with no prior index');
      for (let i = 0; i < -entry; i++) out.push(prev);
      continue;
    }
    if (entry >= paletteLen) throw new SnoParseError('facecolors index out of range');
    out.push(entry);
    prev = entry;
  }
  if (out.length !== faceCount) {
    throw new SnoParseError(`facecolors expands to ${out.length}, expected ${faceCount}`);
  }
  return out;
}

function parsePalette(raw: unknown): Uint8Array {
  if (raw == null || raw === 'cyberspace-neon-256') return BUILTIN_PALETTE;
  if (typeof raw === 'string') {
    // Unresolved nevent/naddr → built-in (§1.3b).
    if (/^(nevent|naddr)1/i.test(raw) || raw.length > 0) return BUILTIN_PALETTE;
  }
  if (Array.isArray(raw)) {
    if (raw.length < 2 || raw.length > 256) throw new SnoParseError('palette length');
    const out = new Uint8Array(Math.max(raw.length, 2) * 3);
    for (let i = 0; i < raw.length; i++) {
      const e = raw[i];
      if (!Array.isArray(e) || e.length !== 3 || !e.every((c) => isInt(c) && c >= 0 && c <= 255)) {
        throw new SnoParseError('palette entry');
      }
      out[i * 3] = e[0];
      out[i * 3 + 1] = e[1];
      out[i * 3 + 2] = e[2];
    }
    return out;
  }
  throw new SnoParseError('invalid palette');
}

function looksLikeRgbTriple(entry: unknown): entry is [number, number, number] {
  return (
    Array.isArray(entry) &&
    entry.length === 3 &&
    entry.every((c) => typeof c === 'number' && Number.isFinite(c))
  );
}

function rgbTripleToBytes(entry: [number, number, number]): [number, number, number] {
  // v1 uses 0..1 floats; some writers use 0..255.
  return entry.map((n) => {
    if (n <= 1) return Math.round(Math.max(0, Math.min(1, n)) * 255);
    return Math.max(0, Math.min(255, Math.round(n)));
  }) as [number, number, number];
}

function resolveColor(
  entry: unknown,
  v: 1 | 2,
  palette: Uint8Array,
  generousV2Triples: boolean
): [number, number, number] {
  if (v === 1 || (generousV2Triples && looksLikeRgbTriple(entry))) {
    if (!looksLikeRgbTriple(entry)) throw new SnoParseError('v1 color must be rgb triple');
    return rgbTripleToBytes(entry);
  }
  if (!isInt(entry) || entry < 0) throw new SnoParseError('color index');
  const len = palette.length / 3;
  if (entry >= len) throw new SnoParseError('color index out of range');
  const i = entry * 3;
  return [palette[i]!, palette[i + 1]!, palette[i + 2]!];
}

/**
 * Parse a DECK-0003 SNO payload from JSON text or object.
 * Rejects on §1.9 failures. Accepts Amethyst-style v2 RGB-triple colors as a fallback.
 */
export function parseSno(input: string | unknown): SnoObject {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new SnoParseError('content is not JSON');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SnoParseError('payload must be an object');
  }
  const obj = raw as Record<string, unknown>;

  // §1.1a — ignore type
  void obj.type;

  const v = obj.v;
  if (v !== 1 && v !== 2) throw new SnoParseError('v must be 1 or 2');

  if (!Array.isArray(obj.vertices) || !Array.isArray(obj.colors) || !Array.isArray(obj.faces)) {
    throw new SnoParseError('vertices/colors/faces must be arrays');
  }
  if (obj.vertices.length !== obj.colors.length) {
    throw new SnoParseError('vertices and colors length mismatch');
  }

  const mode = obj.mode;
  if (mode !== 'solid' && mode !== 'lines' && mode !== 'points') {
    throw new SnoParseError('invalid mode');
  }

  if (!isInt(obj.unit) || obj.unit < 0 || obj.unit > 84) {
    throw new SnoParseError('unit out of range');
  }

  const name = typeof obj.name === 'string' ? obj.name.slice(0, 64) : '';
  if (!name && typeof obj.name !== 'string') throw new SnoParseError('name required');

  const vertices: Array<[number, number, number]> = [];
  for (const vert of obj.vertices) {
    if (
      !Array.isArray(vert) ||
      vert.length !== 3 ||
      !vert.every((c) => isInt(c))
    ) {
      throw new SnoParseError('vertex must be three integers');
    }
    vertices.push([vert[0], vert[1], vert[2]]);
  }

  const ticks = expandTicks(obj.ticks, vertices.length);
  const palette = parsePalette(obj.palette);

  const colorsRgb: Array<[number, number, number]> = [];
  for (const c of obj.colors) {
    colorsRgb.push(resolveColor(c, v, palette, true));
  }

  const faces: Array<[number, number, number]> = [];
  for (const f of obj.faces) {
    if (!Array.isArray(f) || f.length !== 3 || !f.every((i) => isInt(i))) {
      throw new SnoParseError('face must be three integers');
    }
    const [a, b, c] = f as number[];
    if (a === b || b === c || a === c) throw new SnoParseError('face indices must be distinct');
    if (a! < 0 || b! < 0 || c! < 0 || a! >= vertices.length || b! >= vertices.length || c! >= vertices.length) {
      throw new SnoParseError('face index out of range');
    }
    faces.push([a!, b!, c!]);
  }

  const faceIdx = expandFaceColors(obj.facecolors, faces.length, palette.length / 3);
  const faceColorsRgb =
    faceIdx.length === faces.length
      ? faceIdx.map((idx) => {
          const i = idx * 3;
          return [palette[i]!, palette[i + 1]!, palette[i + 2]!] as [number, number, number];
        })
      : null;

  let extent = 8;
  if (obj.extent != null) {
    if (isInt(obj.extent) && obj.extent >= 1 && obj.extent <= 64) extent = obj.extent;
  }
  for (const [x, y, z] of vertices) {
    extent = Math.max(extent, Math.abs(x) + 1, Math.abs(y) + 1, Math.abs(z) + 1);
  }
  extent = Math.min(64, extent);

  if (obj.up != null && typeof obj.up !== 'boolean') throw new SnoParseError('up must be boolean');
  const up = obj.up === true;
  let spin = 0;
  if (obj.spin != null) {
    if (!isInt(obj.spin) || obj.spin < 0 || obj.spin > 359) {
      throw new SnoParseError('spin out of range');
    }
    spin = obj.spin;
  }

  // parts/refs: accept absent; reject malformed lightly
  if (obj.parts != null && !Array.isArray(obj.refs)) {
    throw new SnoParseError('parts without refs');
  }

  return {
    v,
    name: name || 'SNO',
    unit: obj.unit,
    extent,
    mode,
    vertices,
    ticks,
    colorsRgb,
    faces,
    faceColorsRgb,
    palette,
    up,
    spin,
    constrain: typeof obj.constrain === 'string' ? obj.constrain : undefined
  };
}

/** Model-space position including ticks (still exact as number for rendering). */
export function snoPosition(
  sno: SnoObject,
  index: number
): [number, number, number] {
  const v = sno.vertices[index]!;
  const t = sno.ticks[index]!;
  let x = v[0] + t[0] / 120;
  let y = v[1] + t[1] / 120;
  let z = v[2] + t[2] / 120;
  // v1 Z flip per DECK-0003 §2
  if (sno.v === 1) z = -z;
  return [x, y, z];
}

export function tryParseSno(content: string): SnoObject | null {
  try {
    return parseSno(content);
  } catch {
    return null;
  }
}
