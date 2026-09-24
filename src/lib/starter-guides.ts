import type { Event } from 'nostr-tools';
import { GITCITADEL_CURATOR_NPUB, KIND } from './constants';
import { GITCITADEL_CURATOR_HEX } from './hex';
import { directoryChildrenFromEvent, directoryDTag } from './bookshelf';
import { isNewerReplaceable } from './nostr/replaceable';
import { relayPool } from './nostr/pool';
import { documentStack } from './nostr/selector';
import { rememberEvents } from './nostr/event-memory';
/** Root directory d-tag for GitCitadel Publishing starter guides. */
export const GC_STARTER_GUIDES_D_TAG = 'gc-starter-guides';

/** Top-level guide shelves under the root (publications live on these dirs). */
export const GC_STARTER_GENRE_D_TAGS = [
  'ancient-classics',
  'great-books',
  'catholic-classics',
  'classic-novels',
  'black-authors'
] as const;

export type GcStarterGenreDTag = (typeof GC_STARTER_GENRE_D_TAGS)[number];

export const GC_STARTER_GUIDE_TITLES: Record<string, string> = {
  [GC_STARTER_GUIDES_D_TAG]: 'Starter guides',
  'ancient-classics': 'Ancient classics',
  'great-books': 'Great books',
  'catholic-classics': 'Catholic classics',
  'classic-novels': 'Classic novels',
  'black-authors': 'Black authors'
};

/** All d-tags the landing Guides fetch cares about. */
export function allStarterGuideDTags(): string[] {
  return [GC_STARTER_GUIDES_D_TAG, ...GC_STARTER_GENRE_D_TAGS];
}

export function isStarterGuideDTag(d: string): boolean {
  return allStarterGuideDTags().includes(d.trim());
}

export function starterGuideTitle(d: string): string {
  const key = d.trim();
  return GC_STARTER_GUIDE_TITLES[key] ?? key;
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

function byDTag(events: Event[]): Map<string, Event> {
  const map = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== KIND.DIRECTORY) continue;
    if (event.pubkey.toLowerCase() !== GITCITADEL_CURATOR_HEX) continue;
    const d = directoryDTag(event);
    if (!d || !isStarterGuideDTag(d)) continue;
    const prev = map.get(d);
    if (!prev || isNewerReplaceable(event, prev)) map.set(d, event);
  }
  return map;
}

/** Nested folder d-tags referenced from a parent directory. */
export function childGuideFolderDTags(dir: Event | undefined): string[] {
  if (!dir) return [];
  const out: string[] = [];
  for (const child of directoryChildrenFromEvent(dir)) {
    if (!child.isFolder || !child.identifier) continue;
    if (isStarterGuideDTag(child.identifier)) out.push(child.identifier);
  }
  return out;
}

/**
 * Ordered Home Guides chips from curator 30045 events.
 * Genre shelves in canonical order. Only includes d-tags with a loaded directory.
 */
export function starterGuideChipsFromDirectories(events: Event[]): StarterGuideChip[] {
  const known = byDTag(events);
  if (!known.size) return [];

  const chips: StarterGuideChip[] = [];
  const seen = new Set<string>();
  const push = (d: string) => {
    if (seen.has(d) || !known.has(d)) return;
    seen.add(d);
    chips.push({ d, title: starterGuideTitle(d), href: guideSearchHref(d) });
  };

  const root = known.get(GC_STARTER_GUIDES_D_TAG);
  const rootChildren = new Set(childGuideFolderDTags(root));
  const genres =
    rootChildren.size > 0
      ? GC_STARTER_GENRE_D_TAGS.filter((d) => rootChildren.has(d) || known.has(d))
      : [...GC_STARTER_GENRE_D_TAGS];

  for (const d of genres) push(d);

  // Partial fetch: still surface any remaining known guides in canonical order.
  for (const d of GC_STARTER_GENRE_D_TAGS) push(d);

  return chips;
}

/** Coordinate for a starter-guide directory authored by the curator. */
export function starterGuideCoordinate(d: string): string {
  return `${KIND.DIRECTORY}:${GITCITADEL_CURATOR_HEX}:${d.trim()}`;
}

/**
 * Load curator starter-guide directories from the document stack.
 * Returns chips for Home; empty when the tree is not published yet.
 */
export async function loadStarterGuideChips(): Promise<StarterGuideChip[]> {
  const dTags = allStarterGuideDTags();
  try {
    const events = await relayPool.query(
      documentStack(),
      [
        {
          kinds: [KIND.DIRECTORY],
          authors: [GITCITADEL_CURATOR_HEX],
          '#d': dTags,
          limit: Math.min(40, dTags.length + 5)
        }
      ],
      4_000,
      4
    );
    if (events.length) rememberEvents(events);
    return starterGuideChipsFromDirectories(events);
  } catch {
    return [];
  }
}
