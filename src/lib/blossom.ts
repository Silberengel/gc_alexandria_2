import { cleanTrackingUrl } from './clean-url';

export const BLOSSOM_PRESET_SERVERS = [
  'https://0x0.oslim.dev',
  'https://blossom.band',
  'https://blossom.primal.net',
  'https://nostr.media',
  'https://blossom.nostr.build',
] as const;

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
