import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { coverFullImageUrl, coverImageUrl, gutenbergCoverUrl, readerSectionHeroFullUrl, readerSectionHeroUrl, sectionHeroImageUrl } from './cover';

function ev(tags: string[][], id = 'a'.repeat(64)): Event {
  return {
    id,
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

  it('keeps the full nostr.build URL for the media viewer', () => {
    expect(coverFullImageUrl(ev([['image', 'https://i.nostr.build/cover.webp']]))).toBe(
      'https://i.nostr.build/cover.webp'
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

describe('sectionHeroImageUrl', () => {
  it('uses only an explicit image tag', () => {
    expect(sectionHeroImageUrl(ev([['image', 'https://example.com/hero.jpg']]))).toBe(
      'https://example.com/hero.jpg'
    );
    expect(sectionHeroImageUrl(ev([['image', 'https://i.nostr.build/hero.webp']]))).toBe(
      'https://i.nostr.build/thumb/hero.webp'
    );
    expect(sectionHeroImageUrl(ev([['d', 'pg141-mansfield-park']]))).toBeUndefined();
    expect(sectionHeroImageUrl(ev([['s', 'https://www.gutenberg.org/ebooks/141']]))).toBeUndefined();
  });
});

describe('readerSectionHeroUrl', () => {
  const hero = 'https://example.com/title-page.jpg';
  const edition = ev(
    [
      ['image', hero],
      ['title', 'Bible']
    ],
    '1'.repeat(64)
  );

  it('keeps the top-level edition hero', () => {
    expect(readerSectionHeroUrl(edition, edition)).toBe(hero);
  });

  it('hides a nested index that repeats the edition hero', () => {
    const nested = ev(
      [
        ['image', hero],
        ['title', 'Introduction']
      ],
      '2'.repeat(64)
    );
    expect(readerSectionHeroUrl(nested, edition)).toBeUndefined();
  });

  it('uses Gutenberg / cover sources on the edition root when image is absent', () => {
    const gutenberg = ev([['d', 'pg45631-twelve-years-a-slave'], ['title', 'Twelve Years a Slave']]);
    expect(readerSectionHeroUrl(gutenberg, gutenberg)).toBe(
      'https://www.gutenberg.org/cache/epub/45631/pg45631.cover.medium.jpg'
    );
    expect(readerSectionHeroUrl(gutenberg, null)).toBeUndefined();
  });
});

describe('readerSectionHeroFullUrl', () => {
  it('returns the full Gutenberg cover for the edition root', () => {
    const gutenberg = ev([['d', 'pg45631-twelve-years-a-slave']]);
    expect(readerSectionHeroFullUrl(gutenberg, gutenberg)).toBe(
      'https://www.gutenberg.org/cache/epub/45631/pg45631.cover.medium.jpg'
    );
  });
});
