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

  it('treats hard HTTP 404 on nostr.build as missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
    await expect(isRemoteImageMissing('https://i.nostr.build/gone.webp')).resolves.toBe(true);
  });

  it('keeps reachable nostr.build images', async () => {
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
    await expect(isRemoteImageMissing('https://i.nostr.build/x.jpg')).resolves.toBe(false);
    expect(peekImageMissing('https://i.nostr.build/x.jpg')).toBeUndefined();
  });

  it('skips CORS probes for Gutenberg covers (no console spam)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const url = 'https://www.gutenberg.org/cache/epub/110/pg110.cover.medium.jpg';
    await expect(isRemoteImageMissing(url)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(peekImageMissing(url)).toBe(false);
  });
});
