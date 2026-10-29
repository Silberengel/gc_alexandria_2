/**
 * Shelf scrollbar is hidden. Remap wheel/trackpad to horizontal scroll,
 * and allow click-drag with the mouse (not stylus — pen micro-jitter was
 * suppressing cover taps).
 */
export function shelfWheel(node: HTMLElement) {
  const maxScrollLeft = () => Math.max(0, node.scrollWidth - node.clientWidth);

  const onWheel = (e: WheelEvent) => {
    const maxScroll = maxScrollLeft();
    if (maxScroll <= 1) return;
    if (e.ctrlKey) return; // browser zoom
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    } else if (e.deltaMode === 2) {
      dx *= node.clientWidth;
      dy *= node.clientHeight;
    }
    if (dx === 0 && dy === 0) return;
    // Vertical-dominant gestures become horizontal shelf motion.
    const delta = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
    const prev = node.scrollLeft;
    const next = Math.min(maxScroll, Math.max(0, prev + delta));
    if (next === prev) return; // at end — let the page scroll
    node.scrollLeft = next;
    e.preventDefault();
  };

  let dragging = false;
  let moved = false;
  let pointerId = -1;
  let startX = 0;
  let startScroll = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Finger uses native pan-x; stylus taps covers — only mouse drags the shelf.
    if (e.pointerType !== 'mouse') return;
    if (maxScrollLeft() <= 1) return;
    dragging = true;
    moved = false;
    pointerId = e.pointerId;
    startX = e.clientX;
    startScroll = node.scrollLeft;
    // Don't capture yet — allow clicks; capture after a real drag.
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!moved) {
      if (Math.abs(dx) < 6) return;
      moved = true;
      node.classList.add('shelf-track-dragging');
      try {
        node.setPointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    }
    node.scrollLeft = startScroll - dx;
    e.preventDefault();
  };

  const endPointer = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    node.classList.remove('shelf-track-dragging');
    if (moved) {
      // Suppress the click that would follow a drag on a cover link.
      const suppress = (ce: MouseEvent) => {
        ce.preventDefault();
        ce.stopPropagation();
      };
      node.addEventListener('click', suppress, { capture: true, once: true });
    }
    moved = false;
    pointerId = -1;
  };

  node.addEventListener('wheel', onWheel, { passive: false, capture: true });
  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', endPointer);
  node.addEventListener('pointercancel', endPointer);
  return {
    destroy() {
      node.removeEventListener('wheel', onWheel, true);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', endPointer);
      node.removeEventListener('pointercancel', endPointer);
    }
  };
}
