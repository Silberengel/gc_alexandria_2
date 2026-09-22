import { describe, expect, it } from 'vitest';
import { KIND } from './constants';
import {
  compareAuthorsByGrapevine,
  grapevineFallbackPreferenceTier,
  shouldHideByGrapevineRank
} from './grapevine-rank';
import {
  parseNip85ProviderFrom10040,
  parseTrustedAssertionScore
} from './nip85-trusted-assertions';
import type { Event } from 'nostr-tools';

const SERVICE = '1b74a50a86757bdfdf35fe7cfe412be485ce0b8fa4c52327f09807cebbb91837';
const SUBJECT = 'fffbb9d3d416d7c232621a5929aff65a3edb184a2978abd79b7881201cfbc90a';
const VIEWER = 'a'.repeat(64);
const FOLLOW = 'b'.repeat(64);
const FOF = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);

function fakeEvent(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey' | 'tags'>): Event {
  return {
    id: '1'.repeat(64),
    created_at: 1,
    content: '',
    sig: '2'.repeat(128),
    ...partial
  };
}

describe('parseNip85ProviderFrom10040', () => {
  it('prefers 30382:rank', () => {
    const ev = fakeEvent({
      kind: KIND.NIP85_PREFS,
      pubkey: VIEWER,
      tags: [
        ['30382:followers', SERVICE, 'wss://other.example/'],
        ['30382:rank', SERVICE, 'wss://straycat.brainstorm.social/relay']
      ]
    });
    const ref = parseNip85ProviderFrom10040(ev);
    expect(ref?.metric).toBe('30382:rank');
    expect(ref?.servicePubkey).toBe(SERVICE);
    expect(ref?.relayUrl).toContain('brainstorm');
  });

  it('returns null when relay missing', () => {
    const ev = fakeEvent({
      kind: KIND.NIP85_PREFS,
      pubkey: VIEWER,
      tags: [['30382:rank', SERVICE]]
    });
    expect(parseNip85ProviderFrom10040(ev)).toBeNull();
  });
});

describe('parseTrustedAssertionScore', () => {
  it('reads rank hops followers', () => {
    const ev = fakeEvent({
      kind: KIND.NIP85_SCORE,
      pubkey: SERVICE,
      tags: [
        ['d', SUBJECT],
        ['rank', '42'],
        ['hops', '2'],
        ['followers', '10']
      ]
    });
    const score = parseTrustedAssertionScore(ev);
    expect(score?.rank).toBe(42);
    expect(score?.hops).toBe(2);
    expect(score?.followers).toBe(10);
  });
});

describe('shouldHideByGrapevineRank', () => {
  const scores = new Map([
    [OTHER, { subjectPubkey: OTHER, rank: 1, hops: 5, followers: 0, pagerank: null }]
  ]);

  it('does not hide when trust filter off', () => {
    expect(
      shouldHideByGrapevineRank(OTHER, {
        trustFilterEnabled: false,
        getScore: (pk) => scores.get(pk) ?? null
      })
    ).toBe(false);
  });

  it('hides known rank below cutoff', () => {
    expect(
      shouldHideByGrapevineRank(OTHER, {
        trustFilterEnabled: true,
        getScore: (pk) => scores.get(pk) ?? null
      })
    ).toBe(true);
  });

  it('hides unknown rank outside FoF', () => {
    expect(
      shouldHideByGrapevineRank(OTHER, {
        trustFilterEnabled: true,
        getScore: () => null
      })
    ).toBe(true);
  });

  it('soft-passes FoF with unknown rank', () => {
    expect(
      shouldHideByGrapevineRank(FOF, {
        trustFilterEnabled: true,
        followsOfFollowsSet: new Set([FOF]),
        getScore: () => null
      })
    ).toBe(false);
  });

  it('never hides self or follow', () => {
    expect(
      shouldHideByGrapevineRank(VIEWER, {
        trustFilterEnabled: true,
        viewerPubkey: VIEWER,
        getScore: () => null
      })
    ).toBe(false);
    expect(
      shouldHideByGrapevineRank(FOLLOW, {
        trustFilterEnabled: true,
        followPubkeySet: new Set([FOLLOW]),
        getScore: () => ({ subjectPubkey: FOLLOW, rank: 0, hops: null, followers: null, pagerank: null })
      })
    ).toBe(false);
  });
});

describe('compareAuthorsByGrapevine', () => {
  it('sorts higher rank first', () => {
    const scores = new Map([
      [FOLLOW, { subjectPubkey: FOLLOW, rank: 50, hops: 1, followers: 1, pagerank: null }],
      [OTHER, { subjectPubkey: OTHER, rank: 10, hops: 2, followers: 0, pagerank: null }]
    ]);
    const ctx = {
      trustFilterEnabled: true,
      getScore: (pk: string) => scores.get(pk) ?? null
    };
    expect(compareAuthorsByGrapevine(FOLLOW, OTHER, ctx)).toBeLessThan(0);
  });

  it('prefers known rank over unknown', () => {
    const scores = new Map([
      [FOLLOW, { subjectPubkey: FOLLOW, rank: 5, hops: 1, followers: 1, pagerank: null }]
    ]);
    const ctx = {
      trustFilterEnabled: true,
      getScore: (pk: string) => scores.get(pk) ?? null
    };
    expect(compareAuthorsByGrapevine(FOLLOW, OTHER, ctx)).toBeLessThan(0);
  });
});

describe('grapevineFallbackPreferenceTier', () => {
  it('orders self before follow before FoF', () => {
    const ctx = {
      viewerPubkey: VIEWER,
      followPubkeySet: new Set([FOLLOW]),
      followsOfFollowsSet: new Set([FOF])
    };
    expect(grapevineFallbackPreferenceTier(VIEWER, ctx)).toBe(0);
    expect(grapevineFallbackPreferenceTier(FOLLOW, ctx)).toBe(1);
    expect(grapevineFallbackPreferenceTier(FOF, ctx)).toBe(2);
    expect(grapevineFallbackPreferenceTier(OTHER, ctx)).toBe(4);
  });
});
