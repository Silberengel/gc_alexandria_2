/**
 * Keep Alexandria at layout scale 1 on phones/tablets.
 *
 * Pinch / double-tap / focus-zoom was shrinking the visual viewport so the
 * flex TopBar + footer floated off-screen. Drawing full-screen already locked
 * scale; the same policy applies for the whole SPA.
 */

export const APP_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

function blockPinch(e: TouchEvent): void {
  if (e.touches.length > 1) e.preventDefault();
}

function blockGesture(e: Event): void {
  e.preventDefault();
}

/** Apply the locked viewport meta and suppress pinch / Safari gesture zoom. */
export function installViewportLock(): void {
  if (typeof document === 'undefined') return;

  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', APP_VIEWPORT_CONTENT);

  // Non-passive so preventDefault stops Chrome/Safari pinch-zoom.
  document.addEventListener('touchmove', blockPinch, { passive: false });
  document.addEventListener('gesturestart', blockGesture, { passive: false });
  document.addEventListener('gesturechange', blockGesture, { passive: false });
  document.addEventListener('gestureend', blockGesture, { passive: false });
}
