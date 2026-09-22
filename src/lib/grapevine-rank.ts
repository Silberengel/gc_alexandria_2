import { GRAPEVINE_RANK_MIN_DEFAULT, LIBRARY_GC_PUBLISHING_PUBKEY } from './constants';
import { hasKnownRank, isValidPubkey, type TrustedAssertionScore } from './nip85-trusted-assertions';

export type GrapevineTrustContext = {
  trustFilterEnabled: boolean;
  rankCutoff?: number;
  viewerPubkey?: string | null;
  followPubkeySet?: ReadonlySet<string> | Set<string>;
  /** Follows-of-follows (2-hop). Soft-pass when scores are missing. */
  followsOfFollowsSet?: ReadonlySet<string> | Set<string>;
  getScore?: (pubkey: string) => TrustedAssertionScore | null | undefined;
};

function cutoffOf(ctx: GrapevineTrustContext): number {
  return ctx.rankCutoff ?? GRAPEVINE_RANK_MIN_DEFAULT;
}

function normalizePk(pubkey: string | null | undefined): string {
  return (pubkey ?? '').trim().toLowerCase();
}

export function hexPubkeysEqual(a: string, b: string): boolean {
  return normalizePk(a) === normalizePk(b) && isValidPubkey(a) && isValidPubkey(b);
}

export function isSelfOrFollowing(
  pubkey: string,
  viewerPubkey?: string | null,
  followPubkeySet?: ReadonlySet<string> | Set<string>
): boolean {
  const pk = normalizePk(pubkey);
  if (!pk || !isValidPubkey(pk)) return false;
  if (viewerPubkey && hexPubkeysEqual(pk, viewerPubkey)) return true;
  if (followPubkeySet?.has(pk)) return true;
  return false;
}

export function isFollowsOfFollows(
  pubkey: string,
  followsOfFollowsSet?: ReadonlySet<string> | Set<string>
): boolean {
  const pk = normalizePk(pubkey);
  if (!pk) return false;
  return followsOfFollowsSet?.has(pk) === true;
}

export function isGitCitadelPublishingPubkey(pubkey: string): boolean {
  return hexPubkeysEqual(pubkey, LIBRARY_GC_PUBLISHING_PUBKEY);
}

/**
 * Trust filter author gate (deny-by-default):
 * - never hide: self, direct followings
 * - FoF with **unknown** rank: never hide (soft network trust)
 * - known GrapeRank ≥ cutoff: never hide
 * - known rank below cutoff: hide (including FoF)
 * - unknown rank outside FoF: hide
 */
export function shouldHideByGrapevineRank(
  authorPubkey: string,
  ctx: GrapevineTrustContext
): boolean {
  if (!ctx.trustFilterEnabled) return false;
  const pk = normalizePk(authorPubkey);
  if (!pk) return false;
  if (isSelfOrFollowing(pk, ctx.viewerPubkey, ctx.followPubkeySet)) return false;
  const score = ctx.getScore?.(pk);
  if (!hasKnownRank(score)) {
    return !isFollowsOfFollows(pk, ctx.followsOfFollowsSet);
  }
  return (score!.rank as number) < cutoffOf(ctx);
}

export function shouldHideEventByGrapevine(
  event: { pubkey: string },
  ctx: GrapevineTrustContext
): boolean {
  if (!ctx.trustFilterEnabled) return false;
  return shouldHideByGrapevineRank(event.pubkey, ctx);
}

/**
 * Fallback preference among authors with unknown grapevine rank.
 * Lower number = higher preference.
 * 0 self · 1 follow · 2 FoF · 3 GC Publishing · 4 other
 */
export function grapevineFallbackPreferenceTier(
  pubkey: string,
  ctx: Pick<GrapevineTrustContext, 'viewerPubkey' | 'followPubkeySet' | 'followsOfFollowsSet'>
): number {
  const pk = normalizePk(pubkey);
  if (!pk) return 4;
  if (ctx.viewerPubkey && hexPubkeysEqual(pk, ctx.viewerPubkey)) return 0;
  if (ctx.followPubkeySet?.has(pk)) return 1;
  if (ctx.followsOfFollowsSet?.has(pk)) return 2;
  if (isGitCitadelPublishingPubkey(pk)) return 3;
  return 4;
}

/**
 * Compare two authors for search ranking.
 * Returns negative if `a` should sort before `b`.
 */
export function compareAuthorsByGrapevine(
  aPubkey: string,
  bPubkey: string,
  ctx: GrapevineTrustContext
): number {
  const a = normalizePk(aPubkey);
  const b = normalizePk(bPubkey);
  const aScore = ctx.getScore?.(a);
  const bScore = ctx.getScore?.(b);
  const aKnown = hasKnownRank(aScore);
  const bKnown = hasKnownRank(bScore);

  if (aKnown && bKnown) {
    const diff = (bScore!.rank as number) - (aScore!.rank as number);
    if (diff !== 0) return diff;
  } else if (aKnown && !bKnown) {
    return -1;
  } else if (!aKnown && bKnown) {
    return 1;
  }

  return grapevineFallbackPreferenceTier(a, ctx) - grapevineFallbackPreferenceTier(b, ctx);
}
