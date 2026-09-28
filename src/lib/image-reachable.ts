/**
 * Detect remote cover/hero URLs that are gone even when the host returns HTTP 200
 * with a placeholder image (nostr.build sets `x-status: 404`).
 */

const missingByUrl = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();

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
  return /^https?:\/\//i.test(url);
}

/** Sync session memory — `true` = known missing, `false` = known ok, else unprobed. */
export function peekImageMissing(url: string): boolean | undefined {
  return missingByUrl.get(normalizeUrl(url));
}

/**
 * `true` when the URL should not be shown (HTTP error or nostr.build soft-404).
 * CORS/network failures return `false` so `<img onerror>` can still decide.
 */
export async function isRemoteImageMissing(url: string): Promise<boolean> {
  const key = normalizeUrl(url);
  if (!key || !isHttpUrl(key)) return false;
  if (missingByUrl.has(key)) return missingByUrl.get(key)!;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    try {
      let res = await fetch(key, { method: 'HEAD', mode: 'cors', redirect: 'follow' });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(key, {
          method: 'GET',
          mode: 'cors',
          redirect: 'follow',
          headers: { Range: 'bytes=0-0' }
        });
      }
      const soft404 = res.headers.get('x-status')?.trim() === '404';
      const missing = !res.ok || soft404;
      missingByUrl.set(key, missing);
      return missing;
    } catch {
      return false;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

/** @internal tests */
export function resetImageReachableForTests(): void {
  missingByUrl.clear();
  inflight.clear();
}
