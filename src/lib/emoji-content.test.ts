import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  emojiInfosFromTags,
  expandCustomEmojiPlaceholders,
  findEmojiShortcodes,
  protectCustomEmojis,
  replaceStandardEmojiShortcodes,
  resolveReactionEmoji
} from './emoji-content';
import { DEFAULT_LIKE_REACTION_DISPLAY_EMOJI } from './reactions';

function reaction(content: string, tags: string[][] = []): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    kind: KIND.REACTION,
    tags,
    content,
    sig: 'c'.repeat(128)
  };
}

describe('emoji-content', () => {
  it('finds standard shortcodes without treating AsciiDoc macros as emoji', () => {
    expect(findEmojiShortcodes('hi :blush: there', []).map((m) => m.shortcode)).toEqual(['blush']);
    expect(findEmojiShortcodes('image::https://example.com/x.png[]', ['path'])).toEqual([]);
    expect(findEmojiShortcodes('link::https://example.com[]', [])).toEqual([]);
  });

  it('replaces standard shortcodes with Unicode', () => {
    expect(replaceStandardEmojiShortcodes('go :rofl:')).toContain('🤣');
    expect(replaceStandardEmojiShortcodes(':blush:')).toBe('😊');
  });

  it('leaves custom shortcodes alone when converting standard ones', () => {
    expect(replaceStandardEmojiShortcodes('いいね:nostopus_roger:', ['nostopus_roger'])).toBe(
      'いいね:nostopus_roger:'
    );
  });

  it('reads NIP-30 emoji tags', () => {
    expect(
      emojiInfosFromTags([
        ['emoji', 'nostopus_roger', 'https://example.com/roger.webp'],
        ['emoji', 'bad', 'javascript:alert(1)'],
        ['t', 'nostr']
      ])
    ).toEqual([{ shortcode: 'nostopus_roger', url: 'https://example.com/roger.webp' }]);
  });

  it('protects and expands custom emoji placeholders', () => {
    const infos = [{ shortcode: 'nostopus_roger', url: 'https://example.com/roger.webp' }];
    const { text, slots } = protectCustomEmojis('いいね:nostopus_roger:', infos);
    expect(text).not.toContain(':nostopus_roger:');
    expect(slots).toHaveLength(1);
    const html = expandCustomEmojiPlaceholders(`<p>${text}</p>`, slots);
    expect(html).toContain('content-emoji');
    expect(html).toContain('https://example.com/roger.webp');
    // Shortcode stays in title; alt stays empty so a failed load cannot clip to ":no".
    expect(html).toContain('title=":nostopus_roger:"');
    expect(html).toContain('alt=""');
  });

  it('uses Unicode alt for shortcodes that are also standard emoji', () => {
    const html = expandCustomEmojiPlaceholders('\uE000EMOJI0\uE000', [
      {
        shortcode: 'clap',
        url: 'https://0x0.happytavern.co/9775c6c1ab336a09a582699fdd675764ffc179f80972204e4bb97e48536c4a7c.gif'
      }
    ]);
    expect(html).toContain('content-emoji');
    expect(html).toContain('alt="👏"');
    expect(html).toContain('title=":clap:"');
    expect(html).not.toContain('alt=":clap:"');
  });

  it('escapes shortcode and url for HTML attributes', () => {
    const html = expandCustomEmojiPlaceholders('\uE000EMOJI0\uE000', [
      {
        shortcode: 'test&#34;onload&#34;test',
        url: 'https://example.com/e.png?x=1&y=2'
      }
    ]);
    expect(html).toContain('title=":test&amp;#34;onload&amp;#34;test:"');
    expect(html).toContain('src="https://example.com/e.png?x=1&amp;y=2"');
    expect(html).not.toMatch(/\sonload=/i);
  });

  it('rejects emoji tags with unsafe shortcodes or non-http urls', () => {
    expect(
      emojiInfosFromTags([
        ['emoji', 'test&#34;onload&#34;test', 'https://example.com/e.png'],
        ['emoji', 'ok', 'https://example.com/e.png" onload="alert(1)'],
        ['emoji', 'fine', 'https://example.com/fine.png']
      ])
    ).toEqual([{ shortcode: 'fine', url: 'https://example.com/fine.png' }]);
  });

  it('matches known custom codes longer than the heuristic cap', () => {
    const long = 'a'.repeat(30);
    const hits = findEmojiShortcodes(`x:${long}:y`, [long]);
    expect(hits.map((m) => m.shortcode)).toEqual([long]);
  });

  it('shows NIP-25 + / empty likes as the generic heart', () => {
    expect(resolveReactionEmoji(reaction('+'))?.unicode).toBe(DEFAULT_LIKE_REACTION_DISPLAY_EMOJI);
    expect(resolveReactionEmoji(reaction(''))?.unicode).toBe(DEFAULT_LIKE_REACTION_DISPLAY_EMOJI);
    expect(resolveReactionEmoji(reaction('❤️'))?.unicode).toBe('❤️');
    expect(resolveReactionEmoji(reaction('👍'))?.unicode).toBeNull();
    expect(resolveReactionEmoji(reaction('👍'))?.raw).toBe('👍');
  });
});
