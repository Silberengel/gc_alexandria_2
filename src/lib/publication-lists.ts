import type { Event } from 'nostr-tools';
import { KIND, NIP32_BOOKLIST_LABEL, NIP32_READ_LABEL } from './constants';
import { normalizeDTag } from './dtag';
import {
  DIRECTORY_HOME_D_TAGS,
  directoryDTag,
  isProtectedDirectoryDTag
} from './bookshelf';
import { extractNip32LabelValues, isReadLabelSlug, publicationTargets } from './nip32';
import { mergeById } from './nostr/fetch';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { relayPool } from './nostr/pool';
import { documentStack, socialStack } from './nostr/selector';
import { meetsMinimumTrustedRank } from './result-scope';
import { SessionTtlCache } from './session-ttl-cache';
import { session } from './stores/session';
import { trustedAssertions } from './trusted-assertions';

/** Home-shelf NIP-32 slugs (jumble / imwald-android CuratedShelfCatalog). */
export const HOME_SHELF_SLUGS = [
  'adventure',
  'romance',
  'mystery-detective',
  'horror-gothic',
  'sci-fi-speculative-fiction',
  'humour-satire',
  'high-seas',
  'poetry'
] as const;

export type HomeShelfSlug = (typeof HOME_SHELF_SLUGS)[number];

export const HOME_SHELF_TITLES: Record<HomeShelfSlug, string> = {
  adventure: 'Adventure',
  romance: 'Romance',
  'mystery-detective': 'Mystery / Detective',
  'horror-gothic': 'Horror / Gothic',
  'sci-fi-speculative-fiction': 'Sci-Fi / Speculative Fiction',
  'humour-satire': 'Humour / Satire',
  'high-seas': 'High Seas',
  poetry: 'Poetry'
};

export function isHomeShelfSlug(value: string): value is HomeShelfSlug {
  return (HOME_SHELF_SLUGS as readonly string[]).includes(value);
}

export function slugifyPublicationLabel(raw: string): string {
  const slug = normalizeDTag(raw.trim());
  return slug || NIP32_BOOKLIST_LABEL;
}

export function displayTitleForPublicationLabel(slug: string): string {
  if (slug === NIP32_BOOKLIST_LABEL) return 'Booklist';
  if (isHomeShelfSlug(slug)) return HOME_SHELF_TITLES[slug];
  return slug;
}

function alphaLabelSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function suggestionSkipSet(exclude: Iterable<string> = []): Set<string> {
  return new Set<string>([
    NIP32_BOOKLIST_LABEL,
    NIP32_READ_LABEL,
    ...(DIRECTORY_HOME_D_TAGS as readonly string[]),
    ...[...exclude].map((s) => s.trim().toLowerCase()).filter(Boolean)
  ]);
}

/**
 * Distinct list slugs the viewer already uses (any publication), alphabetical.
 * Skips booklist / read; includes home-shelf slugs only when the viewer has used them.
 */
export function myPublicationListLabels(events: Event[]): { slug: string; title: string }[] {
  const byKey = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== KIND.LABEL) continue;
    if (!publicationTargets(event).addresses.length) continue;
    for (const label of extractNip32LabelValues(event.tags)) {
      const key = label.trim().toLowerCase();
      if (!key || key === NIP32_BOOKLIST_LABEL || isReadLabelSlug(key)) continue;
      if (!byKey.has(key)) byKey.set(key, label.trim());
    }
  }
  return [...byKey.entries()]
    .sort((a, b) => alphaLabelSort(a[1], b[1]) || alphaLabelSort(a[0], b[0]))
    .map(([slug, raw]) => ({ slug, title: displayTitleForPublicationLabel(raw) }));
}

/** Kind 1985 that labels a kind-30040 publication (via `a` address), not read marks. */
export function isPublication30040ListLabelEvent(event: Event): boolean {
  if (event.kind !== KIND.LABEL) return false;
  const listSlugs = extractNip32LabelValues(event.tags).filter((v) => !isReadLabelSlug(v));
  if (!listSlugs.length) return false;
  return publicationTargets(event).addresses.length > 0;
}

/**
 * Distinct list names from kind-1985 events that label 30040 publications.
 */
