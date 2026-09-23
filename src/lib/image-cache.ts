/**
 * Persistent image cache (covers + avatars).
 * Look up Cache Storage / memory first; on miss fetch once, store, and reuse a blob: URL.
 */

const CACHE_NAME = 'alexandria-images-v1';
const MAX_ENTRIES = 500;
const MAX_BYTES_PER_FILE = 2.5 * 1024 * 1024;

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

async function storeBlob(url: string, res: Response): Promise<void> {
  const cache = await openImageCache();
  if (!cache) return;
  try {
    const clone = res.clone();
    const buf = await clone.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES_PER_FILE) return;
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/') && type !== 'application/octet-stream') return;
    await cache.put(
      url,
      new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(buf.byteLength),
          'X-Alexandria-Cached': String(Date.now())
        }
      })
    );
    void trimCache(cache);
  } catch {
    /* quota / opaque */
  }
}

async function trimCache(cache: Cache): Promise<void> {
  try {
    const keys = await cache.keys();
    if (keys.length <= MAX_ENTRIES) return;
    const drop = keys.length - MAX_ENTRIES;
    for (let i = 0; i < drop; i++) {
      const req = keys[i];
      if (req) await cache.delete(req);
    }
  } catch {
    /* ignore */
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
 * Prefer Cache Storage / memory; otherwise return the network URL and fill the cache
 * in the background so the next refresh is instant.
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

      // Miss: paint from network now; populate disk cache for the next visit.
      void populateImageCache(key);
      return key;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

/** Fetch and store without blocking the first paint. */
export async function populateImageCache(url: string): Promise<void> {
  const key = normalizeUrl(url);
  if (!key || !isHttpUrl(key) || isInlineUrl(key)) return;
  if (memory.has(key)) return;

  try {
    const existing = await readCachedBlob(key);
    if (existing && existing.size > 0) {
      memory.set(key, blobToObjectUrl(existing));
      return;
    }

    const res = await fetch(key, {
      mode: 'cors',
      credentials: 'omit',
      signal: AbortSignal.timeout(12_000)
    });
    if (!res.ok) return;
    await storeBlob(key, res);
    const blob = await readCachedBlob(key);
    if (blob && blob.size > 0) memory.set(key, blobToObjectUrl(blob));
  } catch {
    // CORS/CDN failures — browser HTTP cache may still help a plain <img src>.
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
