import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  addressPath,
  isLibraryHighlight,
  isLibraryKind,
  parseAddress,
  referencedLibraryAddress,
  referencedSectionAddress
} from './library-scope';
import { readerFocusQuote } from './reader-share-url';

/**
 * Passage to mark in the reader: NIP-84 `content` (the quote).
 * Surrounding `context` is display-only on the highlight card — not the deep-link quote.
 */
export function highlightFocusQuote(event: Pick<Event, 'content'>): string {
  return readerFocusQuote(event.content);
}

/**
 * Section/chapter to open for a highlight:
 * kind-30041 `a` tags, else a lowercase `a` that differs from root `A`
 * (nested 30040 chapters), else the `e` event id when a library root exists.
 */
export function highlightFocusSectionAddress(event: Event): string | null {
  const classic = referencedSectionAddress(event);
  if (classic) return classic;

  const root = referencedLibraryAddress(event);
  for (const tag of event.tags) {
    if (tag[0] !== 'a' || !tag[1]) continue;
    const parsed = parseAddress(tag[1]);
    if (!parsed || !isLibraryKind(parsed.kind)) continue;
    if (root && tag[1] === root) continue;
    return tag[1];
  }

  if (root) {
    const e = event.tags.find(
      (t) => (t[0] === 'e' || t[0] === 'E') && t[1] && /^[0-9a-f]{64}$/i.test(t[1])
    );
    if (e?.[1]) return e[1].toLowerCase();
  }
  return null;
}

/**
 * SPA location that opens the highlighted passage in the edition reader.
 * Root from `A` / library address; section from nested `a` / 30041 / `e`; quote from content.
 */
export function highlightReaderLocation(event: Event): string | null {
  if (event.kind !== KIND.HIGHLIGHT || !isLibraryHighlight(event)) return null;
  const edition = referencedLibraryAddress(event);
  if (!edition) return null;
  const path = addressPath(edition);
  if (!path) return null;

  const section = highlightFocusSectionAddress(event);
  const quote = highlightFocusQuote(event);
  const params = new URLSearchParams();
  params.set('read', '1');
  if (section) params.set('section', section);
  if (quote) params.set('quote', quote);
  return `${path}?${params}`;
}
