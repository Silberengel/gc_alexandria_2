/**
 * Stylus / Mark-mode text selection for reading panes.
 *
 * Browsers often treat a pen drag as a scroll or a tiny caret hop, which makes
 * highlighting longform text miserable. While the pointer is a pen (always) or
 * any pointer in Mark mode, drag across the pane to grow a real Selection.
 * Double-tap selects the word under the tip.
 *
 * Pen claims the gesture on pointerdown (preventDefault) so page scroll cannot
 * cancel mid-drag. Finger/mouse only claim in Mark mode.
 */

const DRAG_PX = 5;
const DOUBLE_TAP_MS = 380;
const SKIP =
  'a, button, input, textarea, select, label, [role="button"], .sel-tray, .toc, .toc-fab, .cover-frame, .cover-frame-zoomable, .reader-mini-dialog, .draw-overlay';

export type ReaderPenSelectOpts = {
  /** When true, finger/mouse drag also selects (Mark mode). Pen always selects. */
  markMode: () => boolean;
};

function caretRangeAtPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretRangeFromPoint === 'function') {
    return doc.caretRangeFromPoint(x, y);
  }
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (!pos?.offsetNode) return null;
  const range = document.createRange();
  try {
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  } catch {
    return null;
  }
}

function applyRange(from: Range, to: Range): void {
  const sel = window.getSelection();
  if (!sel) return;
  try {
    const range = document.createRange();
    if (from.compareBoundaryPoints(Range.START_TO_START, to) <= 0) {
      range.setStart(from.startContainer, from.startOffset);
      range.setEnd(to.startContainer, to.startOffset);
    } else {
      range.setStart(to.startContainer, to.startOffset);
      range.setEnd(from.startContainer, from.startOffset);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* cross-node edges */
  }
}

function selectWordAtPoint(x: number, y: number): boolean {
  const start = caretRangeAtPoint(x, y);
  if (!start) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  try {
    sel.removeAllRanges();
    sel.addRange(start);
    const modify = (
      sel as Selection & {
        modify?: (alter: string, direction: string, granularity: string) => void;
      }
    ).modify;
    if (typeof modify === 'function') {
      modify.call(sel, 'move', 'backward', 'word');
      modify.call(sel, 'extend', 'forward', 'word');
    }
    return (sel.toString()?.trim().length ?? 0) > 0;
  } catch {
    return false;
  }
}

function shouldHandlePointer(e: PointerEvent, markMode: boolean): boolean {
  if (e.pointerType === 'pen') return true;
  if (!markMode) return false;
  if (e.pointerType === 'mouse' && e.button !== 0) return false;
  return e.pointerType === 'touch' || e.pointerType === 'mouse';
}

/**
 * Attach pen/Mark-mode drag-select to a reading root. Returns a disposer.
 */
export function attachReaderPenSelect(
  root: HTMLElement,
  opts: ReaderPenSelectOpts
): () => void {
  let pointerId: number | null = null;
  let anchor: Range | null = null;
  let selecting = false;
  let startX = 0;
  let startY = 0;
  let lastTapAt = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  const onDown = (e: PointerEvent): void => {
    if (!shouldHandlePointer(e, opts.markMode())) return;
    const t = e.target;
    if (!(t instanceof Node) || !root.contains(t)) return;
    if (t instanceof Element && t.closest(SKIP)) return;

    const now = Date.now();
    const nearLast =
      Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 28 &&
      now - lastTapAt < DOUBLE_TAP_MS;
    if (nearLast && e.pointerType === 'pen') {
      if (selectWordAtPoint(e.clientX, e.clientY)) {
        e.preventDefault();
        lastTapAt = 0;
        return;
      }
    }
    lastTapAt = now;
    lastTapX = e.clientX;
    lastTapY = e.clientY;

    const start = caretRangeAtPoint(e.clientX, e.clientY);
    if (!start || !root.contains(start.startContainer)) return;

    pointerId = e.pointerId;
    anchor = start.cloneRange();
    selecting = false;
    startX = e.clientX;
    startY = e.clientY;
    // Claim pen (and Mark-mode finger) before the scroll container steals the gesture.
    e.preventDefault();
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (pointerId === null || e.pointerId !== pointerId || !anchor) return;
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (!selecting) {
      if (dist < DRAG_PX) return;
      selecting = true;
      lastTapAt = 0;
    }
    e.preventDefault();
    const end = caretRangeAtPoint(e.clientX, e.clientY);
    if (!end || !root.contains(end.startContainer)) return;
    applyRange(anchor, end);
  };

  const onUp = (e: PointerEvent): void => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    pointerId = null;
    anchor = null;
    selecting = false;
    try {
      root.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  root.addEventListener('pointerdown', onDown, { passive: false });
  root.addEventListener('pointermove', onMove, { passive: false });
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);

  return () => {
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
  };
}
