/**
 * Compose-side NIP-30 emoji inventory and publish tag merge.
 */
import { emojis } from '@tiptap/extension-emoji';
import {
  emojiInfosFromTags,
  fetchAuthorEmojiInfos,
  findEmojiShortcodes,
  nativeForShortcode,
  type EmojiInfo
} from './emoji-content';

export type { EmojiInfo };
export { fetchAuthorEmojiInfos, emojiInfosFromTags, nativeForShortcode };

export type UnicodeEmojiEntry = {
  shortcode: string;
  emoji: string;
  name: string;
};

let unicodeCache: UnicodeEmojiEntry[] | null = null;

/** Popular / searchable unicode shortcodes from tiptap's emoji data. */
export function unicodeEmojiCatalog(): UnicodeEmojiEntry[] {
  if (unicodeCache) return unicodeCache;
  const out: UnicodeEmojiEntry[] = [];
  const seen = new Set<string>();
  for (const row of emojis as Array<{ name?: string; emoji?: string; shortcodes?: string[] }>) {
    const glyph = typeof row.emoji === 'string' ? row.emoji : '';
    if (!glyph) continue;
    const codes =
      Array.isArray(row.shortcodes) && row.shortcodes.length
        ? row.shortcodes
        : typeof row.name === 'string'
          ? [row.name]
          : [];
    for (const raw of codes) {
      const shortcode = String(raw ?? '')
        .trim()
        .replace(/\s+/g, '_')
        .toLowerCase();
      if (!shortcode || seen.has(shortcode)) continue;
      seen.add(shortcode);
      out.push({
        shortcode,
        emoji: glyph,
        name: typeof row.name === 'string' ? row.name : shortcode
      });
    }
  }
  unicodeCache = out;
  return out;
}

export function emojiTagRow(info: EmojiInfo): string[] {
  return ['emoji', info.shortcode, info.url];
}

/** Merge emoji tag rows; later rows win on the same shortcode. */
export function mergeEmojiTagRows(...groups: readonly (readonly string[][])[]): string[][] {
  const byCode = new Map<string, string[]>();
  for (const group of groups) {
    for (const row of group) {
      if (row[0] !== 'emoji' || row.length < 3) continue;
      const code = (row[1] ?? '').trim();
      const url = (row[2] ?? '').trim();
      if (!code || !url) continue;
      byCode.set(code.toLowerCase(), ['emoji', code, url]);
    }
  }
  return [...byCode.values()];
}

/**
 * Emit `emoji` tags for custom shortcodes present in content.
 * Inventory supplies the URL; draft tags are merged in as a fallback.
 */
export function emojiTagsForContent(
  content: string,
  inventory: readonly EmojiInfo[],
  draftTags: readonly string[][] = []
): string[][] {
  const byCode = new Map<string, EmojiInfo>();
  for (const info of inventory) {
    const key = info.shortcode.trim().toLowerCase();
    if (key) byCode.set(key, info);
  }
  for (const info of emojiInfosFromTags([...draftTags])) {
    const key = info.shortcode.trim().toLowerCase();
    if (key) byCode.set(key, info);
  }
  if (!byCode.size) return [];

  const matches = findEmojiShortcodes(content, [...byCode.keys()]);
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const key = match.shortcode.trim().toLowerCase();
    if (seen.has(key)) continue;
    const info = byCode.get(key);
    if (!info) continue;
    // Skip unicode-only shortcodes (no custom URL needed on the wire).
    if (!info.url?.trim()) continue;
    seen.add(key);
    out.push(emojiTagRow(info));
  }
  return out;
}

export function insertEmojiShortcode(content: string, shortcode: string, at?: number): string {
  const code = shortcode.trim().replace(/^:|:$/g, '');
  if (!code) return content;
  const token = `:${code}:`;
  if (at == null || at < 0 || at > content.length) {
    const needsSpace = content.length > 0 && !/\s$/.test(content);
    return `${content}${needsSpace ? ' ' : ''}${token}`;
  }
  const before = content.slice(0, at);
  const after = content.slice(at);
  const leftSpace = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const rightSpace = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
  return `${before}${leftSpace}${token}${rightSpace}${after}`;
}
