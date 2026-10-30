import { hexPubkey } from '../metadata';

/**
 * Always-on strip tabs. Users can hide Original Posts / Replies and replace them
 * with kind filters; Follows and Notifications stay.
 */
export const CORE_FEED_TABS = ['follows', 'notifications'] as const;
/** Optional built-ins — present by default, removable from the strip. */
export const OPTIONAL_BUILTIN_FEED_TABS = ['original', 'replies'] as const;
/** All named built-ins (core + optional). Order matches the default strip. */
export const BUILTIN_FEED_TABS = ['follows', 'original', 'replies', 'notifications'] as const;
export type BuiltinFeedTab = (typeof BUILTIN_FEED_TABS)[number];
export type CoreFeedTab = (typeof CORE_FEED_TABS)[number];
export type OptionalBuiltinFeedTab = (typeof OPTIONAL_BUILTIN_FEED_TABS)[number];

/**
 * Built-in tabs plus user-added kind filters.
 * Single kind: `kind:1`. Multi: `kind:1+7+1111` (sorted, unique).
 */
export type FeedTab = BuiltinFeedTab | `kind:${string}`;

/** Default strip order — Follows first. */
export const DEFAULT_FEED_TAB_ORDER: FeedTab[] = [
  'follows',
  'original',
  'replies',
  'notifications'
];

const BUILTIN_FEED_TAB_SET = new Set<string>(BUILTIN_FEED_TABS);
const CORE_FEED_TAB_SET = new Set<string>(CORE_FEED_TABS);
const OPTIONAL_BUILTIN_FEED_TAB_SET = new Set<string>(OPTIONAL_BUILTIN_FEED_TABS);

const KIND_FEED_TAB_RE = /^kind:\d+(\+\d+)*$/;

/** Sorted unique non-negative kind numbers. */
export function normalizeFeedKinds(kinds: readonly number[]): number[] {
  return [
    ...new Set(kinds.filter((k) => Number.isInteger(k) && k >= 0))
  ].sort((a, b) => a - b);
}

/** Encode a kind-filter tab id, or null when nothing valid remains. */
export function encodeKindFeedTab(kinds: readonly number[]): FeedTab | null {
  const unique = normalizeFeedKinds(kinds);
  if (!unique.length) return null;
  return `kind:${unique.join('+')}`;
}

export function isKindFeedTab(tab: string): tab is `kind:${string}` {
  return KIND_FEED_TAB_RE.test(tab);
}

/** Kind numbers for a `kind:…` tab (empty for built-ins). */
export function feedTabKinds(tab: FeedTab): number[] {
  if (!isKindFeedTab(tab)) return [];
  return normalizeFeedKinds(
    tab
      .slice('kind:'.length)
      .split('+')
      .map((part) => Number(part))
  );
}

/** First kind on a kind tab (compat); null for built-ins or empty. */
export function feedTabKind(tab: FeedTab): number | null {
  return feedTabKinds(tab)[0] ?? null;
}

export function isFeedTab(raw: string): raw is FeedTab {
  return BUILTIN_FEED_TAB_SET.has(raw) || isKindFeedTab(raw);
}

export function isCoreFeedTab(tab: string): tab is CoreFeedTab {
  return CORE_FEED_TAB_SET.has(tab);
}

export function isOptionalBuiltinFeedTab(tab: string): tab is OptionalBuiltinFeedTab {
  return OPTIONAL_BUILTIN_FEED_TAB_SET.has(tab);
}

/** Kind tabs and optional built-ins can leave the strip; Follows / Notifications cannot. */
export function isRemovableFeedTab(tab: string): boolean {
  return isKindFeedTab(tab) || isOptionalBuiltinFeedTab(tab);
}

export function parseFeedTab(raw: string | null | undefined): FeedTab {
  const t = (raw ?? '').trim().toLowerCase();
  if (t === 'follows' || t === 'replies' || t === 'notifications') return t;
  if (isKindFeedTab(t)) return encodeKindFeedTab(feedTabKinds(t as FeedTab)) ?? 'original';
  return 'original';
}

/** Collapse whitespace; empty → null (use kinds-based default). */
export function normalizeFeedTabCustomName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  return name.slice(0, 40);
}

/** Short label for a feed tab button. Custom names only apply to kind tabs. */
export function feedTabLabel(tab: FeedTab, customName?: string | null): string {
  if (tab === 'follows') return 'Follows';
  if (tab === 'original') return 'Original Posts';
  if (tab === 'replies') return 'Replies';
  if (tab === 'notifications') return 'Notifications';
  const custom = normalizeFeedTabCustomName(customName);
  if (custom) return custom;
  const kinds = feedTabKinds(tab);
  if (!kinds.length) return tab;
  if (kinds.length === 1) return `Kind ${kinds[0]}`;
  if (kinds.length <= 3) return `Kinds ${kinds.join('+')}`;
  return `${kinds.length} kinds`;
}

/** Lowercase hex pubkey from `?author=` (hex, npub, or nprofile). */
export function parseFeedAuthorParam(raw: string | null | undefined): string | null {
  const hex = hexPubkey((raw ?? '').trim());
  return hex ? hex.toLowerCase() : null;
}
