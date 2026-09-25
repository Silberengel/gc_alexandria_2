import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { cardMeta, displayTitle, publicationPath, wikiPath } from './metadata';
import type { ListingDensity } from './stores/listing-density';

/** Full detailed cards (multiple of 3 columns). */
export const LISTING_PAGE_SIZE_FULL = 48;
/** Compact mini-card grids (multiple of 3 columns). */
export const LISTING_PAGE_SIZE_COMPACT = 96;
/** Table rows (multiple of 3 for layout parity with card grids). */
export const LISTING_PAGE_SIZE_TABLE = 240;
export const LISTING_PAGE_SIZE_DEFAULT = LISTING_PAGE_SIZE_FULL;
export const LISTING_TABLE_CELL_MAX = 100;

export function listingPageSize(density: ListingDensity): number {
  if (density === 'table') return LISTING_PAGE_SIZE_TABLE;
  if (density === 'list') return LISTING_PAGE_SIZE_COMPACT;
  return LISTING_PAGE_SIZE_FULL;
}

/** Truncate display text; append … when the source was longer. Collapses whitespace. */
export function cropText(value: string, max: number): string {
  const s = value.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** Truncate table cells for Title/Author columns. */
export function cropListingCell(value: string, max = LISTING_TABLE_CELL_MAX): string {
  const s = value.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export type ListingTableColumn = 'title' | 'author';

export type ListingTableRow = {
  id: string;
  title: string;
  author: string;
  titleFull: string;
  authorFull: string;
  href: string;
};

export function eventHref(event: Event): string | null {
  if (event.kind === KIND.WIKI || event.kind === KIND.SPEC) return `#${wikiPath(event)}`;
  if (event.kind === KIND.PUBLICATION || event.kind === KIND.SECTION) {
    return `#${publicationPath(event)}`;
  }
  return null;
}

export function listingTableRow(event: Event): ListingTableRow {
  const meta = cardMeta(event);
  const titleFull = displayTitle(event);
  const authorFull = meta.authors.join(', ');
  return {
    id: event.id,
    title: cropListingCell(titleFull),
    author: cropListingCell(authorFull),
    titleFull,
    authorFull,
    href: eventHref(event) ?? ''
  };
}

export function compareListingRows(
  a: ListingTableRow,
  b: ListingTableRow,
  column: ListingTableColumn,
  dir: 'asc' | 'desc'
): number {
  const mul = dir === 'asc' ? 1 : -1;
  const av = (a[column] ?? '').toLocaleLowerCase();
  const bv = (b[column] ?? '').toLocaleLowerCase();
  return av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true }) * mul;
}

export function sortListingRows(
  rows: ListingTableRow[],
  column: ListingTableColumn,
  dir: 'asc' | 'desc'
): ListingTableRow[] {
  return [...rows].sort((a, b) => compareListingRows(a, b, column, dir));
}
