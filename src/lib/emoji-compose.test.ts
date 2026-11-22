import { describe, expect, it } from 'vitest';
import {
  emojiTagsForContent,
  insertEmojiShortcode,
  mergeEmojiTagRows
} from './emoji-compose';

describe('emojiTagsForContent', () => {
  it('only tags shortcodes present in content', () => {
    const inventory = [
      { shortcode: 'blobcat', url: 'https://cdn.example/blobcat.png' },
      { shortcode: 'unused', url: 'https://cdn.example/unused.png' }
    ];
    const tags = emojiTagsForContent('hello :blobcat: there', inventory);
    expect(tags).toEqual([['emoji', 'blobcat', 'https://cdn.example/blobcat.png']]);
  });

  it('merges draft tags as inventory fallback', () => {
    const tags = emojiTagsForContent('hi :drafty:', [], [
      ['emoji', 'drafty', 'https://cdn.example/drafty.webp']
    ]);
    expect(tags).toEqual([['emoji', 'drafty', 'https://cdn.example/drafty.webp']]);
  });

  it('skips shortcodes without a url', () => {
    expect(emojiTagsForContent(':smile:', [{ shortcode: 'smile', url: '' }])).toEqual([]);
  });
});

describe('mergeEmojiTagRows / insertEmojiShortcode', () => {
  it('later rows win on shortcode', () => {
    const merged = mergeEmojiTagRows(
      [['emoji', 'x', 'https://a.example/1.png']],
      [['emoji', 'x', 'https://b.example/2.png']]
    );
    expect(merged).toEqual([['emoji', 'x', 'https://b.example/2.png']]);
  });

  it('inserts shortcode with spacing', () => {
    expect(insertEmojiShortcode('hi', 'wave')).toBe('hi :wave:');
    expect(insertEmojiShortcode('hi ', 'wave')).toBe('hi :wave:');
    expect(insertEmojiShortcode('abcdef', 'x', 3)).toBe('abc :x: def');
  });
});
