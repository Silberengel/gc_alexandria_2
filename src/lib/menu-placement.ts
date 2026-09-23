/** Prefer opening a dropdown so it stays inside the viewport. */
export type MenuPlacement = {
  /** Align menu's right edge to the anchor (end) or left edge (start). */
  side: 'end' | 'start';
  /** Open upward when there isn't room below. */
  up: boolean;
};

const MENU_MIN_W = 200;
const MENU_EST_H = 160;
const PAD = 8;

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

  return { side, up };
}
