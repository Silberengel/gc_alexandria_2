import { describe, expect, it, beforeEach } from 'vitest';
import {
  getFollowsOfFollowsSet,
  resetFollowsOfFollows,
  ensureFollowsOfFollows
} from './follows-of-follows';
import { shouldHideByGrapevineRank } from './grapevine-rank';

const VIEWER = 'a'.repeat(64);
const FOLLOW = 'b'.repeat(64);
const FOF = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);

describe('follows-of-follows soft-pass wiring', () => {
  beforeEach(() => {
    resetFollowsOfFollows();
  });

  it('starts empty and grapevine hides unknown-rank non-FoF', () => {
    expect(getFollowsOfFollowsSet(VIEWER).size).toBe(0);
    expect(
      shouldHideByGrapevineRank(OTHER, {
        trustFilterEnabled: true,
        viewerPubkey: VIEWER,
        followPubkeySet: new Set([FOLLOW]),
        followsOfFollowsSet: getFollowsOfFollowsSet(VIEWER),
        getScore: () => null
      })
    ).toBe(true);
  });

  it('soft-passes FoF when set is populated', async () => {
    // Seed via rebuild path with empty network — then manually verify API contract.
    await ensureFollowsOfFollows(VIEWER, [FOLLOW]);
    // Without relays, set stays empty; inject via reset+direct check of hide logic:
    const fof = new Set([FOF]);
    expect(
      shouldHideByGrapevineRank(FOF, {
        trustFilterEnabled: true,
        viewerPubkey: VIEWER,
        followPubkeySet: new Set([FOLLOW]),
        followsOfFollowsSet: fof,
        getScore: () => null
      })
    ).toBe(false);
  });
});
