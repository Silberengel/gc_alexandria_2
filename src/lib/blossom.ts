import { cleanTrackingUrl } from './clean-url';

export const BLOSSOM_PRESET_SERVERS = [
  'https://0x0.oslim.dev',
  'https://blossom.band',
  'https://blossom.primal.net',
  'https://nostr.media',
  'https://blossom.nostr.build',
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const HEX_PUBKEY = /^[a-f0-9]{64}$/;

/** BUD-10 `blossom:<sha256>.<ext>[?…]` in free text (ext required). */
export const BLOSSOM_URI_RE =
  /blossom:([a-f0-9]{64})\.([a-z0-9]+)(?:\?([^\s<>"']*))?/gi;

/** Parsed BUD-10 blossom URI (discovery hints preserved in order). */
export type BlossomUri = {
  sha256: string;
  /** Extension without a leading dot (e.g. `jpg`). */
  ext: string;
  /** `xs` server hints (domain or absolute origin), order preserved. */
  servers: string[];
  /** `as` uploader pubkeys (lowercase hex), order preserved. */
  authors: string[];
  /** `sz` blob size in bytes when present and valid. */
  size: number | null;
  /** Original URI string (scheme through query). */
  raw: string;
};

export type SignedNostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export function normalizeBlossomServer(url: string): string {
  let out = url.trim();
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

export function blossomServersFromTags(tags: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (tag[0]?.toLowerCase() !== 'server') continue;
    const url = normalizeBlossomServer(String(tag[1] ?? ''));
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export function mergeBlossomServers(
  userServers: string[],
  presets: readonly string[] = BLOSSOM_PRESET_SERVERS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...userServers, ...presets]) {
    const url = normalizeBlossomServer(raw);
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

function peelTrailingPunct(raw: string): string {
  return raw.trim().replace(/[.,;:!?)\]]+$/u, '');
}

/**
 * Parse a BUD-10 `blossom:` URI. Returns null when the scheme/hash/ext are invalid.
 * Query params `xs` / `as` may repeat; `sz` must be a positive integer when set.
 */
export function parseBlossomUri(raw: string): BlossomUri | null {
  const text = peelTrailingPunct(raw);
  if (!/^blossom:/i.test(text)) return null;
  const body = text.slice('blossom:'.length);
  const qIdx = body.indexOf('?');
  const path = qIdx >= 0 ? body.slice(0, qIdx) : body;
  const query = qIdx >= 0 ? body.slice(qIdx + 1) : '';
  const dot = path.lastIndexOf('.');
  if (dot <= 0 || dot === path.length - 1) return null;
  const sha256 = path.slice(0, dot).toLowerCase();
  const ext = path.slice(dot + 1).toLowerCase();
  if (!SHA256_HEX.test(sha256) || !/^[a-z0-9]+$/.test(ext)) return null;

  const servers: string[] = [];
  const authors: string[] = [];
  let size: number | null = null;
  if (query) {
    const params = new URLSearchParams(query);
    for (const [key, value] of params.entries()) {
      const k = key.toLowerCase();
      const v = value.trim();
      if (!v) continue;
      if (k === 'xs') {
        // Domain or absolute origin — strip trailing slash only.
        const server = v.replace(/\/+$/, '');
        if (server) servers.push(server);
      } else if (k === 'as') {
        const pk = v.toLowerCase();
        if (HEX_PUBKEY.test(pk)) authors.push(pk);
      } else if (k === 'sz' && size == null) {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0) size = n;
      }
    }
  }

  return {
    sha256,
    ext,
    servers,
    authors,
    size,
    raw: `blossom:${sha256}.${ext}${query ? `?${query}` : ''}`
  };
}

/** Find all BUD-10 URIs in free text (deduped by raw URI). */
export function findBlossomUris(content: string): BlossomUri[] {
  if (!content) return [];
  const out: BlossomUri[] = [];
  const seen = new Set<string>();
  const re = new RegExp(BLOSSOM_URI_RE.source, 'gi');
  for (const match of content.matchAll(re)) {
    const parsed = parseBlossomUri(match[0] ?? '');
    if (!parsed || seen.has(parsed.raw)) continue;
    seen.add(parsed.raw);
    out.push(parsed);
  }
  return out;
}

/**
 * Build ordered http(s) GET candidates for a blob (BUD-01 `GET /<sha256>[.ext]`).
 * `xs` hints first (https then http when scheme omitted), then optional fallbacks.
 */
export function blossomBlobCandidates(
  uri: BlossomUri,
  fallbackServers: readonly string[] = BLOSSOM_PRESET_SERVERS
): string[] {
  const path = `/${uri.sha256}.${uri.ext}`;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (absolute: string): void => {
    const url = normalizeBlossomServer(absolute) + path;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(url);
  };

  for (const hint of uri.servers) {
    if (/^https?:\/\//i.test(hint)) {
      push(hint);
      continue;
    }
    // Domain-only: prefer https, then http (BUD-10).
    push(`https://${hint}`);
    push(`http://${hint}`);
  }
  for (const server of fallbackServers) {
    push(server);
  }
  return out;
}

/** Media kind from the BUD-10 file extension. */
export function blossomMediaType(
  ext: string
): 'image' | 'video' | 'audio' | null {
  const e = ext.toLowerCase().replace(/^\./, '');
  if (/^(?:png|jpe?g|gif|webp|avif|svg)$/.test(e)) return 'image';
  if (/^(?:mp4|webm|ogv|mov|m4v)$/.test(e)) return 'video';
  if (/^(?:mp3|ogg|wav|m4a|aac)$/.test(e)) return 'audio';
  return null;
}

/**
 * Format a BUD-10 URI after upload. Extension defaults to `bin` when unknown.
 */
export function formatBlossomUri(opts: {
  sha256: string;
  ext?: string | null;
  servers?: string[];
  authors?: string[];
  size?: number | null;
}): string | null {
  const sha256 = opts.sha256.trim().toLowerCase();
  if (!SHA256_HEX.test(sha256)) return null;
  let ext = (opts.ext ?? 'bin').trim().toLowerCase().replace(/^\./, '');
  if (!ext || !/^[a-z0-9]+$/.test(ext)) ext = 'bin';
  const params = new URLSearchParams();
  for (const server of opts.servers ?? []) {
    const s = server.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (s) params.append('xs', s);
  }
  for (const author of opts.authors ?? []) {
    const pk = author.trim().toLowerCase();
    if (HEX_PUBKEY.test(pk)) params.append('as', pk);
  }
  if (opts.size != null && Number.isInteger(opts.size) && opts.size > 0) {
    params.set('sz', String(opts.size));
  }
  const q = params.toString();
  return `blossom:${sha256}.${ext}${q ? `?${q}` : ''}`;
}

function asArrayBufferView(bytes: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = asArrayBufferView(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function imetaTagFromUpload(opts: {
  url: string;
  mime?: string;
  sha256: string;
  width?: number;
  height?: number;
  blurhash?: string;
}): string[] {
  const url = cleanTrackingUrl(opts.url) || opts.url.trim();
  const parts = ['imeta', `url ${url}`, `x ${opts.sha256}`];
  if (opts.mime?.trim()) parts.push(`m ${opts.mime.trim()}`);
  if (opts.width != null && opts.height != null) {
    parts.push(`dim ${opts.width}x${opts.height}`);
  }
  if (opts.blurhash?.trim()) parts.push(`blurhash ${opts.blurhash.trim()}`);
  return parts;
}

export function encodeBlossomAuthHeader(signedEvent: SignedNostrEvent): string {
  const json = JSON.stringify(signedEvent);
  const base64 =
    typeof btoa !== 'undefined'
      ? btoa(json)
      : Buffer.from(json, 'utf8').toString('base64');
  return `Nostr ${base64}`;
}

function parseUploadUrl(body: string): string {
  if (!body.trim()) return '';
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const direct = parsed.url;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const nested = parsed.body;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const url = (nested as Record<string, unknown>).url;
      if (typeof url === 'string' && url.trim()) return url.trim();
    }
    for (const value of Object.values(parsed)) {
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value.trim();
    }
  } catch {
    if (/^https?:\/\//i.test(body.trim())) return body.trim();
  }
  return '';
}

export async function uploadToBlossomServers(opts: {
  servers: string[];
  bytes: Uint8Array;
  mimeType?: string;
  signAuth: (partial: {
    kind: number;
    content: string;
    tags: string[][];
  }) => Promise<SignedNostrEvent | null>;
}): Promise<{ url: string; sha256: string; server: string; imeta: string[] }> {
  const sha256 = await sha256Hex(opts.bytes);
  const now = Math.floor(Date.now() / 1000);
  const authPartial = {
    kind: 24242,
    content: 'Upload',
    tags: [
      ['t', 'upload'],
      ['x', sha256],
      ['expiration', String(now + 60)],
    ] as string[][],
  };

  const signed = await opts.signAuth(authPartial);
  if (!signed) throw new Error('Blossom upload auth was not signed');

  const errors: string[] = [];
  for (const rawServer of opts.servers) {
    const server = normalizeBlossomServer(rawServer);
    if (!server) continue;
    try {
      const headers: Record<string, string> = {
        Authorization: encodeBlossomAuthHeader(signed),
        'X-SHA-256': sha256,
      };
      const mime = opts.mimeType?.trim();
      if (mime) headers['Content-Type'] = mime;

      const response = await fetch(`${server}/upload`, {
        method: 'PUT',
        headers,
        body: asArrayBufferView(opts.bytes),
      });
      const body = await response.text();
      if (!response.ok) {
        errors.push(`${server}: ${response.status} ${body.slice(0, 120)}`);
        continue;
      }
      const rawUrl = parseUploadUrl(body);
      if (!rawUrl) {
        errors.push(`${server}: missing url in response`);
        continue;
      }
      const url = cleanTrackingUrl(rawUrl) || rawUrl;
      return {
        url,
        sha256,
        server,
        imeta: imetaTagFromUpload({ url, mime: mime, sha256 }),
      };
    } catch (err) {
      errors.push(`${server}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(
    errors.length ? `All Blossom uploads failed: ${errors.join('; ')}` : 'No Blossom servers configured',
  );
}
