/** Prefer opening a dropdown so it stays inside the viewport. */
export type MenuPlacement = {
  /** Align menu's right edge to the anchor (end) or left edge (start). */
  side: 'end' | 'start';
  /** Open upward when there isn't room below. */
  up: boolean;
  /** Viewport top for `position: fixed` panels. */
  top: number;
  /** Viewport left for `position: fixed` panels. */
  left: number;
};

const MENU_MIN_W = 200;
const MENU_EST_H = 160;
const PAD = 8;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max));
}

export function placeMenuPanel(anchor: HTMLElement, opts?: { width?: number; height?: number }): MenuPlacement {
  const r = anchor.getBoundingClientRect();
  const w = opts?.width ?? MENU_MIN_W;
  const h = opts?.height ?? MENU_EST_H;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const roomLeft = r.right - PAD;
  const roomRight = vw - r.left - PAD;
  let side: 'end' | 'start';
  if (roomLeft >= w) side = 'end';
  else if (roomRight >= w) side = 'start';
  else side = roomLeft >= roomRight ? 'end' : 'start';

  const roomBelow = vh - r.bottom - PAD;
  const roomAbove = r.top - PAD;
  const up = roomBelow < h && roomAbove > roomBelow;

  const rawTop = up ? r.top - PAD - h : r.bottom + PAD;
  const rawLeft = side === 'end' ? r.right - w : r.left;

  return {
    side,
    up,
    top: clamp(rawTop, PAD, Math.max(PAD, vh - h - PAD)),
    left: clamp(rawLeft, PAD, Math.max(PAD, vw - w - PAD))
  };
}
