import { describe, expect, it } from 'vitest';
import { looksLikeMediaUrl } from './media-paste';

describe('looksLikeMediaUrl', () => {
  it('accepts single media URLs', () => {
    expect(looksLikeMediaUrl('https://cdn.example/a.png')).toBe(true);
    expect(looksLikeMediaUrl('https://cdn.example/a.JPG?utm_source=x')).toBe(true);
    expect(looksLikeMediaUrl('https://cdn.example/clip.mp4')).toBe(true);
  });

  it('rejects non-media or multi-line pastes', () => {
    expect(looksLikeMediaUrl('https://example.com/about')).toBe(false);
    expect(looksLikeMediaUrl('https://a.example/a.png\nhttps://b.example/b.png')).toBe(false);
    expect(looksLikeMediaUrl('hello')).toBe(false);
  });
});
