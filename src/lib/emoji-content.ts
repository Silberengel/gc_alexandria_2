/**
 * NIP-30 / jumble-style emoji shortcodes in note content.
 * - Standard `:blush:` / `:rofl:` → Unicode via @tiptap/extension-emoji
 * - Custom `:shortcode:` from event `emoji` tags (and author packs when needed) → <img>
 */
import type { Event } from 'nostr-tools';
import { emojis, shortcodeToEmoji } from '@tiptap/extension-emoji';
import { KIND } from './constants';
import { isAllowedMediaUrl } from './markup';
import { fetchByAddress } from './nostr/fetch';
import { relayPool } from './nostr/pool';
import { profileStack, socialStack } from './nostr/selector';
import { memoryFindMetadata, rememberEvents } from './nostr/event-memory';

export const EMOJI_SHORT_CODE_MAX_INNER_LENGTH = 20 as const;

const _emojiInnerQuantifier = EMOJI_SHORT_CODE_MAX_INNER_LENGTH - 1;

/** AsciiDoc-safe: avoid `link::` / `image::` double-colon macros. */
export const EMOJI_SHORT_CODE_REGEX = new RegExp(
  `(?<!:):([a-zA-Z0-9_\\-][^:]{0,${_emojiInnerQuantifier}}):`,
  'g'
);

export type EmojiInfo = { shortcode: string; url: string };

export type EmojiShortcodeMatch = {
  index: number;
  end: number;
  shortcode: string;
  raw: string;
};

const PLACEHOLDER_RE = /\uE000EMOJI(\d+)\uE000/g;

export function emojiInfosFromTags(tags: string[][] = []): EmojiInfo[] {
  const out: EmojiInfo[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (tag[0] !== 'emoji' || tag.length < 3) continue;
    const shortcode = (tag[1] ?? '').trim();
    const url = (tag[2] ?? '').trim();
    if (!shortcode || !url || !isAllowedMediaUrl(url)) continue;
    const key = shortcode.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ shortcode, url });
  }
  return out;
}

/**
 * Prefer known NIP-30 shortcodes (longest-first); remaining spans use the
 * AsciiDoc-safe heuristic regex (same approach as jumble).
 */
