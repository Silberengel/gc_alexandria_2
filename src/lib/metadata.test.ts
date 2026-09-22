import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { cardMeta, hasPublicationSection, sortSearchResults } from './metadata';

function ev(kind: number, tags: string[][], content = '', id = 'a'.repeat(64)): Event {
  return {
    id,
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind,
    tags,
    content,
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

describe('cardMeta summary', () => {
  it('strips asciidoc markup from content excerpts', () => {
    const meta = cardMeta(
      ev(
        30040,
        [['title', 'Sybil'], ['d', 'sybil']],
        '= Sybil Test Utility\n== Description\nimage::https://example.com/x.png[Alt text]\nThis is a simple PHP CLI program.'
      )
    );
    expect(meta.summary).not.toMatch(/image::/);
    expect(meta.summary).not.toMatch(/^=/);
    expect(meta.summary).toContain('This is a simple PHP CLI program');
  });
});

describe('sortSearchResults', () => {
  it('orders publications before wiki and spec', () => {
    const wiki = ev(30818, [['d', 'w']], '', '1'.repeat(64));
    const pub = ev(30040, [['d', 'p']], '', '2'.repeat(64));
    const spec = ev(30817, [['d', 's']], '', '3'.repeat(64));
    const counts = new Map<string, number>();
    const sorted = sortSearchResults([wiki, spec, pub], counts);
    expect(sorted.map((e) => e.kind)).toEqual([30040, 30818, 30817]);
  });
});
