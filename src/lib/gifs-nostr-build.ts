/**
 * gifs.nostr.build search client (matches imwald-android NostrBuildGif*).
 * Search tab identifies with Bearer gnb_… via same-origin `/api/gifs` proxy
 * (native clients call the API host directly and never send Origin).
 */

export const GIFS_NOSTR_BUILD_HOST = 'gifs.nostr.build';
export const GIFS_NOSTR_BUILD_MEDIA_ORIGIN = 'https://gifs.nostr.build/';
export const GIFS_NOSTR_BUILD_ATTRIBUTION_URL = 'https://nostr.build';
/** Upstream API; browser uses {@link GIFS_NOSTR_BUILD_API_BASE} (same-origin proxy). */
export const GIFS_NOSTR_BUILD_UPSTREAM_API = 'https://gifs.nostr.build/api/v1';
/**
 * Same-origin proxy path (Vite + nginx/Apache). Avoids CORS; Authorization is
 * injected server-side from `GIFS_NOSTR_BUILD_API_KEY`.
 */
export const GIFS_NOSTR_BUILD_API_BASE =
  (import.meta.env.VITE_GIFS_NOSTR_BUILD_API_BASE as string | undefined)?.trim() ||
  '/api/gifs';

export const GIFS_STARTER_QUERIES = [
  'gm',
  'lol',
  'yes',
  'wow',
  'applause',
  'facepalm',
  'love',
  'fire'
] as const;

export const GIFS_QUERY_MAX_CHARS = 500;
export const GIFS_QUERY_DEBOUNCE_MS = 250;
export const GIFS_REQUEST_TIMEOUT_MS = 15_000;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export type NostrBuildGifPreview = {
  width: number;
  height: number;
  animated?: string | null;
  still?: string | null;
};

export type NostrBuildGif = {
  id: string;
  url: string;
  width: number;
  height: number;
  frames?: number | null;
  duration?: number | null;
  bytes?: number | null;
  format?: string;
  title?: string;
  tags?: string[];
  lqip?: string | null;
  mp4: string;
  transparency?: number;
  webm?: string | null;
  hevc?: string | null;
  previews?: {
    small?: NostrBuildGifPreview | null;
    medium?: NostrBuildGifPreview | null;
    w240?: NostrBuildGifPreview | null;
    w480?: NostrBuildGifPreview | null;
  };
};

export type NostrBuildGifSuggestTerm = {
  term: string;
  kind?: string | null;
  n?: number;
  fuzzy?: boolean | null;
};

export type NostrBuildGifSearchResponse = {
  build?: string;
  gen?: number;
  q?: string;
  semantic?: boolean;
  count?: number;
  offset?: number;
  limit?: number;
  items: NostrBuildGif[];
};

export type NostrBuildGifsError =
  | { kind: 'missing_key'; message: string }
  | { kind: 'validation'; message: string }
  | { kind: 'not_registered'; message: string }
  | { kind: 'rate_limited'; message: string; retryAfterSeconds: number }
  | { kind: 'unavailable'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'other'; message: string };

export type NostrBuildGifsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: NostrBuildGifsError };

/** Trim, collapse whitespace, lowercase, cut at MAX on a code-point boundary. */
export function normalizeGifQuery(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  const chars = [...collapsed];
  if (chars.length <= GIFS_QUERY_MAX_CHARS) return collapsed;
  return chars.slice(0, GIFS_QUERY_MAX_CHARS).join('');
}

function isEmojiCodePoint(cp: number): boolean {
  if (cp >= 0x1f300 && cp <= 0x1faff) return true;
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true;
  if (cp >= 0x2600 && cp <= 0x27bf) return true;
  if (cp === 0xfe0f || cp === 0x200d) return true;
  return false;
}

export function gifQueryHasLetterDigitOrEmoji(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x30 && cp <= 0x39) ||
      (cp >= 0x41 && cp <= 0x5a) ||
      (cp >= 0x61 && cp <= 0x7a) ||
      /\p{L}|\p{N}/u.test(ch) ||
      isEmojiCodePoint(cp)
    ) {
      return true;
    }
  }
  return false;
}

function isSingleLatinLetter(text: string): boolean {
  return text.length === 1 && /[a-z]/i.test(text);
}

/** Whether a normalised query should hit `/search` (integration guide §5). */
export function shouldSearchGifQuery(normalised: string): boolean {
  if (!normalised) return false;
  if (!gifQueryHasLetterDigitOrEmoji(normalised)) return false;
  if (isSingleLatinLetter(normalised)) return false;
  return true;
}

export function mimeFromGifFormat(format: string | undefined): string {
  return format?.trim().toLowerCase() === 'webp' ? 'image/webp' : 'image/gif';
}

