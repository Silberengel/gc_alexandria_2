import { describe, expect, it } from 'vitest';
import {
  ogHostname,
  parseOgPreviewHtml,
  parseOgPreviewHtmlRegex,
  shouldOgPreview,
  tidyLinkUrl
} from './og-preview';

describe('tidyLinkUrl', () => {
  it('strips trailing punctuation', () => {
    expect(tidyLinkUrl('https://example.com/path.')).toBe('https://example.com/path');
    expect(tidyLinkUrl('https://example.com/path),')).toBe('https://example.com/path');
  });
});

describe('shouldOgPreview', () => {
  it('accepts https page URLs', () => {
    expect(shouldOgPreview('https://example.com/article')).toBe(true);
  });

  it('rejects http, youtube, and direct media', () => {
    expect(shouldOgPreview('http://example.com/x')).toBe(false);
    expect(shouldOgPreview('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    expect(shouldOgPreview('https://cdn.example/pic.jpg')).toBe(false);
    expect(shouldOgPreview('https://cdn.example/clip.mp4')).toBe(false);
  });
});

describe('parseOgPreviewHtml', () => {
  const sample = `
<div class="og-preview-card">
  <div class="og-preview-image mb-2">
    <a href="https://example.com/a" target="_blank" rel="noopener noreferrer">
      <img src="https://cdn.example/cover.jpg" alt="Example" />
    </a>
  </div>
  <div class="og-preview-content">
    <div class="og-preview-title">
      <a href="https://example.com/a" target="_blank" rel="noopener noreferrer"><b>Example Title</b></a>
    </div>
    <div class="og-preview-description">A short description &amp; more</div>
  </div>
</div>
`;

  it('parses unfold HTML cards', () => {
    const parsed = parseOgPreviewHtml(sample, 'https://example.com/a');
    expect(parsed).toEqual({
      url: 'https://example.com/a',
      title: 'Example Title',
      description: 'A short description & more',
      image: 'https://cdn.example/cover.jpg'
    });
  });

  it('regex fallback matches DOM parse for title-only cards', () => {
    const html = `
<div class="og-preview-card">
  <div class="og-preview-content">
    <div class="og-preview-title">
      <a href="https://example.com" target="_blank" rel="noopener noreferrer"><b>Example Domain</b></a>
    </div>
  </div>
</div>`;
    expect(parseOgPreviewHtmlRegex(html, 'https://example.com')).toEqual({
      url: 'https://example.com',
      title: 'Example Domain',
      description: undefined,
      image: undefined
    });
  });

  it('returns null for empty bodies', () => {
    expect(parseOgPreviewHtml('', 'https://example.com')).toBeNull();
    expect(parseOgPreviewHtml('<div>nope</div>', 'https://example.com')).toBeNull();
  });
});

describe('ogHostname', () => {
  it('strips www', () => {
    expect(ogHostname('https://www.example.com/x')).toBe('example.com');
  });
});
