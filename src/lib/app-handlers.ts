import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { eventAddress } from './nostr/verify';

export type AppHandlerInfo = {
  event: Event;
  name: string;
  /** Icon URL from content JSON `picture` (or `picture`/`image` tags). */
  picture: string;
  about: string;
  website: string;
  /** Preferred launch URL (platform tag or website). */
  href: string;
  /** Kind numbers this handler advertises via `k` tags. */
  supportedKinds: number[];
  /** Topic tags (`t`). */
  topics: string[];
};

const PLATFORM_TAGS = [
  'web',
  'android',
  'ios',
  'macos',
  'windows',
  'linux',
  'chrome',
  'firefox',
  'safari'
] as const;

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function parseContentJson(content: string): Record<string, unknown> | null {
  const t = content.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(t) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function strField(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Platform launch URL; strips NIP-89 `<bech32>` placeholders for a browsable base. */
function platformHref(event: Event): string {
  for (const name of PLATFORM_TAGS) {
    const raw = event.tags.find((t) => t[0] === name)?.[1]?.trim() ?? '';
    if (!raw) continue;
    if (raw.includes('<bech32>') || raw.includes('<BECH32>')) {
      const base = raw.split(/<bech32>/i)[0]?.replace(/\/+$/, '') ?? '';
      if (isHttpUrl(base)) return base;
      continue;
    }
    if (isHttpUrl(raw)) return raw;
  }
  return '';
}

/**
 * Icon URL for a NIP-89 handler.
 * Prefer content JSON `picture` (NIP-89), then `picture` / `image` tags.
 */
export function appHandlerPictureUrl(event: Event): string {
  const json = parseContentJson(event.content);
  const fromJson = json ? strField(json, 'picture', 'image', 'thumb', 'banner') : '';
  const fromTag =
    event.tags.find((t) => t[0] === 'picture' && t[1])?.[1]?.trim() ||
    event.tags.find((t) => t[0] === 'image' && t[1])?.[1]?.trim() ||
    '';
  const raw = fromJson || fromTag;
  // Keep the published URL as-is (icons are CSS-sized). Thumb rewrite belongs in the img loader.
  if (!raw || !isHttpUrl(raw)) return '';
  return raw;
}

/** Parse NIP-89 kind-31990 metadata for compact icon rows. */
export function parseAppHandler(event: Event): AppHandlerInfo | null {
  if (event.kind !== KIND.APP_HANDLER) return null;
  const json = parseContentJson(event.content);
  const name =
    (json ? strField(json, 'name', 'display_name', 'displayName') : '') ||
    event.tags.find((t) => t[0] === 'alt')?.[1]?.trim() ||
    event.tags.find((t) => t[0] === 'title')?.[1]?.trim() ||
    'App';
  const picture = appHandlerPictureUrl(event);
  const about = json ? strField(json, 'about', 'description', 'summary') : '';
  const website = (json ? strField(json, 'website', 'url') : '') || '';
  const href =
    (website && isHttpUrl(website) ? website : '') ||
    platformHref(event) ||
    picture;
  const supportedKinds = [
    ...new Set(
      event.tags
        .filter((t) => t[0] === 'k' && /^\d+$/.test((t[1] ?? '').trim()))
        .map((t) => Number(t[1]!.trim()))
    )
  ].sort((a, b) => a - b);
  const topics = [
    ...new Set(
      event.tags
        .filter((t) => t[0] === 't' && t[1]?.trim())
        .map((t) => t[1]!.trim().replace(/^#+/u, ''))
        .filter(Boolean)
    )
  ];
  return {
    event,
    name,
    picture,
    about,
    website: website && isHttpUrl(website) ? website : '',
    href,
    supportedKinds,
    topics
  };
}

/** True when the handler advertises support for `kind` via a `k` tag. */
export function appHandlerSupportsKind(event: Event, kind: number): boolean {
  if (event.kind !== KIND.APP_HANDLER) return false;
  const want = String(kind);
  return event.tags.some((t) => t[0] === 'k' && (t[1] ?? '').trim() === want);
}

/**
 * Newest-first unique handlers (one per addressable coordinate).
 */
export function uniqueAppHandlers(events: readonly Event[]): AppHandlerInfo[] {
  const sorted = [...events]
    .filter((e) => e.kind === KIND.APP_HANDLER)
    .sort((a, b) => b.created_at - a.created_at);
  const seen = new Set<string>();
  const out: AppHandlerInfo[] = [];
  for (const event of sorted) {
    const key = eventAddress(event).toLowerCase() || event.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const info = parseAppHandler(event);
    if (info) out.push(info);
  }
  return out;
}