export function findEmojiShortcodes(
  text: string,
  knownShortcodes: readonly string[] = []
): EmojiShortcodeMatch[] {
  if (!text) return [];

  const knownOrdered = [
    ...new Map(
      knownShortcodes
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => [s.toLowerCase(), s] as const)
    ).values()
  ].sort((a, b) => b.length - a.length);

  const knownMatches: EmojiShortcodeMatch[] = [];
  if (knownOrdered.length > 0) {
    let i = 0;
    while (i < text.length) {
      if (text[i] !== ':') {
        i += 1;
        continue;
      }
      let hit: EmojiShortcodeMatch | null = null;
      for (const code of knownOrdered) {
        const end = i + 1 + code.length;
        if (end >= text.length || text[end] !== ':') continue;
        const inner = text.slice(i + 1, end);
        if (inner.includes('\n')) continue;
        if (inner.toLowerCase() !== code.toLowerCase()) continue;
        hit = {
          index: i,
          end: end + 1,
          shortcode: code,
          raw: text.slice(i, end + 1)
        };
        break;
      }
      if (hit) {
        knownMatches.push(hit);
        i = hit.end;
        continue;
      }
      i += 1;
    }
  }

  const covered = new Uint8Array(text.length);
  for (const m of knownMatches) {
    covered.fill(1, m.index, m.end);
  }

  const out = [...knownMatches];
  EMOJI_SHORT_CODE_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMOJI_SHORT_CODE_REGEX.exec(text)) !== null) {
    const index = m.index;
    const end = index + m[0].length;
    let overlap = false;
    for (let j = index; j < end; j += 1) {
      if (covered[j]) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    out.push({
      index,
      end,
      shortcode: (m[1] ?? m[0].slice(1, -1)).trim(),
      raw: m[0]
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

function nativeForShortcode(code: string): string | null {
  const trimmed = code.trim();
  const native =
    shortcodeToEmoji(trimmed, emojis) ??
    shortcodeToEmoji(trimmed.replace(/\s+/g, '_'), emojis);
  return native?.emoji ?? null;
}

/** Replace standard (non-custom) :shortcode: with Unicode emoji. */
export function replaceStandardEmojiShortcodes(
  content: string,
  customShortcodes: readonly string[] = []
): string {
  const customSet = new Set(
    customShortcodes.map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  const matches = findEmojiShortcodes(content, [...customSet]);
  if (!matches.length) return content;

  let out = '';
  let last = 0;
  for (const match of matches) {
    out += content.slice(last, match.index);
    const key = match.shortcode.trim().toLowerCase();
    if (customSet.has(key)) {
      out += match.raw;
    } else {
      out += nativeForShortcode(match.shortcode) ?? match.raw;
    }
    last = match.end;
  }
  out += content.slice(last);
  return out;
}

function placeholderFor(index: number): string {
  return `\uE000EMOJI${index}\uE000`;
}

/**
 * Swap custom :shortcode: for private-use placeholders that survive markup + sanitize,
 * then restore as <img> via {@link expandCustomEmojiPlaceholders}.
 */
export function protectCustomEmojis(
  content: string,
  infos: readonly EmojiInfo[]
): { text: string; slots: EmojiInfo[] } {
  if (!infos.length || !content) return { text: content, slots: [] };
  const byCode = new Map(infos.map((e) => [e.shortcode.trim().toLowerCase(), e]));
  const matches = findEmojiShortcodes(content, [...byCode.keys()]);
  if (!matches.length) return { text: content, slots: [] };

  const slots: EmojiInfo[] = [];
  let out = '';
  let last = 0;
  for (const match of matches) {
    out += content.slice(last, match.index);
    const info = byCode.get(match.shortcode.trim().toLowerCase());
    if (info) {
      const i = slots.length;
      slots.push(info);
      out += placeholderFor(i);
    } else {
      out += match.raw;
    }
    last = match.end;
  }
  out += content.slice(last);
  return { text: out, slots };
}

export function expandCustomEmojiPlaceholders(html: string, slots: readonly EmojiInfo[]): string {
  if (!slots.length || !html) return html;
  return html.replace(PLACEHOLDER_RE, (_full, num) => {
    const info = slots[Number(num)];
    if (!info || !isAllowedMediaUrl(info.url)) return `:${num}:`;
    const code = info.shortcode.replace(/"/g, '');
    const src = info.url.replace(/"/g, '&quot;');
    return `<img class="content-emoji" src="${src}" alt=":${code}:" title=":${code}:" loading="lazy" decoding="async" />`;
  });
}

export function contentNeedsAuthorEmojiLookup(
  content: string | undefined,
  eventTagInfos: readonly EmojiInfo[]
): boolean {
  if (!content) return false;
  const eventCodes = new Set(eventTagInfos.map((e) => e.shortcode.trim().toLowerCase()));
  const known = eventTagInfos.map((e) => e.shortcode);
  for (const match of findEmojiShortcodes(content, known)) {
    const code = match.shortcode.trim();
    if (eventCodes.has(code.toLowerCase())) continue;
    if (!nativeForShortcode(code)) return true;
  }
  return false;
}

function addEmojis(map: Map<string, EmojiInfo>, list: EmojiInfo[]): void {
  for (const e of list) {
    const sc = e.shortcode?.trim();
    const url = e.url?.trim();
    if (sc && url && isAllowedMediaUrl(url)) map.set(sc.toLowerCase(), { shortcode: sc, url });
  }
}

const authorEmojiCache = new Map<string, EmojiInfo[]>();
const authorEmojiInflight = new Map<string, Promise<EmojiInfo[]>>();

async function fetchAuthorEmojiInfos(pubkey: string): Promise<EmojiInfo[]> {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return [];
  const cached = authorEmojiCache.get(pk);
  if (cached) return cached;
  const existing = authorEmojiInflight.get(pk);
  if (existing) return existing;

  const run = (async (): Promise<EmojiInfo[]> => {
    const byShortcode = new Map<string, EmojiInfo>();
    const meta = memoryFindMetadata(pk);
    if (meta) addEmojis(byShortcode, emojiInfosFromTags(meta.tags));

    const relays = [...new Set([...profileStack(), ...socialStack()])].slice(0, 6);
    const [metas, lists] = await Promise.all([
      relayPool.query(relays, [{ kinds: [KIND.METADATA], authors: [pk], limit: 1 }], 4_000, 4),
      relayPool.query(relays, [{ kinds: [KIND.USER_EMOJI_LIST], authors: [pk], limit: 1 }], 4_000, 4)
    ]);
    rememberEvents([...metas, ...lists]);
    const kind0 = metas[0] ?? meta;
    if (kind0) addEmojis(byShortcode, emojiInfosFromTags(kind0.tags));

    const list = lists[0];
    if (list) {
      addEmojis(byShortcode, emojiInfosFromTags(list.tags));
      const packCoords = list.tags
        .filter((t) => t[0] === 'a' && t[1]?.startsWith(`${KIND.EMOJI_SET}:`))
        .map((t) => t[1]!)
        .slice(0, 24);
      const packs = await Promise.all(packCoords.map((coord) => fetchByAddress(coord)));
      for (const pack of packs) {
        if (!pack) continue;
        rememberEvents([pack]);
        addEmojis(byShortcode, emojiInfosFromTags(pack.tags));
      }
    }

    const result = [...byShortcode.values()];
    authorEmojiCache.set(pk, result);
    return result;
  })().finally(() => {
    authorEmojiInflight.delete(pk);
  });

  authorEmojiInflight.set(pk, run);
  return run;
}

/** Event emoji tags win over the same shortcode from the author. */
export function mergeEmojiInfos(
  fromAuthor: readonly EmojiInfo[],
  fromEvent: readonly EmojiInfo[]
): EmojiInfo[] {
  const m = new Map<string, EmojiInfo>();
  for (const e of fromAuthor) m.set(e.shortcode.trim().toLowerCase(), e);
  for (const e of fromEvent) m.set(e.shortcode.trim().toLowerCase(), e);
  return [...m.values()];
}

export async function resolveEmojiInfosForEvent(event: Event | null | undefined): Promise<EmojiInfo[]> {
  if (!event) return [];
  const fromEvent = emojiInfosFromTags(event.tags);
  if (!contentNeedsAuthorEmojiLookup(event.content, fromEvent)) return fromEvent;
  const fromAuthor = await fetchAuthorEmojiInfos(event.pubkey);
  return mergeEmojiInfos(fromAuthor, fromEvent);
}

/**
 * Prepare note/comment content for markup: Unicode for standard shortcodes,
 * placeholders for custom NIP-30 images (expand after sanitize).
 */
export async function prepareContentWithEmojis(
  content: string,
  event?: Event | null
): Promise<{ text: string; slots: EmojiInfo[] }> {
  const infos = await resolveEmojiInfosForEvent(event ?? null);
  const withUnicode = replaceStandardEmojiShortcodes(
    content,
    infos.map((e) => e.shortcode)
  );
  return protectCustomEmojis(withUnicode, infos);
}