export function isValidGifsMediaUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  return url.startsWith(GIFS_NOSTR_BUILD_MEDIA_ORIGIN);
}

export function isValidGifsVideoUrl(url: string | null | undefined): boolean {
  if (!isValidGifsMediaUrl(url)) return false;
  return !url!.includes('#');
}

/** Reaction-clip `x` from `<sha256>.<ext>` id or URL path. */
export function sha256OfNostrBuildGif(gif: NostrBuildGif): string | undefined {
  const fromFileName = (name: string): string | undefined => {
    const stem = name.replace(/\.[^.]+$/, '').trim().toLowerCase();
    return SHA256_HEX.test(stem) ? stem : undefined;
  };
  const fromId = fromFileName(gif.id.trim());
  if (fromId) return fromId;
  try {
    const path = new URL(gif.url.trim()).pathname.split('/').pop() ?? '';
    return fromFileName(path);
  } catch {
    return undefined;
  }
}

/** NIP-92 imeta for a hosted pick — never rewrite the URL. */
export function imetaFromNostrBuildGif(gif: NostrBuildGif): string[] {
  const parts = [
    'imeta',
    `url ${gif.url.trim()}`,
    `m ${mimeFromGifFormat(gif.format)}`
  ];
  const hash = sha256OfNostrBuildGif(gif);
  if (hash) parts.push(`x ${hash}`);
  if (gif.width > 0 && gif.height > 0) parts.push(`dim ${gif.width}x${gif.height}`);
  if (gif.bytes != null && gif.bytes > 0) parts.push(`size ${gif.bytes}`);
  const title = (gif.title ?? '').trim();
  if (title) parts.push(`alt ${title}`);
  return parts;
}

/** Prefer animated w240/w480 preview for grid tiles. */
export function previewUrlForNostrBuildGif(
  gif: NostrBuildGif,
  viewportWide = false
): string {
  const previews = gif.previews;
  const preferred = viewportWide
    ? previews?.w480 ?? previews?.w240
    : previews?.w240 ?? previews?.w480;
  const animated = preferred?.animated?.trim();
  if (animated && isValidGifsMediaUrl(animated)) return animated;
  const still = preferred?.still?.trim();
  if (still && isValidGifsMediaUrl(still)) return still;
  return gif.url.trim();
}

function mapHttpError(
  status: number,
  body: string,
  retryAfterHeader: string | null
): NostrBuildGifsError {
  let detail: { code?: string; message?: string } | undefined;
  try {
    detail = (JSON.parse(body) as { error?: { code?: string; message?: string } }).error;
  } catch {
    detail = undefined;
  }
  const message = detail?.message?.trim();
  if (status === 400) {
    return { kind: 'validation', message: message || 'Bad request' };
  }
  if (status === 403) {
    if (detail?.code === 'adult_not_allowed') {
      return { kind: 'validation', message: message || 'Adult content is not allowed' };
    }
    return {
      kind: 'not_registered',
      message: message || 'GIF search key is not registered yet'
    };
  }
  if (status === 404) {
    return { kind: 'not_found', message: message || 'Not found' };
  }
  if (status === 429) {
    const retry = Math.max(1, Number(retryAfterHeader) || 60);
    return {
      kind: 'rate_limited',
      message: 'Too many searches, wait a minute',
      retryAfterSeconds: retry
    };
  }
  if (status === 503) {
    return { kind: 'unavailable', message: message || 'Search is unavailable right now' };
  }
  return { kind: 'other', message: message || `HTTP ${status}` };
}

export function nostrBuildGifsErrorMessage(error: NostrBuildGifsError): string {
  switch (error.kind) {
    case 'missing_key':
      return 'GIF search needs GIFS_NOSTR_BUILD_API_KEY on the server (or Vite proxy).';
    case 'rate_limited':
      return error.message;
    case 'not_registered':
      return 'GIF search key is not registered yet (wait a few minutes after creating it)';
    default:
      return error.message;
  }
}

const searchCache = new Map<string, NostrBuildGifSearchResponse>();
const suggestCache = new Map<string, NostrBuildGifSuggestTerm[]>();
const searchInflight = new Map<string, Promise<NostrBuildGifsResult<NostrBuildGifSearchResponse>>>();
const suggestInflight = new Map<string, Promise<NostrBuildGifsResult<NostrBuildGifSuggestTerm[]>>>();

