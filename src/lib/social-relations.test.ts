import { describe, expect, it } from 'vitest';
import { placePubkeyTags, pubkeyRelationMode, stripPubkeyTags } from './social-relations';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);

describe('social-relations tag helpers', () => {
  it('detects public vs private placement', () => {
    expect(pubkeyRelationMode([['p', a]], [], a)).toBe('public');
    expect(pubkeyRelationMode([], [['p', a]], a)).toBe('private');
    expect(pubkeyRelationMode([['p', a]], [['p', a]], a)).toBe('public');
    expect(pubkeyRelationMode([['p', b]], [['p', b]], a)).toBe(null);
  });

  it('strips only the target pubkey', () => {
    expect(stripPubkeyTags([['p', a], ['p', b], ['word', 'x']], a)).toEqual([
      ['p', b],
      ['word', 'x']
    ]);
  });

  it('moves a pubkey between public and private without duplicating', () => {
    const start = placePubkeyTags([['p', a], ['p', b]], [], a, 'private');
    expect(start.publicTags).toEqual([['p', b]]);
    expect(start.privateTags).toEqual([['p', a]]);
    const back = placePubkeyTags(start.publicTags, start.privateTags, a, 'public');
    expect(back.publicTags.map((t) => t[1])).toEqual([b, a]);
    expect(back.privateTags).toEqual([]);
    const gone = placePubkeyTags(back.publicTags, back.privateTags, a, 'remove');
    expect(gone.publicTags).toEqual([['p', b]]);
    expect(gone.privateTags).toEqual([]);
  });
});
