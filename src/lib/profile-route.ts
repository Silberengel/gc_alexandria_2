import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import { hexPubkey } from './metadata';
import { lookupNip05Pubkey, splitNip05Identifier } from './nip05';

/** Nostr kind is a uint16 (0–65535). Reject leading zeros, decimals, junk. */
export function parseKindParam(raw: string | undefined | null): number | null {
  const s = (raw ?? '').trim();
  if (!/^(0|[1-9]\d*)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 65535) return null;
  return n;
}

/** Decode a path segment that may be URI-encoded (`roland%40domain`). */
export function decodeProfileIdSegment(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

/**
 * Resolve `/p/:id` to a lowercase hex pubkey.
 * Accepts npub, nprofile, 64-hex, and verified NIP-05 (`name@domain`).
 */
export async function resolveProfilePubkey(rawId: string): Promise<string | null> {
  const raw = decodeProfileIdSegment(rawId);
  if (!raw) return null;

  try {
    const decoded = nip19.decode(raw);
    if (decoded.type === 'npub') return decoded.data.toLowerCase();
    if (decoded.type === 'nprofile') return decoded.data.pubkey.toLowerCase();
  } catch {
    /* fall through */
  }

  const hex = hexPubkey(raw);
  if (hex) return hex.toLowerCase();

  if (splitNip05Identifier(raw)) {
    return lookupNip05Pubkey(raw);
  }

  return null;
}

/** Friendly heading for a kind-filtered profile listing. */
export function profileKindHeading(kind: number): string {
  if (kind === KIND.LONG_FORM) return 'Articles';
  if (kind === KIND.PUBLICATION) return 'Publications';
  if (kind === KIND.WIKI) return 'Wiki pages';
  if (kind === KIND.SPEC) return 'Specifications';
  if (kind === KIND.SECTION) return 'Sections';
  return `Kind ${kind}`;
}

/** Sort key for blog posts: published_at tag when numeric, else created_at. */
export function eventChronologySec(event: { created_at: number; tags: string[][] }): number {
  for (const tag of event.tags) {
    if (tag[0] === 'published_at' && tag[1] && /^(0|[1-9]\d*)$/.test(tag[1].trim())) {
      return Number(tag[1].trim());
    }
  }
  return event.created_at;
}

/** Long calendar date for blog cards (e.g. September 29, 2026). */
export function formatBlogDate(createdAtSec: number, locale?: string): string {
  if (!Number.isFinite(createdAtSec) || createdAtSec <= 0) return '';
  try {
    return new Date(createdAtSec * 1000).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch {
    return '';
  }
}

/**
 * Canonical share path for a kind-filtered profile: prefer a NIP-05 id when
 * that is how the visitor arrived (or when one is provided).
 */
export function profileKindPath(id: string, kind: number): string {
  const seg = id.includes('@') ? id.trim() : id.trim();
  return `/p/${seg}/${kind}`;
}
