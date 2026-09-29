/**
 * Detect remote cover/hero URLs that are gone even when the host returns HTTP 200
 * with a placeholder image (nostr.build sets `x-status: 404`).
 *
 * Only those hosts are CORS-probed. Gutenberg and most other cover CDNs omit
 * Access-Control-Allow-Origin — probing them floods the console and never helps
 * (plain `<img onerror>` is enough).
 */

const missingByUrl = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();
const MAX_MEMORY = 500;

/** Hosts that soft-404 with HTTP 200 + `x-status: 404` (must be readable via CORS). */
const SOFT_404_HOST_RE = /(^|\.)nostr\.build$/i;

function touchMissing(key: string, missing: boolean): void {
  if (missingByUrl.has(key)) missingByUrl.delete(key);
  missingByUrl.set(key, missing);
  while (missingByUrl.size > MAX_MEMORY) {
    const oldest = missingByUrl.keys().next().value;
    if (oldest == null) break;
    missingByUrl.delete(oldest);
  }
}

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

function needsCorsProbe(url: string): boolean {
  try {
    return SOFT_404_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Sync session memory — `true` = known missing, `false` = known ok, else unprobed. */
export function peekImageMissing(url: string): boolean | undefined {
  const key = normalizeUrl(url);
  if (!missingByUrl.has(key)) return undefined;
  const hit = missingByUrl.get(key)!;
  touchMissing(key, hit);
  return hit;
}

/**
 * `true` when the URL should not be shown (HTTP error or nostr.build soft-404).
 * Non-probe hosts and CORS/network failures return `false` so `<img onerror>` decides.
 */
export async function isRemoteImageMissing(url: string): Promise<boolean> {
  const key = normalizeUrl(url);
  if (!key || !isHttpUrl(key)) return false;
  if (missingByUrl.has(key)) {
    const hit = missingByUrl.get(key)!;
    touchMissing(key, hit);
    return hit;
  }

  // Skip Gutenberg / imwald / etc. — CORS probe only creates console noise.
  if (!needsCorsProbe(key)) {
    touchMissing(key, false);
    return false;
  }

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
      touchMissing(key, missing);
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
