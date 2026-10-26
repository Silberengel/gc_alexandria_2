import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPwaUpdate, pwaUpdateAvailable } from './pwa';

describe('applyPwaUpdate', () => {
  beforeEach(() => {
    pwaUpdateAvailable.set(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears the banner flag and reloads when no SW updater is registered', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    applyPwaUpdate();
    expect(get(pwaUpdateAvailable)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});
