import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { firstTag, eventAddress } from './nostr/verify';
import { type MuteState, notMuted } from './mute';
import {
  coordinatesOverlap,
  publicationCoordinateLookupKeys,
  splitPublicationCoordinate
} from './publication-coordinate';

/** Spec `m` tag when publishing a kind-30040 publication rating. */
export const PUBLICATION_RATING_MARK = 'book';

/** Accepted `m` values when recognizing publication ratings. */
export const PUBLICATION_RATING_MARKS = new Set([
  'book',
  'books',
  'publication',
  'publications'
]);

export function ratingValue(event: Event): number {
  const raw = firstTag(event, 'rating');
  if (!raw) return 0;
  const n = Number(raw);
  if (Number.isNaN(n) || n <= 0 || n > 1) return 0;
  return n;
}

/** Stars (1–5) from a `rating` tag fraction in (0, 1]. Missing/out-of-range = unscored. */
export function ratingStarsFromEvent(event: Event): number {
  const fraction = ratingValue(event);
  if (fraction <= 0) return 0;
  return Math.round(fraction * 5);
}

export function ratingHasScore(event: Event): boolean {
  return ratingStarsFromEvent(event) > 0;
}

function stripPublicationRatingMarkPrefix(d: string): string {
  const i = d.indexOf(':');
  if (i <= 0) return d;
  const mark = d.slice(0, i).trim().toLowerCase();
  return PUBLICATION_RATING_MARKS.has(mark) ? d.slice(i + 1) : d;
}

function coordinateFromATags(event: Event): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== 'a' && tag[0] !== 'A') continue;
    const coord = tag[1]?.trim();
    if (!coord) continue;
    const parsed = splitPublicationCoordinate(coord);
    if (parsed?.kind === KIND.PUBLICATION) return coord;
  }
  return null;
}

function coordinateFromDValue(d: string): string | null {
  const stripped = stripPublicationRatingMarkPrefix(d);
  const parsed = splitPublicationCoordinate(stripped);
  if (parsed?.kind === KIND.PUBLICATION) return stripped;
  return null;
}

export function publicationCoordinateFromRatingEvent(event: Event): string | null {
  const fromA = coordinateFromATags(event);
  if (fromA) return fromA;
  const d = firstTag(event, 'd')?.trim();
  if (!d) return null;
  return coordinateFromDValue(d);
}

export function ratingAddress(event: Event): string | null {
  return publicationCoordinateFromRatingEvent(event);
}

function publicationMarks(event: Event): string[] {
  return event.tags
    .filter((t) => t[0] === 'm')
    .map((t) => t[1]?.trim().toLowerCase())
    .filter((v): v is string => !!v);
}

function hasPublicationKindTag(event: Event): boolean {
  const expected = String(KIND.PUBLICATION);
  return event.tags.some((t) => (t[0] === 'k' || t[0] === 'K') && t[1]?.trim() === expected);
}

/**
 * Kind 34259 aimed at a publication: `m` is book/books/publication/publications,
 * `k`/`K` is 30040, or an `a`/`A` 30040 coordinate.
 */
export function isPublicationRatingEvent(event: Event): boolean {
  if (event.kind !== KIND.RATING) return false;
  const marks = publicationMarks(event);
  if (marks.some((mark) => PUBLICATION_RATING_MARKS.has(mark))) return true;
  if (marks.length > 0) return false;
  if (coordinateFromATags(event)) return true;
  if (hasPublicationKindTag(event)) return true;
  const d = firstTag(event, 'd')?.trim();
  if (!d) return false;
  return stripPublicationRatingMarkPrefix(d) !== d;
}

export function ratingEventTargetsPublication(event: Event, publication: Event): boolean {
  if (!isPublicationRatingEvent(event)) return false;
  const address = eventAddress(publication);
  if (!address) return false;
  if (
    event.tags.some(
      (t) =>
        (t[0] === 'a' || t[0] === 'A') &&
        !!t[1]?.trim() &&
        coordinatesOverlap(t[1].trim(), address)
    )
  ) {
    return true;
  }
  const d = firstTag(event, 'd')?.trim();
  if (!d) return false;
  return coordinatesOverlap(stripPublicationRatingMarkPrefix(d), address);
}

/** REQ `#a` / `#A` values (NFC/NFD variants of the publication coordinate). */
export function publicationRatingATagsForQuery(publication: Event): string[] {
  return publicationCoordinateLookupKeys(eventAddress(publication));
}

export function newestRatingPerAuthor(
  events: Event[],
  address: string,
  mute?: MuteState
): Event[] {
  const byAuthor = new Map<string, Event>();
  for (const event of events) {
    if (!isPublicationRatingEvent(event)) continue;
    const coord = publicationCoordinateFromRatingEvent(event);
    if (!coord || !coordinatesOverlap(coord, address)) continue;
    if (mute && !notMuted(event, mute)) continue;
    const prev = byAuthor.get(event.pubkey);
    if (!prev || event.created_at > prev.created_at) byAuthor.set(event.pubkey, event);
  }
  return [...byAuthor.values()].sort((a, b) => b.created_at - a.created_at);
}

/** Average only scored ratings (fraction in (0, 1]); unscored 34259s are excluded. */
export function aggregateRating(ratings: Event[]): { average: number; count: number } {
  const scored = ratings.filter(ratingHasScore);
  if (!scored.length) return { average: 0, count: 0 };
  const sum = scored.reduce((acc, e) => acc + ratingValue(e), 0);
  return { average: sum / scored.length, count: scored.length };
}

/**
 * Pollerama kind-34259 tags. `stars` is 1–5; `rating` is stars/5 in (0, 1].
 * Same pubkey+d replaces the previous rating.
 */
export function ratingTags(
  publication: Event,
  stars: number,
  hasReviewText = false
): string[][] {
  const clamped = Math.min(5, Math.max(1, Math.round(stars)));
  const address = eventAddress(publication);
  const tags: string[][] = [
    ['d', address],
    ['m', PUBLICATION_RATING_MARK],
    ['rating', (clamped / 5).toFixed(3)],
    ['s', String(clamped)],
    ['a', address],
    ['A', address],
    ['e', publication.id.toLowerCase(), '', publication.pubkey.toLowerCase()],
    ['k', String(KIND.PUBLICATION)],
    ['p', publication.pubkey.toLowerCase()]
  ];
  if (hasReviewText) tags.push(['c', 'true']);
  return tags;
}
