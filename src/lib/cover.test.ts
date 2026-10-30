import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  contentHasEarlyHeroImage,
  coverFullImageUrl,
  coverImageUrl,
  eventHeroImageUrls,
  isContentHeroKind,
  gutenbergCoverUrl,
  paintedAncestorHeroUrls,
  readerSectionHeroFullUrl,
  readerSectionHeroUrl,
  sectionHeroImageUrl,
  stripEarlyDuplicateHeroImage,
  wikiSpecHeroThumbUrl
} from './cover';

function ev(tags: string[][], id = 'a'.repeat(64), kind: number = KIND.PUBLICATION): Event {
  return {
    id,
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind,
    tags,
    content: '',
    sig: 'c'.repeat(128)
  };
}

describe('isContentHeroKind', () => {
  it('marks article kinds that paint the image tag in the header', () => {
    expect(isContentHeroKind(KIND.LONG_FORM)).toBe(true);
    expect(isContentHeroKind(KIND.WIKI)).toBe(true);
    expect(isContentHeroKind(KIND.SPEC)).toBe(true);
    expect(isContentHeroKind(KIND.PUBLICATION)).toBe(true);
    expect(isContentHeroKind(1)).toBe(false);
    expect(isContentHeroKind(KIND.PICTURE)).toBe(false);
  });
});

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

  it('does not treat content images as an image tag', () => {
    const event = ev([]);
    event.content = '![plate](https://example.com/from-content.jpg)';
    expect(sectionHeroImageUrl(event)).toBeUndefined();
  });
});

describe('wikiSpecHeroThumbUrl', () => {
  it('uses image, then content, then imeta — never Gutenberg from d', () => {
    expect(
      wikiSpecHeroThumbUrl(
        ev([['image', 'https://example.com/tag.jpg'], ['d', 'pg141-mansfield-park']])
      )
    ).toBe('https://example.com/tag.jpg');

    const fromContent = ev([['d', 'ocicat']]);
    fromContent.kind = KIND.WIKI;
    fromContent.content = '![cat](https://example.com/body.jpg)';
    expect(wikiSpecHeroThumbUrl(fromContent)).toBe('https://example.com/body.jpg');

    const fromImeta = ev([
      ['d', 'smp-park'],
      ['imeta', 'url https://blossom.example/a.jpg', 'm image/jpeg']
    ]);
    fromImeta.kind = KIND.WIKI;
    expect(wikiSpecHeroThumbUrl(fromImeta)).toBe('https://blossom.example/a.jpg');

    expect(wikiSpecHeroThumbUrl(ev([['d', 'pg141-mansfield-park']]))).toBeUndefined();
  });
});

describe('content hero fallback', () => {
  it('uses the first content image when the OP has no image tag', () => {
    const event = ev([['title', 'Notes']]);
    event.content = '![first](https://example.com/first.jpg)\n\n![second](https://example.com/second.jpg)';
    expect(readerSectionHeroUrl(event, event)).toBe('https://example.com/first.jpg');
    expect(readerSectionHeroFullUrl(event, event)).toBe('https://example.com/first.jpg');
  });

  it('prefers an AsciiDoc image that appears before a later markdown image', () => {
    const event = ev([['title', 'Notes']]);
    event.content = 'image::https://example.com/ascii.png[Plate]\n\n![](https://example.com/later.jpg)';
    expect(readerSectionHeroUrl(event, event)).toBe('https://example.com/ascii.png');
  });

  it('keeps the image tag ahead of a content image', () => {
    const event = ev([['image', 'https://example.com/tag.jpg'], ['title', 'Notes']]);
    event.content = '![](https://example.com/content.jpg)';
    expect(readerSectionHeroUrl(event, event)).toBe('https://example.com/tag.jpg');
  });

  it('uses the first image in a later content section when the OP body has none', () => {
    const op = ev([['title', 'Index']], '1'.repeat(64));
    const chapter = ev([['title', 'Chapter']], '2'.repeat(64));
    chapter.kind = 30041;
    chapter.content = 'image::https://i.nostr.build/plate.webp[]';
    expect(readerSectionHeroUrl(op, op, [op, chapter])).toBe('https://i.nostr.build/thumb/plate.webp');
    expect(readerSectionHeroFullUrl(op, op, [op, chapter])).toBe('https://i.nostr.build/plate.webp');
    expect(readerSectionHeroUrl(chapter, op, [op, chapter])).toBeUndefined();
  });

  it('still uses Gutenberg when the OP has no image tag and no content image', () => {
    const gutenberg = ev([['d', 'pg45631-twelve-years-a-slave'], ['title', 'Twelve Years a Slave']]);
    expect(readerSectionHeroUrl(gutenberg, gutenberg)).toBe(
      'https://www.gutenberg.org/cache/epub/45631/pg45631.cover.medium.jpg'
    );
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

  it('hides a verse/section that repeats the painted chapter index plate', () => {
    const plate = 'https://example.com/judges-ch1.jpg';
    const root = ev([['title', 'Bible']], '1'.repeat(64));
    const chapter = ev(
      [
        ['image', plate],
        ['title', 'Judges Chapter 1'],
        ['type', 'bible']
      ],
      '2'.repeat(64)
    );
    const verse = ev(
      [
        ['image', plate],
        ['title', '1:1'],
        ['type', 'bible']
      ],
      '3'.repeat(64),
      KIND.SECTION
    );
    const painted = [chapter, verse];
    expect(paintedAncestorHeroUrls(verse, root, painted)).toContain(plate);
    // Bible verses skip the hero figure entirely.
    expect(readerSectionHeroUrl(verse, root, painted)).toBeUndefined();
    // Non-bible leaf with the same plate as the painted chapter is also suppressed.
    const leaf = ev([['image', plate], ['title', '1']], '4'.repeat(64), KIND.SECTION);
    expect(readerSectionHeroUrl(leaf, root, [chapter, leaf])).toBeUndefined();
  });

  it('keeps a nested hero that differs from edition and chapter', () => {
    const root = ev([['image', 'https://example.com/edition.jpg'], ['title', 'Book']], '1'.repeat(64));
    const chapter = ev(
      [['image', 'https://example.com/chapter.jpg'], ['title', 'Ch 1']],
      '2'.repeat(64)
    );
    const leaf = ev(
      [['image', 'https://example.com/unique.jpg'], ['title', 'Aside']],
      '3'.repeat(64),
      KIND.SECTION
    );
    expect(readerSectionHeroUrl(leaf, root, [chapter, leaf])).toBe('https://example.com/unique.jpg');
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
