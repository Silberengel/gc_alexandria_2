import type { Event } from 'nostr-tools';
import { DOCUMENT_SEARCH_RELAYS, GITCITADEL_CURATOR_NPUB, KIND, SOCIAL_RELAYS } from './constants';
import { GITCITADEL_CURATOR_HEX } from './hex';
import {
  MY_BOOK_COLLECTION_D_TAG,
  directoryChildrenFromEvent,
  directoryDTag,
  isProtectedDirectoryDTag
} from './bookshelf';
import { isAddressDeleted, isEventDeleted, refreshDeletionsFor } from './deletions';
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

/** Relays that host curator guide directories / memberships. */
export function guideLibraryRelays(): string[] {
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
 * Known folder d-tags under the curator bookshelf — optimistic Home chips so the
 * guide-links row always paints. Live {@link loadStarterGuideChips} replaces this
 * with membership order (and any newly added folders) once relays answer.
 */
export const GC_DEFAULT_GUIDE_CHIP_D_TAGS = [
  'ancient-classics',
  'great-books',
  'catholic-classics',
  'classic-novels',
  'classic-documents',
  'black-authors',
  'protestant-classics',
  'reading-guides'
] as const;

/**
 * Instant Home Guides chips — always available; refined when the curator
 * my-book-collection membership loads.
 */
export function defaultStarterGuideChips(): StarterGuideChip[] {
  return GC_DEFAULT_GUIDE_CHIP_D_TAGS.map((d) => ({
    d,
    title: starterGuideTitle(d),
    href: guideSearchHref(d)
  }));
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
    if (isEventDeleted(event)) continue;
    const d = directoryDTag(event);
    if (!d) continue;
    const prev = byD.get(d);
    if (!prev || isNewerReplaceable(event, prev)) byD.set(d, event);
  }

  const chips: StarterGuideChip[] = [];
  for (const d of childGuideFolderDTags(bookshelf)) {
    const ev = byD.get(d);
    if (ev) {
      if (isEventDeleted(ev)) continue;
    } else if (isAddressDeleted(KIND.DIRECTORY, GITCITADEL_CURATOR_HEX, d)) {
      // Parent still lists the a-tag, but the folder was NIP-09 deleted.
      continue;
    }
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
    if (!bookshelf) return defaultStarterGuideChips();
    rememberEvents([bookshelf]);

    const childDs = childGuideFolderDTags(bookshelf);
    if (!childDs.length) return defaultStarterGuideChips();

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
    try {
      await refreshDeletionsFor([bookshelf, ...childHits]);
    } catch {
      /* deletions optional */
    }
    const live = starterGuideChipsFromBookshelf(bookshelf, childHits);
    return live.length ? live : defaultStarterGuideChips();
  } catch {
    return defaultStarterGuideChips();
  }
}
