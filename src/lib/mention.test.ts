import { describe, expect, it } from 'vitest';
import { activeMention, insertMention, mentionRank } from './mention';

describe('activeMention', () => {
  it('reads the token after @ at the caret', () => {
    const source = 'Hello @ada';
    expect(activeMention(source, source.length)).toEqual({ start: 6, query: 'ada' });
  });

  it('ignores an email address and a caret away from the token', () => {
    expect(activeMention('mail user@domain.com', 10)).toBeNull();
    expect(activeMention('Hello @ada', 2)).toBeNull();
  });

  it('starts after whitespace or an opening bracket', () => {
    expect(activeMention('(@bob', 5)).toEqual({ start: 1, query: 'bob' });
    expect(activeMention('Hi @', 4)).toEqual({ start: 3, query: '' });
  });
});

describe('insertMention', () => {
  it('replaces the @query with a nostr:npub and a trailing space', () => {
    const npub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
    const source = 'See @ada soon';
    const edit = insertMention(source, 4, 8, npub);
    expect(edit?.value).toBe(`See nostr:${npub} soon`);
    expect(edit?.selectionStart).toBe(`See nostr:${npub}`.length);
  });
});

describe('mentionRank', () => {
  const fields = {
    name: 'ada',
    displayName: 'Ada Lovelace',
    nip05: 'ada@example.com',
    npub: 'npub1example'
  };

  it('prefers an exact npub, then NIP-05, then name', () => {
    expect(mentionRank('npub1example', fields)).toBe(100);
    expect(mentionRank('ada@example.com', fields)).toBe(95);
    expect(mentionRank('ada', fields)).toBe(90);
    expect(mentionRank('love', fields)).toBe(40);
    expect(mentionRank('missing', fields)).toBe(0);
  });
});
