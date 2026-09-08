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
  it('is true for non-30040 a-tags and for e-tags', () => {
    expect(hasPublicationSection(ev(30040, [['a', `30041:${pk}:ch1`]]))).toBe(true);
    expect(hasPublicationSection(ev(30040, [['a', `30818:${pk}:note`]]))).toBe(true);
    expect(hasPublicationSection(ev(30040, [['a', `30817:${pk}:spec`]]))).toBe(true);
    expect(hasPublicationSection(ev(30040, [['a', `11:${pk}:djot`]]))).toBe(true);
    expect(hasPublicationSection(ev(30040, [['a', `30023:${pk}:essay`]]))).toBe(true);
    expect(hasPublicationSection(ev(30040, [['e', 'd'.repeat(64)]]))).toBe(true);
  });

  it('is false for stubs, nested-only 30040 indexes, and non-publications', () => {
    expect(hasPublicationSection(ev(30040, [['title', 'Stub'], ['d', 'stub']]))).toBe(false);
    expect(hasPublicationSection(ev(30040, [['a', `30040:${pk}:nested`]]))).toBe(false);
    expect(hasPublicationSection(ev(30818, [['a', `30041:${pk}:ch1`]]))).toBe(false);
  });
});
