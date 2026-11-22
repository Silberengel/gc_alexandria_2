import { describe, expect, it } from 'vitest';
import {
  buildReactionClipDraft,
  dedupeGifItems,
  gifItemFromEvent,
  gifItemFromNostrBuild,
  imetaFromGifItem,
  normalizeReactionEmotions,
  sortGifItemsForPicker,
  type GifPickerItem
} from './gif-picker';
import { KIND } from './constants';
import type { Event } from 'nostr-tools';

function item(partial: Partial<GifPickerItem> & Pick<GifPickerItem, 'url'>): GifPickerItem {
  return {
    description: partial.description,
    sha256: partial.sha256,
    mimeType: partial.mimeType ?? 'image/gif',
    sourceKind: partial.sourceKind ?? KIND.REACTION_CLIP,
    eventId: partial.eventId ?? 'e1',
    pubkey: partial.pubkey ?? 'a'.repeat(64),
    createdAt: partial.createdAt ?? 100,
    url: partial.url
  };
}

describe('normalizeReactionEmotions', () => {
  it('defaults to joy', () => {
    expect(normalizeReactionEmotions([])).toEqual(['joy']);
  });

  it('uses description tokens when selected empty', () => {
    expect(normalizeReactionEmotions([], 'funny laughter clip')).toEqual(['laughter']);
  });

  it('keeps selected emotions (max 6)', () => {
    expect(
      normalizeReactionEmotions(['Joy', 'love', 'joy', 'unknown', 'anger'])
    ).toEqual(['joy', 'love', 'anger']);
  });
});

describe('dedupeGifItems / sortGifItemsForPicker', () => {
  it('dedupes by url preferring newer', () => {
    const out = dedupeGifItems([
      item({ url: 'https://x.example/a.gif', createdAt: 1, eventId: 'old' }),
      item({ url: 'https://x.example/a.gif/', createdAt: 5, eventId: 'new' })
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.eventId).toBe('new');
  });

  it('dedupes by sha256 across different URLs', () => {
    const hash = 'ab'.repeat(32);
    const out = dedupeGifItems([
      item({
        url: `https://cdn.example/${hash}.gif`,
        sha256: hash,
        createdAt: 1,
        eventId: 'old',
        sourceKind: 0
      }),
      item({
        url: `https://mirror.example/blob/${hash}`,
        sha256: hash,
        createdAt: 2,
        eventId: 'new',
        sourceKind: KIND.REACTION_CLIP
      })
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.eventId).toBe('new');
    expect(out[0]?.sourceKind).toBe(KIND.REACTION_CLIP);
  });

  it('sorts viewer clips first then by recency', () => {
    const viewer = 'b'.repeat(64);
    const sorted = sortGifItemsForPicker(
      [
        item({ url: 'https://x.example/1.gif', pubkey: 'c'.repeat(64), createdAt: 9 }),
        item({ url: 'https://x.example/2.gif', pubkey: viewer, createdAt: 2 }),
        item({ url: 'https://x.example/3.gif', pubkey: viewer, createdAt: 8 })
      ],
      viewer
    );
    expect(sorted.map((g) => g.url)).toEqual([
      'https://x.example/3.gif',
      'https://x.example/2.gif',
      'https://x.example/1.gif'
    ]);
  });
});

describe('imetaFromGifItem / buildReactionClipDraft', () => {
  it('builds imeta with url m x', () => {
    const tag = imetaFromGifItem(
      item({
        url: 'https://blossom.example/ab.gif',
        sha256: 'a'.repeat(64),
        mimeType: 'image/gif',
        description: 'cat'
      })
    );
    expect(tag[0]).toBe('imeta');
    expect(tag).toContain(`url https://blossom.example/ab.gif`);
    expect(tag).toContain(`x ${'a'.repeat(64)}`);
    expect(tag).toContain('m image/gif');
    expect(tag).toContain('alt cat');
  });

  it('builds a valid 1090 draft with default joy', () => {
    const draft = buildReactionClipDraft({
      url: 'https://blossom.example/ab.gif',
      sha256: 'ab'.padEnd(64, '0'),
      description: 'cats'
    });
    expect(draft).not.toBeNull();
    expect(draft!.kind).toBe(KIND.REACTION_CLIP);
    expect(draft!.content).toBe('');
    expect(draft!.tags).toContainEqual(['url', 'https://blossom.example/ab.gif']);
    expect(draft!.tags).toContainEqual(['L', 'emotion']);
    expect(draft!.tags).toContainEqual(['l', 'joy', 'emotion']);
    expect(draft!.tags).toContainEqual(['t', 'gif']);
  });
});

describe('gifItemFromNostrBuild', () => {
  it('maps search pick fields for compose insert', () => {
    const hash = 'cd'.repeat(32);
    const item = gifItemFromNostrBuild({
      id: `${hash}.gif`,
      url: `https://gifs.nostr.build/${hash}.gif`,
      width: 10,
      height: 20,
      bytes: 99,
      format: 'webp',
      title: 'wave',
      mp4: `https://gifs.nostr.build/mp4/orig/${hash}.gif`
    });
    expect(item.sha256).toBe(hash);
    expect(item.mimeType).toBe('image/webp');
    expect(item.dim).toBe('10x20');
    expect(item.description).toBe('wave');
    expect(item.sourceKind).toBe(0);
  });
});

describe('gifItemFromEvent', () => {
  it('parses imeta and top-level url/x', () => {
    const ev = {
      id: 'id1',
      pubkey: 'd'.repeat(64),
      kind: KIND.REACTION_CLIP,
      created_at: 42,
      content: '',
      tags: [
        ['url', 'https://cdn.example/x.gif'],
        ['imeta', 'url https://cdn.example/x.gif', 'm image/gif', `x ${'c'.repeat(64)}`, 'alt wow'],
        ['x', 'c'.repeat(64)]
      ],
      sig: ''
    } as Event;
    const item = gifItemFromEvent(ev);
    expect(item?.url).toBe('https://cdn.example/x.gif');
    expect(item?.sha256).toBe('c'.repeat(64));
    expect(item?.description).toBe('wow');
  });
});
