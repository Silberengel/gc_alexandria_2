import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { firstTag } from './nostr/verify';
import { type MuteState, notMuted } from './mute';

export function ratingValue(event: Event): number {
  const raw = firstTag(event, 'rating');
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function ratingAddress(event: Event): string | null {
  return firstTag(event, 'a') ?? firstTag(event, 'd') ?? null;
}

export function newestRatingPerAuthor(events: Event[], address: string, mute?: MuteState): Event[] {
  const byAuthor = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== KIND.RATING) continue;
    if (ratingAddress(event) !== address) continue;
    if (mute && !notMuted(event, mute)) continue;
    const prev = byAuthor.get(event.pubkey);
    if (!prev || event.created_at > prev.created_at) byAuthor.set(event.pubkey, event);
  }
  return [...byAuthor.values()].sort((a, b) => b.created_at - a.created_at);
}

export function aggregateRating(ratings: Event[]): { average: number; count: number } {
  if (!ratings.length) return { average: 0, count: 0 };
  const sum = ratings.reduce((acc, e) => acc + ratingValue(e), 0);
  return { average: sum / ratings.length, count: ratings.length };
}

export function ratingTags(address: string, value: number): string[][] {
  const clamped = Math.min(1, Math.max(0, value));
  return [
    ['d', address],
    ['a', address],
    ['k', String(KIND.PUBLICATION)],
    ['rating', String(clamped)]
  ];
}
