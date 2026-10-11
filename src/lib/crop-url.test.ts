import { describe, expect, it } from 'vitest';
import { cropRenderedUrl, cropRenderedUrlsInHtml, cropRenderedUrlsInText } from './crop-url';

const head = 'https://example.com/' + 'a'.repeat(80);
const tail = 'z'.repeat(50);
const long = `${head}${'m'.repeat(40)}${tail}`;

describe('cropRenderedUrl', () => {
  it('leaves a short URL whole', () => {
    expect(cropRenderedUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(cropRenderedUrl('x'.repeat(150))).toBe('x'.repeat(150));
  });

  it('keeps the first 100 characters and the last 50', () => {
    expect(long.length).toBeGreaterThan(150);
    const cropped = cropRenderedUrl(long);
    expect(cropped).toBe(`${long.slice(0, 100)}...${long.slice(-50)}`);
    expect(cropped.startsWith(long.slice(0, 100))).toBe(true);
    expect(cropped.endsWith(tail)).toBe(true);
  });
});

describe('cropRenderedUrlsInHtml', () => {
  it('shortens link text and leaves the href whole', () => {
    const html = `<p>See <a href="${long}">${long}</a> now.</p>`;
    const out = cropRenderedUrlsInHtml(html);
    expect(out).toContain(`href="${long}"`);
    expect(out).toContain(`>${long.slice(0, 100)}...${long.slice(-50)}</a>`);
    expect(out).toContain(`title="${long}"`);
    expect(out).not.toContain(`>${long}</a>`);
  });

  it('does not rewrite a link whose label is not the URL', () => {
    const html = `<a href="${long}" title="docs">the docs</a>`;
    expect(cropRenderedUrlsInHtml(html)).toBe(html);
  });

  it('shortens a URL in plain text and keeps an image src', () => {
    const html = `<p>${long}</p><img src="${long}" alt="">`;
    const out = cropRenderedUrlsInHtml(html);
    expect(out).toContain(`src="${long}"`);
    expect(out).toContain(`${long.slice(0, 100)}...${tail}`);
    expect(out).not.toContain(`<p>${long}</p>`);
  });
});

describe('cropRenderedUrlsInText', () => {
  it('crops each URL and keeps the surrounding sentence', () => {
    expect(cropRenderedUrlsInText(`before ${long}.`)).toBe(
      `before ${long.slice(0, 100)}...${tail}.`
    );
  });
});
