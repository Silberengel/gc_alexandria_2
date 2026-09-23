/**
 * Persistent image cache (covers + avatars).
 * Look up Cache Storage / memory first; on miss return the plain URL for `<img src>`.
 * We do not cors-fetch remote covers — Gutenberg/Wikimedia/etc. lack ACAO and spam the console.
 */

const CACHE_NAME = 'alexandria-images-v1';

/** url → object URL (same-session). */
const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function normalizeUrl(url: string): string {
  const t = url.trim();
  if (!t) return '';
  try {
    return new URL(t).href;
  } catch {
    return t;
  }
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function isInlineUrl(url: string): boolean {
  const t = url.trim();
  return t.startsWith('data:') || t.startsWith('blob:');
}

async function openImageCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function readCachedBlob(url: string): Promise<Blob | null> {
  const cache = await openImageCache();
  if (!cache) return null;
  try {
    const res = await cache.match(url);
    if (!res || !res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/** Sync hit from this session (instant cover/avatar paint after first load). */
export function peekCachedImageSrc(url: string): string | null {
  const key = normalizeUrl(url);
  if (!key) return null;
  if (isInlineUrl(key)) return key;
  return memory.get(key) ?? null;
}

/**
 * Prefer Cache Storage / memory; otherwise return the network URL.
 * Plain `<img src>` uses the browser HTTP cache without CORS.
 */
export async function cachedImageSrc(url: string): Promise<string> {
  const key = normalizeUrl(url);
  if (!key) return '';
  if (isInlineUrl(key)) return key;
  if (!isHttpUrl(key)) return key;

  const mem = memory.get(key);
  if (mem) return mem;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    try {
      const cached = await readCachedBlob(key);
      if (cached && cached.size > 0) {
        const obj = blobToObjectUrl(cached);
        memory.set(key, obj);
        return obj;
      }

      // Miss: paint from network via <img>; hydrate memory if Cache Storage already has it.
      void populateImageCache(key);
      return key;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

/**
 * Warm memory from Cache Storage only (no network cors fetch).
 */
export async function populateImageCache(url: string): Promise<void> {
  const key = normalizeUrl(url);
  if (!key || !isHttpUrl(key) || isInlineUrl(key)) return;
  if (memory.has(key)) return;

  try {
    const existing = await readCachedBlob(key);
    if (existing && existing.size > 0) {
      memory.set(key, blobToObjectUrl(existing));
    }
  } catch {
    /* ignore */
  }
}

/** Warm many cover/avatar URLs after a landing paint (non-blocking). */
export function prefetchImages(urls: Iterable<string>): void {
  const seen = new Set<string>();
  for (const raw of urls) {
    const key = normalizeUrl(raw);
    if (!key || !isHttpUrl(key) || seen.has(key)) continue;
    seen.add(key);
    if (memory.has(key)) continue;
    void populateImageCache(key);
  }
}

/** @internal tests */
export function resetImageCacheMemoryForTests(): void {
  for (const obj of memory.values()) {
    try {
      if (obj.startsWith('blob:')) URL.revokeObjectURL(obj);
    } catch {
      /* ignore */
    }
  }
  memory.clear();
  inflight.clear();
}
