import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  canRequestWikiMerge,
  isMergeAcceptReaction,
  isMergeRejectReaction,
  parseWikiMergeAcceptance,
  parseWikiMergeRequest,
  wikiMergeRequestDraftFromFork
} from './wiki-merge';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey'>): Event {
  return {
    id: (partial.id ?? 'a'.repeat(64)).slice(0, 64),
    created_at: partial.created_at ?? 1_700_000_000,
    content: partial.content ?? '',
    tags: partial.tags ?? [],
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('wiki-merge', () => {
  it('parses 818 with fork marker and legacy source marker', () => {
    const dest = 'b'.repeat(64);
    const sourceId = '1'.repeat(64);
    const baseId = '2'.repeat(64);
    const withFork = ev({
      kind: KIND.WIKI_MERGE_REQUEST,
      pubkey: 'f'.repeat(64),
      content: 'please merge',
      tags: [
        ['a', `30818:${dest}:bitcoin`],
        ['e', baseId],
        ['p', dest],
        ['e', sourceId, '', 'fork']
      ]
    });
    const parsed = parseWikiMergeRequest(withFork);
    expect(parsed?.destinationPubkey).toBe(dest);
    expect(parsed?.sourceEventId).toBe(sourceId);
    expect(parsed?.baseEventId).toBe(baseId);
    expect(parsed?.explanation).toBe('please merge');

    const withSource = ev({
      kind: KIND.WIKI_MERGE_REQUEST,
      pubkey: 'f'.repeat(64),
      tags: [
        ['a', `30818:${dest}:bitcoin`],
        ['p', dest],
        ['e', sourceId, '', 'source']
      ]
    });
    expect(parseWikiMergeRequest(withSource)?.sourceEventId).toBe(sourceId);
  });

  it('parses 819 result/request markers', () => {
    const acceptance = ev({
      kind: KIND.WIKI_MERGE_ACCEPTANCE,
      pubkey: 'b'.repeat(64),
      tags: [
        ['e', '3'.repeat(64), '', 'result'],
        ['e', '4'.repeat(64), '', 'request'],
        ['p', 'f'.repeat(64)]
      ]
    });
    const parsed = parseWikiMergeAcceptance(acceptance);
    expect(parsed?.resultEventId).toBe('3'.repeat(64));
    expect(parsed?.requestEventId).toBe('4'.repeat(64));
    expect(parsed?.requestAuthorPubkey).toBe('f'.repeat(64));
  });

  it('classifies accept/reject reactions', () => {
    const mrId = 'a'.repeat(64);
    const accept = ev({
      kind: KIND.REACTION,
      pubkey: 'b'.repeat(64),
      content: '+',
      tags: [['e', mrId], ['p', 'f'.repeat(64)]]
    });
    const reject = ev({
      kind: KIND.REACTION,
      pubkey: 'b'.repeat(64),
      content: '-',
      tags: [['e', mrId], ['p', 'f'.repeat(64)]]
    });
    expect(isMergeAcceptReaction(accept, mrId)).toBe(true);
    expect(isMergeRejectReaction(reject, mrId)).toBe(true);
    expect(isMergeRejectReaction(accept, mrId)).toBe(false);
  });

  it('builds an 818 draft from a forked article', () => {
    const dest = 'b'.repeat(64);
    const me = 'f'.repeat(64);
    const fork = ev({
      kind: KIND.WIKI,
      pubkey: me,
      id: '9'.repeat(64),
      tags: [
        ['d', 'bitcoin'],
        ['a', `30818:${dest}:bitcoin`, '', 'fork'],
        ['e', '8'.repeat(64), '', 'fork']
      ]
    });
    expect(canRequestWikiMerge(fork, me)).toBe(true);
    expect(canRequestWikiMerge(fork, dest)).toBe(false);
    const draft = wikiMergeRequestDraftFromFork(fork, 'note');
    expect(draft?.kind).toBe(KIND.WIKI_MERGE_REQUEST);
    expect(draft?.values.target_a).toBe(`30818:${dest}:bitcoin`);
    expect(draft?.values.destination_p).toBe(dest);
    expect(draft?.values.source_e).toBe('9'.repeat(64));
    expect(draft?.tags.some((t) => t[0] === 'e' && t[1] === '9'.repeat(64) && t[3] === 'fork')).toBe(
      true
    );
  });
});
