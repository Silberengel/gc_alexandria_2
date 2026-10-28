import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  filterEventsByAuthorScope,
  meetsMinimumTrustedRank,
  parseAuthorResultScope
} from './result-scope';
import type { TrustedAssertionScore } from './nip85-trusted-assertions';

function ev(partial: Partial<Event> & Pick<Event, 'id' | 'pubkey'>): Event {
  return {
    kind: partial.kind ?? 30818,
    created_at: partial.created_at ?? 1,
    content: partial.content ?? 'body',
    tags: partial.tags ?? [['d', 'x']],
    sig: partial.sig ?? '0'.repeat(128),
    ...partial
  };
}

describe('result-scope', () => {
  const me = 'a'.repeat(64);
  const follow = 'b'.repeat(64);
  const trusted = 'c'.repeat(64);
  const other = 'd'.repeat(64);

  const scores: Record<string, TrustedAssertionScore> = {
    [trusted]: { rank: 42 },
    [other]: { rank: 3 },
    [follow]: { rank: 50 }
  };

  it('parseAuthorResultScope accepts aliases and defaults to trusted', () => {
    expect(parseAuthorResultScope(null)).toBe('trusted');
    expect(parseAuthorResultScope('')).toBe('trusted');
    expect(parseAuthorResultScope('all')).toBe('all');
    expect(parseAuthorResultScope('me')).toBe('mine');
    expect(parseAuthorResultScope('follows')).toBe('follows');
    expect(parseAuthorResultScope('trusted')).toBe('trusted');
  });

  it('meetsMinimumTrustedRank requires known rank at/above cutoff', () => {
    const getScore = (pk: string) => scores[pk] ?? null;
    expect(meetsMinimumTrustedRank(trusted, getScore, 10)).toBe(true);
    expect(meetsMinimumTrustedRank(other, getScore, 10)).toBe(false);
    expect(meetsMinimumTrustedRank(me, getScore, 10)).toBe(false);
  });

  it('filterEventsByAuthorScope covers mine/follows/trusted', () => {
    const list = [
      ev({ id: '1'.repeat(64), pubkey: me }),
      ev({ id: '2'.repeat(64), pubkey: follow }),
      ev({ id: '3'.repeat(64), pubkey: trusted }),
      ev({ id: '4'.repeat(64), pubkey: other })
    ];
    const ctx = {
      viewerPubkey: me,
      followPubkeySet: new Set([follow]),
      rankMin: 10,
      getScore: (pk: string) => scores[pk] ?? null
    };
    expect(filterEventsByAuthorScope(list, 'mine', ctx).map((e) => e.pubkey)).toEqual([me]);
    expect(filterEventsByAuthorScope(list, 'follows', ctx).map((e) => e.pubkey)).toEqual([follow]);
    expect(filterEventsByAuthorScope(list, 'trusted', ctx).map((e) => e.pubkey)).toEqual([
      follow,
      trusted
    ]);
    expect(filterEventsByAuthorScope(list, 'all', ctx)).toHaveLength(4);
  });
});
