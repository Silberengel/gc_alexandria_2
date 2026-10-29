import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  closeMediaViewer,
  mediaViewer,
  openMediaViewer,
  openSnoMediaViewer,
  stepMediaViewer
} from './media-viewer';

describe('mediaViewer slideshow', () => {
  beforeEach(() => {
    closeMediaViewer();
    // closeMediaViewer may try history.back; force a clean empty state.
    mediaViewer.set({ open: false, url: '', urls: [], alts: [], index: 0, title: '', sno: null });
  });

  it('opens a single image without a multi-slide list', () => {
    openMediaViewer({ url: 'https://cdn.example/a.jpg', title: 'One' });
    const state = get(mediaViewer);
    expect(state.open).toBe(true);
    expect(state.urls).toEqual(['https://cdn.example/a.jpg']);
    expect(state.index).toBe(0);
    expect(state.url).toBe('https://cdn.example/a.jpg');
  });

  it('opens a gallery on the clicked slide and steps with wrap', () => {
    const urls = [
      'https://cdn.example/a.jpg',
      'https://cdn.example/b.jpg',
      'https://cdn.example/c.jpg'
    ];
    openMediaViewer({ url: urls[1], urls, title: 'Album' });
    expect(get(mediaViewer).index).toBe(1);
    expect(get(mediaViewer).url).toBe(urls[1]);

    stepMediaViewer(1);
    expect(get(mediaViewer).index).toBe(2);
    expect(get(mediaViewer).url).toBe(urls[2]);

    stepMediaViewer(1);
    expect(get(mediaViewer).index).toBe(0);
    expect(get(mediaViewer).url).toBe(urls[0]);

    stepMediaViewer(-1);
    expect(get(mediaViewer).index).toBe(2);
  });

  it('dedupes urls case-insensitively', () => {
    openMediaViewer({
      urls: [
        'https://cdn.example/A.jpg',
        'https://cdn.example/a.jpg',
        'https://cdn.example/b.jpg'
      ]
    });
    expect(get(mediaViewer).urls).toEqual([
      'https://cdn.example/A.jpg',
      'https://cdn.example/b.jpg'
    ]);
  });

  it('keeps per-slide imeta alt text aligned with urls', () => {
    openMediaViewer({
      urls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
      alts: ['First photo', 'Second photo'],
      url: 'https://cdn.example/b.jpg'
    });
    const state = get(mediaViewer);
    expect(state.index).toBe(1);
    expect(state.alts).toEqual(['First photo', 'Second photo']);
    expect(state.alts[state.index]).toBe('Second photo');
  });

  it('opens a 3D object and clears it when an image opens', () => {
    openSnoMediaViewer({ content: '{"v":2}', name: 'AJ FU' });
    expect(get(mediaViewer).open).toBe(true);
    expect(get(mediaViewer).sno).toEqual({ content: '{"v":2}', name: 'AJ FU' });
    expect(get(mediaViewer).urls).toEqual([]);

    openMediaViewer({ url: 'https://cdn.example/a.jpg' });
    expect(get(mediaViewer).sno).toBeNull();
    expect(get(mediaViewer).url).toBe('https://cdn.example/a.jpg');
  });
});