export function suggestedPublicationLabels(
  events: Event[],
  exclude: Iterable<string> = []
): string[] {
  const skip = suggestionSkipSet(exclude);
  const byKey = new Map<string, string>();
  for (const event of events) {
    if (!isPublication30040ListLabelEvent(event)) continue;
    for (const label of extractNip32LabelValues(event.tags)) {
      const key = label.trim().toLowerCase();
      if (!key || skip.has(key) || isReadLabelSlug(key)) continue;
      if (!byKey.has(key)) byKey.set(key, displayTitleForPublicationLabel(label.trim()));
    }
  }
  return [...byKey.values()].sort(alphaLabelSort);
}

/**
 * Distinct folder names from other kind-30045 `d` tags (skips root / my-book-collection).
 */
export function suggestedBookshelfFolderNames(
  directories: Event[],
  exclude: Iterable<string> = []
): string[] {
  const skip = suggestionSkipSet(exclude);
  const byKey = new Map<string, string>();
  for (const event of directories) {
    if (event.kind !== KIND.DIRECTORY) continue;
    const d = directoryDTag(event);
    if (!d || isProtectedDirectoryDTag(d)) continue;
    const key = d.trim().toLowerCase();
    if (!key || skip.has(key)) continue;
    if (!byKey.has(key)) byKey.set(key, d.trim());
  }
  return [...byKey.values()].sort(alphaLabelSort);
}

export type TrustedShelfSuggestions = {
  /** From trusted npubs' kind-1985 labels on 30040s. */
  listLabels: string[];
  /** From trusted npubs' kind-30045 folder `d` tags. */
  folderNames: string[];
};

const suggestionCache = new SessionTtlCache<{ labels: Event[]; directories: Event[] }>(
  5 * 60 * 1000,
  4
);

async function loadTrustedShelfSuggestionEvents(): Promise<{
  labels: Event[];
  directories: Event[];
}> {
  const social = socialStack();
  const document = documentStack();
  const settled = await Promise.allSettled([
    relayPool.query(social, [{ kinds: [KIND.LABEL], limit: 200 }], 4000),
    relayPool.query(document, [{ kinds: [KIND.DIRECTORY], limit: 160 }], 4000),
    relayPool.query(social, [{ kinds: [KIND.DIRECTORY], limit: 80 }], 3500, 2)
  ]);
  const labelsRaw: Event[] = [];
  const dirsRaw: Event[] = [];
  for (const [i, result] of settled.entries()) {
    if (result.status !== 'fulfilled') continue;
    if (i === 0) labelsRaw.push(...result.value);
    else dirsRaw.push(...result.value);
  }

  const labels = mergeById(labelsRaw).filter(isPublication30040ListLabelEvent);
  const directories = pruneToLatestReplaceables(mergeById(dirsRaw)).filter(
    (e) => e.kind === KIND.DIRECTORY && !!directoryDTag(e) && !isProtectedDirectoryDTag(directoryDTag(e))
  );

  const authors = [
    ...new Set([...labels, ...directories].map((e) => e.pubkey.toLowerCase()).filter(Boolean))
  ];
  try {
    await trustedAssertions.resolveProvider(session.getPubkey());
    await trustedAssertions.requestScoresAndWait(authors);
  } catch {
    /* scores optional — without them trusted filter yields nothing */
  }

  const viewer = session.getPubkey()?.toLowerCase() ?? '';
  const getScore = (pk: string) => trustedAssertions.getScore(pk);
  const trusted = (e: Event) => {
    const pk = e.pubkey.toLowerCase();
    if (!pk || pk === viewer) return false;
    return meetsMinimumTrustedRank(pk, getScore);
  };

  return {
    labels: labels.filter(trusted),
    directories: directories.filter(trusted)
  };
}

/** Trusted-npub list labels (1985→30040) and folder `d` tags (30045). */
export async function loadTrustedShelfSuggestions(
  exclude: Iterable<string> = []
): Promise<TrustedShelfSuggestions> {
  const viewer = session.getPubkey()?.toLowerCase() ?? '';
  const cacheKey = `shelf-suggest:${viewer || 'anon'}`;
  const raw = await suggestionCache.getOrLoad(cacheKey, loadTrustedShelfSuggestionEvents);
  return {
    listLabels: suggestedPublicationLabels(raw.labels, exclude),
    folderNames: suggestedBookshelfFolderNames(raw.directories, exclude)
  };
}
