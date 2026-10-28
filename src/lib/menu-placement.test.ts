import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { placeMenuPanel } from './menu-placement';

function anchorRect(partial: {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width?: number;
  height?: number;
}): HTMLElement {
  const width = partial.width ?? partial.right - partial.left;
  const height = partial.height ?? partial.bottom - partial.top;
  return {
    getBoundingClientRect: () => ({ ...partial, width, height })
  } as HTMLElement;
}

describe('placeMenuPanel', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 400 });
    Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 800 });
    if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
    }
  });
  afterEach(() => {
    delete (globalThis as { innerWidth?: number }).innerWidth;
    delete (globalThis as { innerHeight?: number }).innerHeight;
  });

  it('opens end (leftward) when there is room on the left', () => {
    const place = placeMenuPanel(
      anchorRect({ left: 320, right: 360, top: 100, bottom: 140 }),
      { insetBottom: 8 }
    );
    expect(place.side).toBe('end');
    expect(place.up).toBe(false);
    expect(place.left).toBe(160); // right 360 - width 200
    expect(place.top).toBe(148); // bottom 140 + pad 8
  });

  it('opens start (rightward) when pinned near the left edge', () => {
    const place = placeMenuPanel(
      anchorRect({ left: 8, right: 48, top: 100, bottom: 140 }),
      { insetBottom: 8 }
    );
    expect(place.side).toBe('start');
    expect(place.left).toBe(8);
    expect(place.top).toBe(148);
  });

  it('opens upward near the bottom of the viewport', () => {
    const place = placeMenuPanel(
      anchorRect({ left: 200, right: 240, top: 720, bottom: 760 }),
      { height: 160, insetBottom: 8 }
    );
    expect(place.up).toBe(true);
    expect(place.top).toBe(552); // top 720 - pad 8 - height 160
    // Cap is the band from placed top down to the anchor gap (not the full viewport).
    expect(place.maxHeight).toBe(160);
    expect(place.top + place.maxHeight).toBe(720 - 8);
  });

  it('caps maxHeight to free space in the open direction', () => {
    Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 400 });
    const place = placeMenuPanel(
      anchorRect({ left: 200, right: 240, top: 300, bottom: 340 }),
      { height: 500, insetBottom: 8 }
    );
    expect(place.up).toBe(true);
    expect(place.maxHeight).toBe(300 - 8 - 8);
    expect(place.top).toBeGreaterThanOrEqual(8);
    expect(place.top + place.maxHeight).toBeLessThanOrEqual(300 - 8);
  });

  it('keeps a footer clearance below the panel', () => {
    Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 600 });
    const place = placeMenuPanel(
      anchorRect({ left: 40, right: 80, top: 200, bottom: 240 }),
      { height: 500, insetBottom: 64 }
    );
    expect(place.up).toBe(false);
    expect(place.maxHeight).toBe(600 - 64 - (240 + 8));
    expect(place.top).toBe(248);
    expect(place.top + place.maxHeight).toBeLessThanOrEqual(600 - 64);
  });

  it('never covers the anchor when space below is tight', () => {
    Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 500 });
    const place = placeMenuPanel(
      anchorRect({ left: 40, right: 80, top: 420, bottom: 460 }),
      { height: 300, insetBottom: 64 }
    );
    // spaceBelow = 500-64-(460+8)= -32 → 0; opens up into the larger band above
    expect(place.up).toBe(true);
    expect(place.top + place.maxHeight).toBeLessThanOrEqual(420 - 8);
    expect(place.top).toBeGreaterThanOrEqual(8);
  });
});
