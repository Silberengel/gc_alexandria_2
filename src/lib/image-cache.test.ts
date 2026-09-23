import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cachedImageSrc,
  peekCachedImageSrc,
  populateImageCache,
  resetImageCacheMemoryForTests
} from './image-cache';

describe('image-cache', () => {
  afterEach(() => {
    resetImageCacheMemoryForTests();
    vi.unstubAllGlobals();
  });

  it('returns inline urls unchanged', async () => {
    expect(await cachedImageSrc('data:image/png;base64,aa')).toBe('data:image/png;base64,aa');
    expect(await cachedImageSrc('blob:https://example.com/1')).toBe('blob:https://example.com/1');
  });

  it('serves a Cache Storage hit as a blob url and peeks sync after', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const blob = new Blob([png], { type: 'image/png' });
    const store = new Map<string, Response>();
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (url: string) => store.get(url) ?? null,
        put: async (url: string, res: Response) => {
          store.set(url, res);
        },
        keys: async () => [...store.keys()].map((u) => new Request(u)),
        delete: async (req: Request) => store.delete(req.url)
      })
    });
    store.set(
      'https://cdn.example/cover.jpg',
      new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } })
    );

    const src = await cachedImageSrc('https://cdn.example/cover.jpg');
    expect(src.startsWith('blob:')).toBe(true);
    expect(peekCachedImageSrc('https://cdn.example/cover.jpg')).toBe(src);
  });

  it('on miss returns the network url without a cors fetch', async () => {
    const store = new Map<string, Response>();
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (url: string) => store.get(url) ?? null,
        put: async (url: string, res: Response) => {
          store.set(url, res);
        },
        keys: async () => [...store.keys()].map((u) => new Request(u)),
        delete: async (req: Request) => store.delete(req.url)
      })
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const first = await cachedImageSrc('https://cdn.example/miss.jpg');
    expect(first).toBe('https://cdn.example/miss.jpg');
    await populateImageCache('https://cdn.example/miss.jpg');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.has('https://cdn.example/miss.jpg')).toBe(false);
  });
});
