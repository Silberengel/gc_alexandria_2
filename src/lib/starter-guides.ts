import type { Event } from 'nostr-tools';
import { DOCUMENT_SEARCH_RELAYS, GITCITADEL_CURATOR_NPUB, KIND, SOCIAL_RELAYS } from './constants';
import { GITCITADEL_CURATOR_HEX } from './hex';
import {
  MY_BOOK_COLLECTION_D_TAG,
  directoryChildrenFromEvent,
  directoryDTag,
  isProtectedDirectoryDTag
} from './bookshelf';
import { isNewerReplaceable, pickLatestAddressable } from './nostr/replaceable';
import { relayPool } from './nostr/pool';
import { documentStack } from './nostr/selector';
import { rememberEvents } from './nostr/event-memory';
import { firstTag } from './nostr/verify';

/**
 * Landing Guides are the kind-30045 folder children of the GitCitadel
 * Publishing curator’s `my-book-collection` bookshelf. Add/remove folders
 * there and the Home chips follow on the next load.
 */
export const GC_STARTER_BOOKSHELF_D_TAG = MY_BOOK_COLLECTION_D_TAG;

/** @deprecated Prefer {@link GC_STARTER_BOOKSHELF_D_TAG}; kept for seed scripts. */
export const GC_STARTER_GUIDES_D_TAG = 'gc-starter-guides';

/** Optional pretty titles for known guide d-tags (fallback is humanized kebab). */
export const GC_STARTER_GUIDE_TITLES: Record<string, string> = {
  [GC_STARTER_GUIDES_D_TAG]: 'Starter guides',
  [MY_BOOK_COLLECTION_D_TAG]: 'My bookshelf',
  'ancient-classics': 'Ancient classics',
  'great-books': 'Great books',
  'catholic-classics': 'Catholic classics',
  'classic-novels': 'Classic novels',
  'classic-documents': 'Classic documents',
  'black-authors': 'Black authors',
  'protestant-classics': 'Protestant classics',
  'reading-guides': 'Reading guides'
};

export function starterGuideTitle(d: string): string {
  const key = d.trim();
  if (GC_STARTER_GUIDE_TITLES[key]) return GC_STARTER_GUIDE_TITLES[key]!;
  const parts = key.split('-').filter(Boolean);
  if (!parts.length) return key;
  return parts
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export type StarterGuideChip = {
  d: string;
  title: string;
  /** `/#/search?bookshelf=…&npub=…` */
  href: string;
};

function guideSearchHref(d: string): string {
  const q = new URLSearchParams({
    bookshelf: d,
    npub: GITCITADEL_CURATOR_NPUB
  });
  return `#/search?${q.toString()}`;
}

function guideLibraryRelays(): string[] {
  // Guides live on theforest / thecitadel — do not rely on documentStack alone
  // (GitCitadel preset off, or a small cap that lands on dead third-party hosts).
  return [
    ...new Set([
      ...SOCIAL_RELAYS.filter((u) => /theforest|thecitadel/i.test(u)),
      ...DOCUMENT_SEARCH_RELAYS.filter((u) => /thecitadel|theforest/i.test(u)),
      ...documentStack()
    ])
  ];
}

/** Nested folder d-tags referenced from a parent directory (bookshelf order). */
export function childGuideFolderDTags(dir: Event | undefined): string[] {
  if (!dir) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const child of directoryChildrenFromEvent(dir)) {
    if (!child.isFolder || !child.identifier) continue;
    const d = child.identifier.trim();
    if (!d || seen.has(d)) continue;
    if (isProtectedDirectoryDTag(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

/**
 * Instant Home Guides chips — empty until relays confirm the curator bookshelf.
 * (Hardcoded genres would drift from folders you add/remove under my-book-collection.)
 */
export function defaultStarterGuideChips(): StarterGuideChip[] {
  return [];
}

/**
 * Ordered Home Guides chips from the curator’s bookshelf membership.
 * Folder `a`-tag order on `bookshelf` wins; optional child events supply titles.
 */
export function starterGuideChipsFromBookshelf(
  bookshelf: Event | null | undefined,
  childEvents: Event[] = []
): StarterGuideChip[] {
  if (!bookshelf || bookshelf.kind !== KIND.DIRECTORY) return [];
  if (bookshelf.pubkey.toLowerCase() !== GITCITADEL_CURATOR_HEX) return [];

  const byD = new Map<string, Event>();
  for (const event of childEvents) {
    if (event.kind !== KIND.DIRECTORY) continue;
    if (event.pubkey.toLowerCase() !== GITCITADEL_CURATOR_HEX) continue;
    const d = directoryDTag(event);
    if (!d) continue;
    const prev = byD.get(d);
    if (!prev || isNewerReplaceable(event, prev)) byD.set(d, event);
  }

  const chips: StarterGuideChip[] = [];
  for (const d of childGuideFolderDTags(bookshelf)) {
    const ev = byD.get(d);
    const titled = ev ? firstTag(ev, 'title')?.trim() : undefined;
    chips.push({
      d,
      title: titled || starterGuideTitle(d),
      href: guideSearchHref(d)
    });
  }
  return chips;
}

/**
 * @deprecated Use {@link starterGuideChipsFromBookshelf}. Kept for callers that
 * still pass a mixed event bag including the bookshelf.
 */
export function starterGuideChipsFromDirectories(events: Event[]): StarterGuideChip[] {
  const bookshelf =
    pickLatestAddressable(events, KIND.DIRECTORY, GITCITADEL_CURATOR_HEX, MY_BOOK_COLLECTION_D_TAG) ??
    pickLatestAddressable(events, KIND.DIRECTORY, GITCITADEL_CURATOR_HEX, GC_STARTER_GUIDES_D_TAG);
  return starterGuideChipsFromBookshelf(bookshelf, events);
}

/** Coordinate for a guide directory authored by the curator. */
export function starterGuideCoordinate(d: string): string {
  return `${KIND.DIRECTORY}:${GITCITADEL_CURATOR_HEX}:${d.trim()}`;
}

/**
 * Load Guides from the curator’s `my-book-collection` folder children.
 */
export async function loadStarterGuideChips(): Promise<StarterGuideChip[]> {
  try {
    const library = guideLibraryRelays();
    const shelfHits = await relayPool.query(
      library,
      [
        {
          kinds: [KIND.DIRECTORY],
          authors: [GITCITADEL_CURATOR_HEX],
          '#d': [MY_BOOK_COLLECTION_D_TAG],
          limit: 5
        }
      ],
      5_000,
      4,
      undefined,
      { bypassConstrain: true, includeCooling: true, priority: true }
    );
    const bookshelf = pickLatestAddressable(
      shelfHits,
      KIND.DIRECTORY,
      GITCITADEL_CURATOR_HEX,
      MY_BOOK_COLLECTION_D_TAG
    );
    if (!bookshelf) return [];
    rememberEvents([bookshelf]);

    const childDs = childGuideFolderDTags(bookshelf);
    if (!childDs.length) return [];

    const childHits = await relayPool.query(
      library,
      [
        {
          kinds: [KIND.DIRECTORY],
          authors: [GITCITADEL_CURATOR_HEX],
          '#d': childDs,
          limit: Math.min(80, childDs.length + 5)
        }
      ],
      5_000,
      4,
      undefined,
      { bypassConstrain: true, includeCooling: true, priority: true }
    );
    if (childHits.length) rememberEvents(childHits);
    return starterGuideChipsFromBookshelf(bookshelf, childHits);
  } catch {
    return [];
  }
}
