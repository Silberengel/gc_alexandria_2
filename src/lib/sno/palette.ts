/** Built-in cyberspace-neon-256 stand-in: 24×8 OKLCH-ish ramps + steels + accents. */

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Cheap OKLCH→sRGB approximation good enough for a viewer accent palette. */
function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  // Soft clip by lowering chroma-ish channels
  const max = Math.max(r, g, bl, 1e-6);
  if (max > 1) {
    r /= max;
    g /= max;
    bl /= max;
  }
  return [clampByte(r * 255), clampByte(g * 255), clampByte(bl * 255)];
}

function buildBuiltin(): Uint8Array {
  const out = new Uint8Array(256 * 3);
  let i = 0;
  for (let hue = 0; hue < 24; hue++) {
    for (let step = 0; step < 8; step++) {
      const L = 0.28 + step * 0.08;
      const C = 0.08 + (step < 6 ? 0.12 : 0.06);
      const [r, g, b] = oklchToRgb(L, C, hue * 15);
      out[i++] = r;
      out[i++] = g;
      out[i++] = b;
    }
  }
  for (let s = 0; s < 32; s++) {
    const v = clampByte(40 + s * 6);
    out[i++] = v;
    out[i++] = v;
    out[i++] = Math.min(255, v + 8);
  }
  const accents: Array<[number, number, number]> = [
    [255, 60, 90],
    [255, 140, 40],
    [255, 220, 60],
    [80, 220, 120],
    [40, 200, 220],
    [80, 120, 255],
    [180, 80, 255],
    [255, 80, 200]
  ];
  for (let s = 0; s < 32; s++) {
    const base = accents[s % accents.length]!;
    const t = (s / 32) * 0.55;
    out[i++] = clampByte(base[0] * (1 - t) + 30 * t);
    out[i++] = clampByte(base[1] * (1 - t) + 30 * t);
    out[i++] = clampByte(base[2] * (1 - t) + 40 * t);
  }
  while (i < 256 * 3) {
    out[i] = out[i % (192 * 3)]!;
    i++;
  }
  return out;
}

export const BUILTIN_PALETTE = buildBuiltin();

export function paletteRgb(palette: Uint8Array, index: number): [number, number, number] {
  const i = Math.max(0, Math.min(255, index | 0)) * 3;
  return [palette[i]!, palette[i + 1]!, palette[i + 2]!];
}

export function cssRgb(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}
