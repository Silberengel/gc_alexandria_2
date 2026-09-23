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
    expect(placeMenuPanel(anchor)).toEqual({ side: 'end', up: false });
  });

  it('opens start (rightward) when pinned near the left edge', () => {
    const anchor = {
      getBoundingClientRect: () => ({ left: 8, right: 48, top: 100, bottom: 140, width: 40, height: 40 })
    } as HTMLElement;
    expect(placeMenuPanel(anchor)).toEqual({ side: 'start', up: false });
  });

  it('opens upward near the bottom of the viewport', () => {
    const anchor = {
      getBoundingClientRect: () => ({ left: 200, right: 240, top: 720, bottom: 760, width: 40, height: 40 })
    } as HTMLElement;
    expect(placeMenuPanel(anchor).up).toBe(true);
  });
});
