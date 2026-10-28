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
  /** Cap panel height when content would exceed the viewport. */
  maxHeight: number;
};

const MENU_MIN_W = 200;
/** Default estimate; callers with tall menus should pass measured height. */
const MENU_EST_H = 280;
const PAD = 8;
/** Fallback when `.site-footer` is missing — ≈ footer control row + gap. */
const FOOTER_FALLBACK = 56;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max));
}

/** Space to keep clear above the sticky app footer (or viewport bottom). */
export function menuBottomClearance(): number {
  if (typeof document === 'undefined') return FOOTER_FALLBACK + PAD;
  const el = document.querySelector('.site-footer');
  if (!(el instanceof HTMLElement)) return FOOTER_FALLBACK + PAD;
  const h = el.getBoundingClientRect().height;
  return Math.max(FOOTER_FALLBACK, Math.ceil(h)) + PAD;
}

/**
 * Place a fixed menu so it stays in the viewport, clears the footer, and never
 * covers its anchor (so the trigger stays clickable to dismiss).
 */
export function placeMenuPanel(
  anchor: HTMLElement,
  opts?: { width?: number; height?: number; insetBottom?: number; insetTop?: number }
): MenuPlacement {
  const r = anchor.getBoundingClientRect();
  const w = opts?.width ?? MENU_MIN_W;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const estH = opts?.height ?? MENU_EST_H;
  const insetTop = opts?.insetTop ?? PAD;
  const insetBottom = opts?.insetBottom ?? menuBottomClearance();
  const gap = PAD;

  const roomLeft = r.right - PAD;
  const roomRight = vw - r.left - PAD;
  let side: 'end' | 'start';
  if (roomLeft >= w) side = 'end';
  else if (roomRight >= w) side = 'start';
  else side = roomLeft >= roomRight ? 'end' : 'start';

  // Free bands that leave a gap between the panel and the anchor.
  const spaceBelow = Math.max(0, vh - insetBottom - (r.bottom + gap));
  const spaceAbove = Math.max(0, r.top - gap - insetTop);
  const up = spaceBelow < Math.min(estH, 160) && spaceAbove > spaceBelow;

  const avail = up ? spaceAbove : spaceBelow;
  // Never invent more height than fits — a fake min height + clamp was covering the button.
  const maxHeight = Math.max(1, avail);
  const h = Math.min(estH, maxHeight);

  let top: number;
  if (up) {
    // Bottom edge of panel stays at or above (anchor.top - gap).
    top = r.top - gap - h;
    top = clamp(top, insetTop, Math.max(insetTop, r.top - gap - h));
    if (top + h > r.top - gap) top = Math.max(insetTop, r.top - gap - h);
  } else {
    // Top edge of panel stays at or below (anchor.bottom + gap).
    top = r.bottom + gap;
    const maxTop = Math.max(r.bottom + gap, vh - insetBottom - h);
    top = clamp(top, r.bottom + gap, maxTop);
    if (top < r.bottom + gap) top = r.bottom + gap;
  }

  // Final height cap from the placed top so overflow:auto never grows over the anchor.
  const heightCap = up
    ? Math.max(1, r.top - gap - top)
    : Math.max(1, vh - insetBottom - top);

  const rawLeft = side === 'end' ? r.right - w : r.left;

  return {
    side,
    up,
    top,
    left: clamp(rawLeft, PAD, Math.max(PAD, vw - w - PAD)),
    maxHeight: Math.min(maxHeight, heightCap)
  };
}
