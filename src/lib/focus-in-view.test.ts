import { describe, expect, it } from 'vitest';
import { keyboardInsetPx } from './focus-in-view';

describe('focus-in-view', () => {
  it('reports zero overlap when visualViewport fills the window', () => {
    // jsdom: no visualViewport → treated as no inset.
    expect(keyboardInsetPx()).toBe(0);
  });
});
