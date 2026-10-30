import { appScrollBy } from './app-scroll';

const EDGE_PAD_PX = 16;

function isEditable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'image', 'range', 'color'].includes(
      type
    );
  }
  return el.isContentEditable;
}

function focusedEditable(): HTMLElement | null {
  const el = document.activeElement;
  return isEditable(el) ? el : null;
}

/** Pixels of layout viewport covered from the bottom by the OS keyboard / stylus pad. */
export function keyboardInsetPx(): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
}

function syncKeyboardInsetCss(inset: number): void {
  document.documentElement.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
}

/**
 * Scroll the app scroll root so the focused field (or its top band) sits above
 * the OS keyboard / handwriting pad. Uses Visual Viewport — works when the pad
 * overlays without resizing layout.
 */
export function ensureFocusedEditableInView(): void {
  const inset = keyboardInsetPx();
  syncKeyboardInsetCss(inset);

  const el = focusedEditable();
  if (!el) return;

  const vv = window.visualViewport;
  const visibleTop = (vv?.offsetTop ?? 0) + EDGE_PAD_PX;
  const visibleBottom =
    (vv ? vv.offsetTop + vv.height : window.innerHeight) - Math.max(EDGE_PAD_PX, inset ? 8 : 0);

  const rect = el.getBoundingClientRect();
  // Tall textareas: keep a band near the top of the field (caret usually starts
  // there; full-box bottom may sit forever under a large pad).
  const aimBottom = Math.min(rect.bottom, rect.top + Math.min(rect.height, 120));

  if (aimBottom > visibleBottom) {
    appScrollBy(0, aimBottom - visibleBottom);
    return;
  }
  if (rect.top < visibleTop) {
    appScrollBy(0, rect.top - visibleTop);
  }
}

/**
 * Keep focused inputs/textareas above the system keyboard and stylus handwriting
 * pad. Call once at app boot (alongside viewport lock).
 */
export function installFocusInView(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  let raf = 0;
  const schedule = (): void => {
    cancelAnimationFrame(raf);
    // Double rAF: wait for the OS pad animation to update visualViewport.
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        ensureFocusedEditableInView();
      });
    });
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (isEditable(event.target instanceof Element ? event.target : null)) schedule();
  };

  document.addEventListener('focusin', onFocusIn);
  window.addEventListener('resize', schedule);
  const vv = window.visualViewport;
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);

  // Clear inset when nothing is focused / pad closed.
  document.addEventListener('focusout', () => {
    queueMicrotask(() => {
      if (!focusedEditable()) {
        syncKeyboardInsetCss(0);
      }
    });
  });

  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('focusin', onFocusIn);
    window.removeEventListener('resize', schedule);
    vv?.removeEventListener('resize', schedule);
    vv?.removeEventListener('scroll', schedule);
    syncKeyboardInsetCss(0);
  };
}