async function getJson<T>(
  pathAndQuery: string,
  parse: (body: string) => T
): Promise<NostrBuildGifsResult<T>> {
  const base = GIFS_NOSTR_BUILD_API_BASE.replace(/\/+$/, '');
  const url = `${base}/${pathAndQuery.replace(/^\//, '')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GIFS_REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
    } catch {
      // One network retry (matches Android), then unavailable.
      await new Promise((r) => setTimeout(r, 1000));
      const retry = new AbortController();
      const retryTimer = setTimeout(() => retry.abort(), GIFS_REQUEST_TIMEOUT_MS);
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: retry.signal
        });
      } catch {
        return {
          ok: false,
          error: { kind: 'unavailable', message: 'Search is unavailable right now' }
        };
      } finally {
        clearTimeout(retryTimer);
      }
    }
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      // Proxy may return 502/403 when key missing; treat empty key responses carefully.
      if (!body && res.status === 401) {
        return {
          ok: false,
          error: {
            kind: 'missing_key',
            message: 'GIF search API key required'
          }
        };
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        error: mapHttpError(res.status, body, res.headers.get('Retry-After'))
      };
    }
    try {
      return { ok: true, value: parse(body) };
    } catch {
      return { ok: false, error: { kind: 'other', message: 'Bad response' } };
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function searchNostrBuildGifs(
  rawQuery: string
): Promise<NostrBuildGifsResult<NostrBuildGifSearchResponse>> {
  const q = normalizeGifQuery(rawQuery);
  if (!shouldSearchGifQuery(q)) {
    return { ok: false, error: { kind: 'validation', message: 'Query too short or empty' } };
  }
  const cached = searchCache.get(q);
  if (cached) return { ok: true, value: cached };
  const pending = searchInflight.get(q);
  if (pending) return pending;

  const job = (async () => {
    const result = await getJson(
      `search?q=${encodeURIComponent(q)}&limit=200`,
      (body) => {
        const parsed = JSON.parse(body) as NostrBuildGifSearchResponse;
        const raw = Array.isArray(parsed.items) ? parsed.items : [];
        return { ...parsed, items: dedupeNostrBuildGifs(raw) };
      }
    );
    if (result.ok) searchCache.set(q, result.value);
    return result;
  })();

  searchInflight.set(q, job);
  try {
    return await job;
  } finally {
    searchInflight.delete(q);
  }
}

export async function suggestNostrBuildGifs(
  rawQuery: string
): Promise<NostrBuildGifsResult<NostrBuildGifSuggestTerm[]>> {
  const q = normalizeGifQuery(rawQuery);
  if (!q || !gifQueryHasLetterDigitOrEmoji(q)) {
    return { ok: true, value: [] };
  }
  const cached = suggestCache.get(q);
  if (cached) return { ok: true, value: cached };
  const pending = suggestInflight.get(q);
  if (pending) return pending;

  const job = (async () => {
    const result = await getJson(`suggest?q=${encodeURIComponent(q)}`, (body) => {
      const parsed = JSON.parse(body) as { terms?: NostrBuildGifSuggestTerm[] };
      return Array.isArray(parsed.terms) ? parsed.terms : [];
    });
    if (result.ok) suggestCache.set(q, result.value);
    return result;
  })();

  suggestInflight.set(q, job);
  try {
    return await job;
  } finally {
    suggestInflight.delete(q);
  }
}

/** Deduplicate suggest terms; prefer non-fuzzy when any exist. */
export function tidySuggestTerms(
  terms: readonly NostrBuildGifSuggestTerm[],
  normalisedQuery: string
): NostrBuildGifSuggestTerm[] {
  const q = normalisedQuery.trim().toLowerCase();
  const filtered = terms.filter((t) => {
    const term = t.term.trim();
    return term && term.toLowerCase() !== q;
  });
  const nonFuzzy = filtered.filter((t) => t.fuzzy !== true);
  const source = nonFuzzy.length ? nonFuzzy : filtered;
  const deduped = new Map<string, NostrBuildGifSuggestTerm>();
  for (const t of source) {
    const key = t.term.trim().toLowerCase();
    if (!deduped.has(key)) deduped.set(key, t);
  }
  return [...deduped.values()];
}

function normalizeGifMediaUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Deduplicate Search results by normalized URL, then by media sha256 (`x`).
 * First occurrence wins (API order). Same blob under two CDN paths collapses to one.
 */
export function dedupeNostrBuildGifs(items: readonly NostrBuildGif[]): NostrBuildGif[] {
  const byUrl = new Map<string, NostrBuildGif>();
  for (const item of items) {
    const url = item.url?.trim();
    if (!url) continue;
    const key = normalizeGifMediaUrl(url);
    if (!byUrl.has(key)) byUrl.set(key, item);
  }
  const out: NostrBuildGif[] = [];
  const byHash = new Map<string, number>();
  for (const item of byUrl.values()) {
    const hash = sha256OfNostrBuildGif(item);
    if (!hash) {
      out.push(item);
      continue;
    }
    const idx = byHash.get(hash);
    if (idx == null) {
      byHash.set(hash, out.length);
      out.push(item);
    }
    // First wins — keep API ranking for the first URL of this hash.
  }
  return out;
}
