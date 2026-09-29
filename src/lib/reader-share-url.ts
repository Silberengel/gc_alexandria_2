/**
 * Absolute share URLs for reader panes (Douay Biblestr paths when possible).
 */
import type { Event } from 'nostr-tools';
import { douayBookByCode } from './douay-canon';
import { readableEventAddress } from './library-scope';
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
 * SPA location (path + query) that opens `target` inside `edition`'s reader.
 * Douay verses/chapters → `/luke/9?verse=…`; else `/publication/…?read=1&section=…`.
 * Section coords use `kind:npub:d` for readable share URLs.
 */
export function readerShareLocation(edition: Event, target: Event): string {
  const c = (firstTag(target, 'c') ?? '').trim();
  const s = (firstTag(target, 's') ?? '').trim();
  const book = douayBookFromTags(target);

  if (book && c && /^\d+$/.test(c)) {
    if (/^\d+$/.test(s)) {
      return `/${book.slug}/${c}?verse=${s}`;
    }
    if (target.kind === 30040 && !s) {
      return `/${book.slug}/${c}`;
    }
  }

  const path = publicationPath(edition);
  const addr = readableEventAddress(target) || eventAddress(target);
  const q = new URLSearchParams();
  q.set('read', '1');
  q.set('section', addr || target.id);
  if (book && c && /^\d+$/.test(c)) {
    q.set('book', book.slug);
    q.set('chapter', c);
  }
  return `${path}?${q}`;
}

/**
 * Link that reopens the edition on this index/section/verse.
 * Douay chapters/verses use `/luke/9` / `/luke/9?verse=46`; everything else uses
 * `#/publication/...?read=1&section=…`.
 */
export function readerShareUrl(edition: Event, target: Event): string {
  const origin = originBase();
  const loc = readerShareLocation(edition, target);
  if (loc.startsWith('/publication/') || loc.startsWith('/wiki/') || loc.startsWith('/spec/')) {
    return `${origin}/#${loc}`;
  }
  return `${origin}${loc}`;
}
