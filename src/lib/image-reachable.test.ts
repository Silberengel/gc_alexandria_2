import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRemoteImageMissing, peekImageMissing, resetImageReachableForTests } from './image-reachable';

afterEach(() => {
  resetImageReachableForTests();
  vi.unstubAllGlobals();
});

describe('isRemoteImageMissing', () => {
  it('treats nostr.build soft-404 (HTTP 200 + x-status 404) as missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(null, {
          status: 200,
          headers: { 'x-status': '404', 'content-type': 'image/jpeg' }
        })
      )
    );
    const url = 'https://i.nostr.build/missing.webp';
    await expect(isRemoteImageMissing(url)).resolves.toBe(true);
    expect(peekImageMissing(url)).toBe(true);
  });

  it('treats hard HTTP 404 as missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
    await expect(isRemoteImageMissing('https://example.com/cover.jpg')).resolves.toBe(true);
  });

  it('keeps reachable images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' }
        })
      )
    );
    const url = 'https://i.nostr.build/ok.webp';
    await expect(isRemoteImageMissing(url)).resolves.toBe(false);
    expect(peekImageMissing(url)).toBe(false);
  });

  it('does not mark missing when fetch fails (CORS) — leave to img onerror', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(isRemoteImageMissing('https://blocked.example/x.jpg')).resolves.toBe(false);
    expect(peekImageMissing('https://blocked.example/x.jpg')).toBeUndefined();
  });
});
