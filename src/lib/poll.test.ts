import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  addOptimisticPollVote,
  appendPollTags,
  createPollResponseDraft,
  emptyPollResults,
  endsAtFromHours,
  ensureMinPollOptionRows,
  filledPollOptions,
  mergePollResults,
  parsePoll,
  parsePollResponse,
  pollComposeFieldsFromEvent,
  pollHasVoted,
  pollOptionIdForIndex,
  pollOptionMedia,
  votesForOption
} from './poll';

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

describe('poll option helpers', () => {
  it('keeps stable option ids by index', () => {
    expect(pollOptionIdForIndex(0)).toBe(pollOptionIdForIndex(0));
    expect(pollOptionIdForIndex(0)).not.toBe(pollOptionIdForIndex(1));
    expect(pollOptionIdForIndex(0).length).toBe(9);
  });

  it('pads option rows and filters blanks', () => {
    expect(ensureMinPollOptionRows(['Yes'])).toEqual(['Yes', '']);
    expect(filledPollOptions([' Yes ', '', 'No'])).toEqual(['Yes', 'No']);
  });

  it('classifies media option labels', () => {
    expect(pollOptionMedia('https://cdn.example/a.png')?.kind).toBe('image');
    expect(pollOptionMedia('https://cdn.example/a.mp4')?.kind).toBe('video');
    expect(pollOptionMedia('https://cdn.example/a.pdf')?.kind).toBe('pdf');
    expect(pollOptionMedia('plain text')).toBeNull();
  });
});

describe('appendPollTags', () => {
  it('emits option, polltype, and endsAt tags', () => {
    const tags = appendPollTags(
      [['t', 'polls'], ['option', 'stale', 'drop']],
      {
        options: ['Yes', 'No'],
        multipleChoice: false,
        endsAtEpochSec: 1_700_003_600
      }
    );
    expect(tags).toContainEqual(['t', 'polls']);
    expect(tags.filter((t) => t[0] === 'option')).toEqual([
      ['option', pollOptionIdForIndex(0), 'Yes'],
      ['option', pollOptionIdForIndex(1), 'No']
    ]);
    expect(tags).toContainEqual(['polltype', 'singlechoice']);
    expect(tags).toContainEqual(['endsAt', '1700003600']);
  });
});

describe('parsePoll', () => {
  it('parses a NIP-88 poll', () => {
    const poll = parsePoll(
      ev({
        kind: KIND.POLL,
        pubkey: 'f'.repeat(64),
        content: 'Lunch?',
        tags: [
          ['option', 'a1', 'Pizza'],
          ['option', 'a2', 'Salad'],
          ['polltype', 'multiplechoice'],
          ['endsAt', '1700001000'],
          ['relay', 'wss://relay.example']
        ]
      })
    );
    expect(poll?.question).toBe('Lunch?');
    expect(poll?.options).toHaveLength(2);
    expect(poll?.isMultipleChoice).toBe(true);
    expect(poll?.endsAt).toBe(1_700_001_000);
    expect(poll?.relayUrls).toEqual(['wss://relay.example']);
  });

  it('rejects fewer than two options', () => {
    expect(
      parsePoll(
        ev({
          kind: KIND.POLL,
          pubkey: 'f'.repeat(64),
          content: 'Only one?',
          tags: [['option', 'a1', 'Yes']]
        })
      )
    ).toBeNull();
  });
});

describe('poll responses and tally', () => {
  const optionIds = new Set(['a1', 'a2']);

  it('builds a vote draft and merges one vote per pubkey', () => {
    const poll = ev({
      id: 'b'.repeat(64),
      kind: KIND.POLL,
      pubkey: 'p'.repeat(64),
      content: 'Q?',
      tags: [
        ['option', 'a1', 'Yes'],
        ['option', 'a2', 'No']
      ]
    });
    const draft = createPollResponseDraft(poll, ['a1']);
    expect(draft.kind).toBe(KIND.POLL_RESPONSE);
    expect(draft.content).toBe('');
    expect(draft.tags).toContainEqual(['e', 'b'.repeat(64), '', 'p'.repeat(64)]);
    expect(draft.tags).toContainEqual(['p', 'p'.repeat(64)]);
    expect(draft.tags).toContainEqual(['response', 'a1']);

    const voter = 'v'.repeat(64);
    const response = parsePollResponse(
      ev({
        kind: KIND.POLL_RESPONSE,
        pubkey: voter,
        created_at: 10,
        tags: [
          ['e', poll.id],
          ['response', 'a1']
        ]
      }),
      optionIds,
      false
    );
    expect(response?.selectedOptionIds).toEqual(['a1']);

    let results = mergePollResults(emptyPollResults(optionIds), [response!], optionIds);
    expect(votesForOption(results, 'a1')).toBe(1);
    expect(pollHasVoted(results, voter)).toBe(true);

    results = mergePollResults(
      results,
      [
        {
          pubkey: voter,
          selectedOptionIds: ['a2'],
          createdAt: 20
        }
      ],
      optionIds
    );
    expect(votesForOption(results, 'a1')).toBe(1);
    expect(votesForOption(results, 'a2')).toBe(0);

    results = addOptimisticPollVote(results, 'w'.repeat(64), ['a2'], optionIds);
    expect(results.totalVotes).toBe(2);
  });
});

describe('compose preload fields', () => {
  it('maps options and remaining ends hours', () => {
    const now = 1_700_000_000;
    const fields = pollComposeFieldsFromEvent(
      {
        kind: KIND.POLL,
        tags: [
          ['option', 'x', 'Yes'],
          ['option', 'y', 'No'],
          ['polltype', 'singlechoice'],
          ['endsAt', String(now + 7200)]
        ]
      },
      now
    );
    expect(fields.options).toEqual(['Yes', 'No']);
    expect(fields.multipleChoice).toBe(false);
    expect(fields.endsHours).toBe('2');
    expect(endsAtFromHours('3', now)).toBe(now + 3 * 3600);
  });
});
