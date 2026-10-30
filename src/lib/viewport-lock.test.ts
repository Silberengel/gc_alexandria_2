import { describe, expect, it } from 'vitest';
import { APP_VIEWPORT_CONTENT } from './viewport-lock';

describe('viewport-lock', () => {
  it('locks pinch and focus zoom in the viewport meta content', () => {
    expect(APP_VIEWPORT_CONTENT).toContain('maximum-scale=1');
    expect(APP_VIEWPORT_CONTENT).toContain('user-scalable=no');
    expect(APP_VIEWPORT_CONTENT).toContain('viewport-fit=cover');
    expect(APP_VIEWPORT_CONTENT).toContain('interactive-widget=resizes-content');
  });
});

describe('keyboardInsetPx', () => {
  it('is exported for focus-in-view (smoke)', async () => {
    const { keyboardInsetPx } = await import('./focus-in-view');
    expect(typeof keyboardInsetPx()).toBe('number');
  });
});
