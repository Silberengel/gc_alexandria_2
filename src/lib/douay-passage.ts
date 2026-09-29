/**
 * Biblestr-compatible Douay deep links: `/luke/9?verses=46-50`.
 * Opens the canonical Challoner edition and marks the verse span.
 */
import { nip19, type Event } from 'nostr-tools';
import { LIBRARY_GC_PUBLISHING_PUBKEY } from './constants';
import { DOUAY_EDITION_D, douayBookBySlug, isDouayBookSlug, type DouayBook } from './douay-canon';
import { memoryFindBibleChapter } from './nostr/event-memory';
import { firstTag } from './nostr/verify';

export type VerseRange = { start: number; end: number };

export type DouayPassageFocus = {
  book: DouayBook;
  chapter: number;
  verses: VerseRange | null;
};

export const DOUAY_AUTHOR = LIBRARY_GC_PUBLISHING_PUBKEY;
export const DOUAY_NPUB = nip19.npubEncode(DOUAY_AUTHOR);

/** Path `/luke/9` (optional leading slash; ignores query). */
export function parseDouayPath(pathname: string): { book: DouayBook; chapter: number } | null {
  const raw = (pathname.split('?')[0] || '/').trim() || '/';
  const parts = raw.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const book = douayBookBySlug(parts[0] ?? '');
  if (!book) return null;
  const chapter = Number(parts[1]);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) return null;
  return { book, chapter };
}

export function isDouayPassagePath(pathname: string): boolean {
  return parseDouayPath(pathname) != null;
}

/** Parse `?verse=46` or `?verses=46-50` (Biblestr). */
export function parseVerseQuery(search: string | URLSearchParams): VerseRange | null {
  const q =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;
  const single = (q.get('verse') ?? '').trim();
  const span = (q.get('verses') ?? '').trim();
  if (single) {
    const start = Number(single);
    if (Number.isInteger(start) && start > 0) return { start, end: start };
  }
  if (span) {
    const [a, b] = span.split('-').map((p) => Number((p ?? '').trim()));
    if (Number.isInteger(a) && a! > 0) {
      const end = Number.isInteger(b) && b! > 0 ? b! : a!;
      return { start: Math.min(a!, end), end: Math.max(a!, end) };
    }
  }
  return null;
}

export function parseDouayPassage(
  pathname: string,
  search: string | URLSearchParams = ''
): DouayPassageFocus | null {
  const path = parseDouayPath(pathname);
  if (!path) return null;
  return { ...path, verses: parseVerseQuery(search) };
}

/** Hash SPA path for a passage (keeps Biblestr query shape). */
export function douayPassageHashPath(focus: DouayPassageFocus): string {
  const base = `/${focus.book.slug}/${focus.chapter}`;
  if (!focus.verses) return base;
  const { start, end } = focus.verses;
  const qs = start === end ? `verse=${start}` : `verses=${start}-${end}`;
  return `${base}?${qs}`;
}

/** Publication reader URL with book/chapter(/verses) for resolution after seeds load. */
export function douayPassagePublicationPath(focus: DouayPassageFocus): string {
  const q = new URLSearchParams();
  q.set('read', '1');
  q.set('book', focus.book.slug);
  q.set('chapter', String(focus.chapter));
  if (focus.verses) {
    const { start, end } = focus.verses;
    if (start === end) q.set('verse', String(start));
    else q.set('verses', `${start}-${end}`);
  }
  return `/publication/d/${encodeURIComponent(DOUAY_EDITION_D)}/p/${DOUAY_NPUB}?${q}`;
}

/** Douay chapter index from session memory (after seed ingest). */
export function findDouayChapterIndex(bookCode: string, chapter: number): Event | null {
  return memoryFindBibleChapter(DOUAY_AUTHOR, bookCode, chapter);
}

/** True when a bible section's verse number falls in the marked span. */
export function verseInRange(event: Event, range: VerseRange | null | undefined): boolean {
  if (!range || range.start <= 0) return false;
  const s = (firstTag(event, 's') ?? '').trim();
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return n >= range.start && n <= range.end;
}

export { isDouayBookSlug, DOUAY_EDITION_D };
