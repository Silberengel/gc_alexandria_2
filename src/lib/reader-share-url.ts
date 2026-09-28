/**
 * Absolute share URLs for reader panes (Douay Biblestr paths when possible).
 */
import type { Event } from 'nostr-tools';
import { douayBookByCode } from './douay-canon';
import { publicationPath } from './metadata';
import { eventAddress, firstTag } from './nostr/verify';

function originBase(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function douayBookFromTags(event: Event) {
  for (const tag of event.tags) {
    if (tag[0] !== 'T' || !tag[1]) continue;
    const book = douayBookByCode(tag[1]);
    if (book) return book;
  }
  return null;
}

/**
 * Link that reopens the edition on this index/section/verse.
 * Douay chapters/verses use `/luke/9` / `/luke/9?verse=46`; everything else uses
 * `#/publication/...?read=1&section=…`.
 */
export function readerShareUrl(edition: Event, target: Event): string {
  const origin = originBase();
  const c = (firstTag(target, 'c') ?? '').trim();
  const s = (firstTag(target, 's') ?? '').trim();
  const book = douayBookFromTags(target);
  const title = (firstTag(target, 'title') ?? '').trim();

  if (book && c && /^\d+$/.test(c)) {
    // Verse body
    if (/^\d+$/.test(s)) {
      return `${origin}/${book.slug}/${c}?verse=${s}`;
    }
    // Chapter index leaf (not a preface/preamble section)
    if (target.kind === 30040 && !s) {
      return `${origin}/${book.slug}/${c}`;
    }
  }

  // Prefaces, preambles, other sections/indexes — section deep link on the edition.
  const path = publicationPath(edition);
  const addr = eventAddress(target);
  const q = new URLSearchParams();
  q.set('read', '1');
  q.set('section', addr || target.id);
  // Keep Douay book/chapter hints when present (helps resume after seeds load).
  if (book && c && /^\d+$/.test(c)) {
    q.set('book', book.slug);
    q.set('chapter', c);
  }
  void title;
  return `${origin}/#${path}?${q}`;
}
