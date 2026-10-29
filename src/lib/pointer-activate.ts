/**
 * Stylus-safe button activation.
 *
 * Never `preventDefault` on `pointerdown` and then rely only on `click` —
 * many Android/Samsung WebViews drop the synthetic click for pen. Fire the
 * action on pointerdown and absorb the follow-up click.
 */

export type PointerArm = {
  /** Run on pointerdown (does not cancel the event). */
  run: (e: PointerEvent, fn: () => void) => void;
  /** Run on pointerdown and preventDefault — keeps focus in a sibling field. */
  runKeepFocus: (e: PointerEvent, fn: () => void) => void;
  /** Call from onclick — no-ops if already ran on pointerdown. */
  absorbClick: (e: MouseEvent, fallback?: () => void) => void;
};

export function createPointerArm(): PointerArm {
  let armedPointerId: number | null = null;

  function arm(e: PointerEvent, fn: () => void, keepFocus: boolean): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (keepFocus) e.preventDefault();
    armedPointerId = e.pointerId;
    fn();
  }

  return {
    run(e, fn) {
      arm(e, fn, false);
    },
    runKeepFocus(e, fn) {
      arm(e, fn, true);
    },
    absorbClick(e, fallback) {
      if (armedPointerId != null) {
        e.preventDefault();
        e.stopPropagation();
        armedPointerId = null;
        return;
      }
      fallback?.();
    }
  };
}

/** True when the user has a non-empty text selection (optionally inside a root). */
export function hasNonEmptySelection(within?: Node | null): boolean {
  if (typeof window === 'undefined') return false;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return false;
  if (!sel.toString().trim()) return false;
  if (!within) return true;
  const n = sel.anchorNode;
  return !!(n && within.contains(n));
}
