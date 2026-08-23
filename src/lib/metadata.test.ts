import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { hasPublicationSection } from './metadata';

function ev(kind: number, tags: string[][]): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind,
    tags,
    content: '',
    sig: 'c'.repeat(128)
  };
}

const pk = '1'.repeat(64);

describe('hasPublicationSection', () => {
  it('is true for any section kind on a 30040, including e-tags', () => {
    expect(hasPublicationSection(ev(30040, [['a', `30041:${pk}:ch1`]]))).toBe(true);
    expect(hasPublicationSection(ev(30040, [['a', `30818:${pk}:note`]]))).toBe(true);
    expect(hasPublicationSection(ev(30040, [['a', `11:${pk}:djot`]]))).toBe(true);
    expect(hasPublicationSection(ev(30040, [['e', 'd'.repeat(64)]]))).toBe(true);
  });

  it('is false without section refs, and for non-publications', () => {
    expect(hasPublicationSection(ev(30040, [['title', 'Stub'], ['d', 'stub']]))).toBe(false);
    expect(hasPublicationSection(ev(30818, [['a', `30041:${pk}:ch1`]]))).toBe(false);
  });
});
