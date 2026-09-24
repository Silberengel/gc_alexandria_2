import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { placeMenuPanel } from './menu-placement';

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
    const anchor = {
      getBoundingClientRect: () => ({ left: 320, right: 360, top: 100, bottom: 140, width: 40, height: 40 })
    } as HTMLElement;
    const place = placeMenuPanel(anchor);
    expect(place.side).toBe('end');
    expect(place.up).toBe(false);
    expect(place.left).toBe(160); // right 360 - width 200
    expect(place.top).toBe(148); // bottom 140 + pad 8
  });

  it('opens start (rightward) when pinned near the left edge', () => {
    const anchor = {
      getBoundingClientRect: () => ({ left: 8, right: 48, top: 100, bottom: 140, width: 40, height: 40 })
    } as HTMLElement;
    const place = placeMenuPanel(anchor);
    expect(place.side).toBe('start');
    expect(place.up).toBe(false);
    expect(place.left).toBe(8);
    expect(place.top).toBe(148);
  });

  it('opens upward near the bottom of the viewport', () => {
    const anchor = {
      getBoundingClientRect: () => ({ left: 200, right: 240, top: 720, bottom: 760, width: 40, height: 40 })
    } as HTMLElement;
    const place = placeMenuPanel(anchor);
    expect(place.up).toBe(true);
    expect(place.top).toBe(552); // top 720 - pad 8 - height 160
  });
});
