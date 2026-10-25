import { describe, expect, it } from 'vitest';
import { intersects, protectedRanges } from './grammar-markup-protect';

describe('grammar-markup-protect', () => {
  it('nostr reference span intersects protected ranges', () => {
    const text =
      'See [our site](https://imwald.eu) and nostr:npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
    const ranges = protectedRanges(text);
    const nostrStart = text.indexOf('nostr:');
    expect(intersects(nostrStart, text.length - nostrStart, ranges)).toBe(true);
  });

  it('leaves plain prose outside protected ranges', () => {
    const text = 'Hello world';
    const ranges = protectedRanges(text);
    expect(intersects(0, 'Hello '.length, ranges)).toBe(false);
  });
});
