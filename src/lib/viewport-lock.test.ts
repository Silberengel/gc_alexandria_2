import { describe, expect, it } from 'vitest';
import { APP_VIEWPORT_CONTENT } from './viewport-lock';

describe('viewport-lock', () => {
  it('locks pinch and focus zoom in the viewport meta content', () => {
    expect(APP_VIEWPORT_CONTENT).toContain('maximum-scale=1');
    expect(APP_VIEWPORT_CONTENT).toContain('user-scalable=no');
    expect(APP_VIEWPORT_CONTENT).toContain('viewport-fit=cover');
  });
});
