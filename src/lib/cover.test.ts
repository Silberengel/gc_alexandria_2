import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import {
  contentHasEarlyHeroImage,
  coverFullImageUrl,
  coverImageUrl,
  eventHeroImageUrls,
  gutenbergCoverUrl,
  readerSectionHeroFullUrl,
  readerSectionHeroUrl,
  sectionHeroImageUrl,
  stripEarlyDuplicateHeroImage
} from './cover';

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

  it('hides a nested section when image matches via nostr.build thumb/full', () => {
    const full = 'https://i.nostr.build/cover.webp';
    const root = ev([['image', full], ['title', 'Mag']], '1'.repeat(64));
    const leaf = ev(
      [
        ['image', 'https://i.nostr.build/thumb/cover.webp'],
        ['title', 'Intro']
      ],
      '2'.repeat(64)
    );
    expect(readerSectionHeroUrl(leaf, root)).toBeUndefined();
  });

  it('hides a nested section when the same plate is hosted on different origins', () => {
    const root = ev(
      [['image', 'https://blog.imwald.eu/assets/laeserin_logo-iPPO3wF.png'], ['title', 'Mag']],
      '1'.repeat(64)
    );
    const leaf = ev(
      [
        ['image', 'https://git.imwald.eu/silberengel/unfold/raw/branch/imwald/assets/laeserin_logo.png'],
        ['title', 'Intro']
      ],
      '2'.repeat(64)
    );
    expect(readerSectionHeroUrl(leaf, root)).toBeUndefined();
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

describe('contentHasEarlyHeroImage', () => {
  const hero = 'https://i.nostr.build/cover.webp';
  const thumb = 'https://i.nostr.build/thumb/cover.webp';

  it('detects a leading markdown image matching the hero thumb', () => {
    expect(contentHasEarlyHeroImage(`![](${hero})\n\nA Nostr magazine`, [thumb])).toBe(true);
  });

  it('detects a bare nostr.build URL on its own line', () => {
    expect(contentHasEarlyHeroImage(`${hero}\n\nHello`, [thumb])).toBe(true);
  });

  it('detects an AsciiDoc image macro', () => {
    expect(contentHasEarlyHeroImage(`image::${hero}[]\n\nIntro`, [hero])).toBe(true);
  });

  it('ignores a matching image deeper in the article', () => {
    const body = `One.\n\nTwo.\n\n![](${hero})\n\nMore`;
    expect(contentHasEarlyHeroImage(body, [hero])).toBe(false);
  });

  it('ignores a different early image', () => {
    expect(contentHasEarlyHeroImage('![](https://example.com/other.jpg)\n\nHi', [hero])).toBe(
      false
    );
  });
});

describe('stripEarlyDuplicateHeroImage', () => {
  const hero = 'https://i.nostr.build/cover.webp';
  const thumb = 'https://i.nostr.build/thumb/cover.webp';

  it('removes a leading body image that matches the hero', () => {
    const html = `<p><img src="${hero}" alt=""></p><p>Hello</p>`;
    expect(stripEarlyDuplicateHeroImage(html, [thumb])).toBe('<p>Hello</p>');
  });

  it('removes a cover after a short lede paragraph', () => {
    const html = `<p>Intro text.</p><p><img src="${hero}" alt="cover"></p><p>More</p>`;
    expect(stripEarlyDuplicateHeroImage(html, [hero])).toBe('<p>Intro text.</p><p>More</p>');
  });

  it('keeps a matching image deeper in the article', () => {
    const html = `<p>One.</p><p>Two.</p><p><img src="${hero}" alt=""></p>`;
    expect(stripEarlyDuplicateHeroImage(html, [hero])).toBe(html);
  });

  it('keeps a different early image', () => {
    const html = `<p><img src="https://example.com/other.jpg" alt=""></p>`;
    expect(stripEarlyDuplicateHeroImage(html, [hero])).toBe(html);
  });

  it('lists hero candidates from the image tag', () => {
    const urls = eventHeroImageUrls(ev([['image', hero]]));
    expect(urls).toContain(hero);
    expect(urls).toContain(thumb);
  });
});
