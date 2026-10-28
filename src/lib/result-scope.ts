import type { Event } from 'nostr-tools';
import { GRAPEVINE_RANK_MIN_DEFAULT } from './constants';
import { hasKnownRank, type TrustedAssertionScore } from './nip85-trusted-assertions';

/** Author-source chips on search / wiki listings. */
export type AuthorResultScope = 'all' | 'mine' | 'follows' | 'trusted';

export type AuthorScopeContext = {
  viewerPubkey?: string | null;
  followPubkeySet?: ReadonlySet<string> | Set<string>;
  rankMin?: number;
  getScore?: (pubkey: string) => TrustedAssertionScore | null | undefined;
};

export function parseAuthorResultScope(raw: string | null | undefined): AuthorResultScope {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'mine' || v === 'me') return 'mine';
  if (v === 'follows' || v === 'follow') return 'follows';
  if (v === 'trusted' || v === 'trust') return 'trusted';
  return 'all';
}

/** True when Brainstorm/GrapeRank is known and ≥ the configured minimum. */
export function meetsMinimumTrustedRank(
  pubkey: string,
  getScore: ((pk: string) => TrustedAssertionScore | null | undefined) | undefined,
  rankMin = GRAPEVINE_RANK_MIN_DEFAULT
): boolean {
  const pk = pubkey.trim().toLowerCase();
  if (!pk || !getScore) return false;
  const score = getScore(pk);
  return hasKnownRank(score) && (score!.rank as number) >= rankMin;
}

export function filterEventsByAuthorScope(
  events: Event[],
  scope: AuthorResultScope,
  ctx: AuthorScopeContext
): Event[] {
  if (scope === 'all') return events;
  const me = (ctx.viewerPubkey ?? '').trim().toLowerCase();
  if (scope === 'mine') {
    if (!me) return [];
    return events.filter((e) => e.pubkey.toLowerCase() === me);
  }
  if (scope === 'follows') {
    const follows = ctx.followPubkeySet;
    if (!follows?.size) return [];
    return events.filter((e) => follows.has(e.pubkey.toLowerCase()));
  }
  const rankMin = ctx.rankMin ?? GRAPEVINE_RANK_MIN_DEFAULT;
  return events.filter((e) => meetsMinimumTrustedRank(e.pubkey, ctx.getScore, rankMin));
}
