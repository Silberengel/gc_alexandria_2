import { describe, expect, it } from 'vitest';
import { cropRenderedUrl, cropRenderedUrlsInHtml, cropRenderedUrlsInText, formatUrlHtml } from './crop-url';

const head = 'https://example.com/' + 'a'.repeat(80);
const tail = 'z'.repeat(50);
const long = `${head}${'m'.repeat(40)}${tail}`;

const alexandria =
  'https://gc-alexandria.imwald.eu/#/spec/d/nip-84/p/npub1l5sga6xg72phsz5422ykujprejwud075ggrr3z2hwyrfgr7eylqstegx9z?read=1&section=d04fd73bdb8c85fb9fbd1a49fb7f3f79a4fd9e6054d61733ecadbaf7861707ba&quote=Quote+Highlights';

const youtubeTracked = 'https://www.youtube.com/live/Pr80H5oZdr8?si=lBisTLqlZ4jewk2b';

describe('cropRenderedUrl', () => {
  it('still soft-crops chrome labels', () => {
    expect(cropRenderedUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(cropRenderedUrl(long)).toBe(`${long.slice(0, 100)}...${long.slice(-50)}`);
  });
});

describe('formatUrlHtml', () => {
  it('keeps a long SPA deep link whole and linked', () => {
    const html = formatUrlHtml(alexandria);
    const escaped = alexandria.replace(/&/g, '&amp;');
    expect(html).toContain(`href="${escaped}"`);
    expect(html).toContain(`>${escaped}</a>`);
    expect(html).not.toContain('...');
    expect(html).not.toContain('url-track-warn');
  });

  it('links only the safe YouTube prefix and leaves ?si= as plaintext with a warning', () => {
    const html = formatUrlHtml(youtubeTracked);
    expect(html).toContain('href="https://www.youtube.com/live/Pr80H5oZdr8"');
    expect(html).toContain('>https://www.youtube.com/live/Pr80H5oZdr8</a>');
    expect(html).toContain('<span class="url-split-tail">?si=lBisTLqlZ4jewk2b</span>');
    expect(html).toContain('url-track-warn');
    expect(html).toContain('share tracking');
  });
});

describe('cropRenderedUrlsInHtml', () => {
  it('does not ellipsis-crop a long URL-as-label anchor', () => {
    const html = `<p>See <a href="${alexandria}">${alexandria}</a> now.</p>`;
    const out = cropRenderedUrlsInHtml(html);
    const escaped = alexandria.replace(/&/g, '&amp;');
    expect(out).toContain(`href="${escaped}"`);
    expect(out).toContain(`>${escaped}</a>`);
    expect(out).not.toContain('...');
  });

  it('splits tracker tails out of URL-as-label anchors', () => {
    const html = `<a href="${youtubeTracked}">${youtubeTracked}</a>`;
    const out = cropRenderedUrlsInHtml(html);
    expect(out).toContain('href="https://www.youtube.com/live/Pr80H5oZdr8"');
    expect(out).toContain('url-split-tail');
    expect(out).toContain('?si=lBisTLqlZ4jewk2b');
    expect(out).toContain('url-track-warn');
  });

  it('does not rewrite a link whose label is not the URL', () => {
    const html = `<a href="${long}" title="docs">the docs</a>`;
    expect(cropRenderedUrlsInHtml(html)).toBe(html);
  });

  it('warns on custom-label links that still carry trackers', () => {
    const html = `<a href="${youtubeTracked}">watch this</a>`;
    const out = cropRenderedUrlsInHtml(html);
    expect(out).toContain('href="https://www.youtube.com/live/Pr80H5oZdr8"');
    expect(out).toContain('>watch this</a>');
    expect(out).toContain('url-track-warn');
  });

  it('keeps an image src intact while formatting a bare URL in text', () => {
    const html = `<p>${youtubeTracked}</p><img src="${long}" alt="">`;
    const out = cropRenderedUrlsInHtml(html);
    expect(out).toContain(`src="${long}"`);
    expect(out).toContain('url-split-tail');
    expect(out).not.toContain(`<p>${youtubeTracked}</p>`);
  });
});

describe('cropRenderedUrlsInText', () => {
  it('leaves prose URLs whole so they stay copyable', () => {
    expect(cropRenderedUrlsInText(`before ${alexandria}.`)).toBe(`before ${alexandria}.`);
    expect(cropRenderedUrlsInText(`before ${long}.`)).toBe(`before ${long}.`);
  });
});
