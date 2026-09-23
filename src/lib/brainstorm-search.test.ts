import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('./nostr/pool', () => ({
  relayPool: { query }
}));

vi.mock('./trusted-assertions', () => ({
  trustedAssertions: {
    getProviderState: () => ({ observerPubkey: 'aa'.repeat(32) }),
    resolveProvider: vi.fn(),
    requestScores: vi.fn(),
    requestScoresAndWait: vi.fn(),
    getScore: () => null
  }
}));

vi.mock('./stores/trust', () => ({
  trust: {
    snapshot: () => ({ enabled: false, rankMin: 10 })
  }
}));

import {
  BRAINSTORM_PUBLICATION_SEARCH_KINDS,
  BRAINSTORM_WIKI_SEARCH_KINDS,
  buildBrainstormSearchQuery,
  fetchBrainstormNip50Events,
  isBrainstormSearchRelay
} from './brainstorm-search';

function wikiEvent(id: string): Event {
  return {
    id,
    pubkey: 'bb'.repeat(32),
    created_at: 1,
    kind: KIND.WIKI,
    tags: [['d', 'aristotle']],
    content: 'Aristotle',
    sig: 'cc'.repeat(64)
  };
}

describe('buildBrainstormSearchQuery', () => {
  it('adds observer, sort:rank, and include:spam when trust is off', () => {
    const q = buildBrainstormSearchQuery({
      query: 'aristotle',
      observerPubkey: 'aa'.repeat(32),
      trustFilterEnabled: false
    });
    expect(q).toContain('aristotle');
    expect(q).toContain(`observer:${'aa'.repeat(32)}`);
    expect(q).toContain('sort:rank');
    expect(q).toContain('include:spam');
    expect(q).not.toContain('sort:rank:desc');
  });

  it('adds filter:rank:gte when trust is on', () => {
    const q = buildBrainstormSearchQuery({
      query: 'pride',
      observerPubkey: 'aa'.repeat(32),
      trustFilterEnabled: true,
      rankCutoff: 10
    });
    expect(q).toContain('filter:rank:gte:10');
    expect(q).not.toContain('include:spam');
  });
});

describe('isBrainstormSearchRelay', () => {
  it('matches the staging Brainstorm host', () => {
    expect(isBrainstormSearchRelay('wss://search-staging.brainstorm.world')).toBe(true);
    expect(isBrainstormSearchRelay('wss://thecitadel.nostr1.com')).toBe(false);
  });
});

describe('fetchBrainstormNip50Events', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('omits kinds when searching the full corpus', async () => {
    query.mockResolvedValue([wikiEvent('1'.repeat(64))]);
    const events = await fetchBrainstormNip50Events({
      query: 'aristotle',
      observerPubkey: 'aa'.repeat(32),
      trustFilterEnabled: false
    });
    expect(events).toHaveLength(1);
    const [, filters] = query.mock.calls[0] as [string[], { search: string; kinds?: number[] }[]];
    expect(filters[0]?.kinds).toBeUndefined();
    expect(filters[0]?.search).toContain('aristotle');
  });

  it('requests wiki kinds on the staging Brainstorm relay', async () => {
    query.mockResolvedValue([wikiEvent('1'.repeat(64))]);
    const events = await fetchBrainstormNip50Events({
      query: 'aristotle',
      kinds: BRAINSTORM_WIKI_SEARCH_KINDS,
      observerPubkey: 'aa'.repeat(32),
      trustFilterEnabled: false
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe(KIND.WIKI);
    const [urls, filters] = query.mock.calls[0] as [string[], { search: string; kinds: number[] }[]];
    expect(urls[0]).toContain('search-staging.brainstorm.world');
    expect(filters[0]?.kinds).toEqual([...BRAINSTORM_WIKI_SEARCH_KINDS]);
    expect(filters[0]?.search).toContain('aristotle');
    expect(filters[0]?.search).toContain('include:spam');
  });

  it('drops events outside the requested kinds', async () => {
    query.mockResolvedValue([
      wikiEvent('1'.repeat(64)),
      { ...wikiEvent('2'.repeat(64)), kind: KIND.PUBLICATION }
    ]);
    const events = await fetchBrainstormNip50Events({
      query: 'pride',
      kinds: BRAINSTORM_PUBLICATION_SEARCH_KINDS,
      observerPubkey: 'aa'.repeat(32),
      trustFilterEnabled: true
    });
    expect(events.every((e) => e.kind === KIND.PUBLICATION)).toBe(true);
  });
});
