import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { coverImageUrl, gutenbergCoverUrl } from './cover';

function ev(tags: string[][]): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: 30040,
    tags,
    content: '',
    sig: 'c'.repeat(128)
  };
}

describe('coverImageUrl', () => {
  it('prefers an image tag and thumbs i.nostr.build', () => {
    expect(coverImageUrl(ev([['image', 'https://example.com/cover.jpg']]))).toBe(
      'https://example.com/cover.jpg'
    );
    expect(coverImageUrl(ev([['image', 'https://i.nostr.build/cover.webp']]))).toBe(
      'https://i.nostr.build/thumb/cover.webp'
    );
  });

  it('turns Gutenberg ebook pages and pg d-tags into cover JPGs', () => {
    expect(coverImageUrl(ev([['s', 'https://www.gutenberg.org/ebooks/141']]))).toBe(
      gutenbergCoverUrl('141')
    );
    expect(coverImageUrl(ev([['d', 'pg141-mansfield-park']]))).toBe(gutenbergCoverUrl('141'));
    expect(coverImageUrl(ev([['i', 'gutenberg:141']]))).toBe(gutenbergCoverUrl('141'));
  });
});
