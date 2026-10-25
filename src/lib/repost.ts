import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { humanReadableText } from './event-preview';
import { memoryGetEvent } from './nostr/event-memory';

const HEX_64 = /^[0-9a-f]{64}$/i;

export function isRepostKind(kind: number): boolean {
  return kind === KIND.REPOST || kind === KIND.GENERIC_REPOST;
}

/** NIP-18 embedded note JSON in kind 6/16 content (legacy; often empty now). */
export function parseEmbeddedRepostEvent(content: string): Event | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<Event>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id !== 'string' || !HEX_64.test(parsed.id)) return null;
    if (typeof parsed.pubkey !== 'string' || !HEX_64.test(parsed.pubkey)) return null;
    if (typeof parsed.kind !== 'number') return null;
    if (typeof parsed.content !== 'string') return null;
    if (!Array.isArray(parsed.tags)) return null;
    return parsed as Event;
  } catch {
    return null;
  }
}

/** First `e` tag id on a kind 6/16 (NIP-18). */
export function repostTargetId(repost: Event): string | null {
  if (!isRepostKind(repost.kind)) return null;
  for (const tag of repost.tags) {
    if (tag[0] !== 'e' && tag[0] !== 'E') continue;
    const id = (tag[1] ?? '').trim().toLowerCase();
    if (HEX_64.test(id)) return id;
  }
  return parseEmbeddedRepostEvent(repost.content)?.id.toLowerCase() ?? null;
}

/** Addressable target coordinate on a kind 16 (`a` tag). */
export function repostTargetAddress(repost: Event): string | null {
  if (repost.kind !== KIND.GENERIC_REPOST) return null;
  for (const tag of repost.tags) {
    if (tag[0] !== 'a' && tag[0] !== 'A') continue;
    const addr = (tag[1] ?? '').trim();
    if (addr) return addr;
  }
  return null;
}

/**
 * Best-effort blurb for a boost row: embedded JSON, then memory for the `e` target.
 * Callers may refresh after {@link fetchById} fills memory.
 */
export function peekRepostExcerpt(repost: Event): string {
  if (!isRepostKind(repost.kind)) return '';
  const embedded = parseEmbeddedRepostEvent(repost.content);
  const fromEmbedded = humanReadableText(embedded?.content ?? '');
  if (fromEmbedded) return fromEmbedded;
  const id = repostTargetId(repost);
  if (id) {
    const target = memoryGetEvent(id);
    const fromTarget = humanReadableText(target?.content ?? '');
    if (fromTarget) return fromTarget;
  }
  return humanReadableText(repost.content);
}
