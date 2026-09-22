import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { eventAddress } from './nostr/verify';
import { relayPool } from './nostr/pool';
import { socialStack } from './nostr/selector';

/** NIP-25 default positive reaction content (not a Unicode heart). */
export const DEFAULT_LIKE_REACTION_CONTENT = '+' as const;

/**
 * Visual glyph for {@link DEFAULT_LIKE_REACTION_CONTENT} (heart suit, emoji presentation).
 * Same as jumble `DEFAULT_LIKE_REACTION_DISPLAY_EMOJI`.
 */
export const DEFAULT_LIKE_REACTION_DISPLAY_EMOJI = '\u2665\uFE0F';

const COMMON_HEART_LIKE_GLYPHS = new Set([
  '❤',
  '❤️',
  '♥',
  '♥️',
  '🩷',
  '🧡',
  '💛',
  '💚',
  '💙',
  '🩵',
  '💜',
  '🤎',
  '🖤',
  '🩶',
  '🤍'
]);

/** True when kind-7 content counts as a positive like/heart. */
export function isPositiveLikeContent(content: string): boolean {
  const c = content.trim();
  return c === '' || c === DEFAULT_LIKE_REACTION_CONTENT || COMMON_HEART_LIKE_GLYPHS.has(c);
}

export function isLikeReaction(event: Event): boolean {
  return event.kind === KIND.REACTION && isPositiveLikeContent(event.content);
}

export function reactionTargetsId(event: Event, targetId: string): boolean {
  const id = targetId.toLowerCase();
  return event.tags.some((t) => t[0] === 'e' && t[1]?.toLowerCase() === id);
}

/** Newest like per pubkey (duplicates collapse). */
export function likesByPubkey(reactions: Event[]): Map<string, Event> {
  const byPk = new Map<string, Event>();
  for (const event of reactions) {
    if (!isLikeReaction(event)) continue;
    const prev = byPk.get(event.pubkey);
    if (!prev || event.created_at > prev.created_at) byPk.set(event.pubkey, event);
  }
  return byPk;
}

export function likeCount(reactions: Event[]): number {
  return likesByPubkey(reactions).size;
}

export function myLikeReaction(reactions: Event[], pubkey: string | null | undefined): Event | null {
  if (!pubkey) return null;
  return likesByPubkey(reactions).get(pubkey) ?? null;
}

/** NIP-25 kind 7 reaction draft. Content defaults to `+` (shown as a heart in UI). */
export function reactionDraft(
  target: Event,
  content: string = DEFAULT_LIKE_REACTION_CONTENT
): { kind: number; content: string; tags: string[][] } {
  const tags: string[][] = [
    ['e', target.id.toLowerCase()],
    ['p', target.pubkey.toLowerCase()]
  ];
  if (target.kind !== KIND.TEXT_NOTE) {
    tags.push(['k', String(target.kind)]);
  }
  if (target.kind >= 10000) {
    tags.push(['a', eventAddress(target)]);
  }
  return {
    kind: KIND.REACTION,
    content,
    tags
  };
}

export async function fetchReactionsForIds(ids: string[], limit = 100): Promise<Event[]> {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()).filter((id) => /^[0-9a-f]{64}$/.test(id)))];
  if (!unique.length) return [];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += 20) batches.push(unique.slice(i, i + 20));
  const hits = await Promise.all(
    batches.map((batch) =>
      relayPool.query(socialStack(), [{ kinds: [KIND.REACTION], '#e': batch, limit }], 4000, 2)
    )
  );
  const byId = new Map<string, Event>();
  for (const list of hits) {
    for (const event of list) {
      if (event.kind === KIND.REACTION) byId.set(event.id.toLowerCase(), event);
    }
  }
  return [...byId.values()];
}
