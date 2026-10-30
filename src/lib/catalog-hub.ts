import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { displayTitle, hasPublicationSection, libraryDocumentPath } from './metadata';
import { mercuryPublicationSearch } from './nostr/mercury';
import { cachedEventsByKind } from './nostr/cache';
import { memoryEventsByKind, rememberEvents } from './nostr/event-memory';
import { relayPool } from './nostr/pool';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { documentStack } from './nostr/selector';
import { firstTag, isTopLevel30040 } from './nostr/verify';
import { dTagVariants, normalizeDTag } from './dtag';

export type CatalogHubKind = typeof KIND.PUBLICATION | typeof KIND.LONG_FORM;

const CATALOG_RECENT_TTL_MS = 5 * 60 * 1000;

type CatalogRecentSnap = { at: number; fetchLimit: number; events: Event[] };

const recentByKind = new Map<number, CatalogRecentSnap>();
const inflightByKind = new Map<number, Promise<Event[]>>();

function isCatalogKind(kind: number): kind is CatalogHubKind {
  return kind === KIND.PUBLICATION || kind === KIND.LONG_FORM;
}

function isListingPage(event: Event): boolean {
  if (!isCatalogKind(event.kind)) return false;
  if (!event.content?.trim() && event.kind === KIND.LONG_FORM) return false;
  if (event.kind === KIND.PUBLICATION) {
    // Prefer real editions — nested indexes still appear when they are the only hit.
    return true;
  }
  return !!event.content?.trim() || !!firstTag(event, 'title')?.trim();
}

function mergeCatalog(batches: Event[][], kind: CatalogHubKind): Event[] {
  const merged = pruneToLatestReplaceables(batches.flat().filter((e) => e.kind === kind));
  rememberEvents(merged);
  if (kind === KIND.PUBLICATION) {
    const tops = merged.filter((e) => isTopLevel30040(e, merged));
    return tops.length ? tops : merged;
  }
  return merged;
}

function rankRecent(batches: Event[][], kind: CatalogHubKind, limit: number): Event[] {
  return mergeCatalog(batches, kind)
    .filter(isListingPage)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

function withMemory(events: Event[], kind: CatalogHubKind, limit: number): Event[] {
  return rankRecent([events, memoryEventsByKind(kind)], kind, limit);
}

/** Test helper — drop in-memory recent TTL caches. */
export function resetCatalogRecentCacheForTests(): void {
  recentByKind.clear();
  inflightByKind.clear();
}

/**
 * Newest publications (30040) or long-form articles (30023) from cache + document relays.
 */
export async function loadCatalogRecent(kind: CatalogHubKind, limit = 50): Promise<Event[]> {
  if (!isCatalogKind(kind)) return [];
  const fetchLimit = Math.max(50, Math.ceil(limit * 1.5));
  const snap = recentByKind.get(kind);
  if (snap && Date.now() - snap.at < CATALOG_RECENT_TTL_MS && snap.fetchLimit >= fetchLimit) {
    return withMemory(snap.events, kind, limit);
  }

  const existing = inflightByKind.get(kind);
  if (existing) {
    const events = await existing;
    return withMemory(events, kind, limit);
  }

  const inflight = (async () => {
    const filter = { kinds: [kind], limit: fetchLimit };
    const [cached, relayHits] = await Promise.all([
      cachedEventsByKind(kind).catch(() => [] as Event[]),
      relayPool
        .query(documentStack(), [filter], 4000, 4, undefined, {
          priority: true,
          includeCooling: true
        })
        .catch(() => [] as Event[])
    ]);
    const events = rankRecent([cached, relayHits], kind, fetchLimit);
    recentByKind.set(kind, { at: Date.now(), fetchLimit, events });
    return events;
  })();
  inflightByKind.set(kind, inflight);

  try {
    const events = await inflight;
    return withMemory(events, kind, limit);
  } finally {
    inflightByKind.delete(kind);
  }
}

function randomPool(events: Event[], kind: CatalogHubKind): Event[] {
  // Catalog stubs (title/d only, no section a/e tags) are library cards — skip for Random.
  if (kind === KIND.PUBLICATION) return events.filter(hasPublicationSection);
  return events;
}

export async function pickRandomCatalogPage(kind: CatalogHubKind): Promise<Event | null> {
  const snap = recentByKind.get(kind);
  const fromRecent = randomPool(
    snap ? withMemory(snap.events, kind, snap.events.length) : [],
    kind
  );
  if (fromRecent.length) {
    return fromRecent[Math.floor(Math.random() * fromRecent.length)] ?? null;
  }
  // Pull a wider recent set so stubs do not empty the random pool.
  const list = randomPool(await loadCatalogRecent(kind, 120), kind);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)] ?? null;
}

function catalogMatchesQuery(event: Event, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const title = displayTitle(event).toLowerCase();
  if (title.includes(q)) return true;
  const d = (firstTag(event, 'd') ?? '').toLowerCase();
  if (d.includes(q) || normalizeDTag(q) === d) return true;
  const body = (event.content ?? '').toLowerCase();
  return body.includes(q);
}

/** Title / d-tag / body search for a single catalog kind. */
export async function searchCatalogHub(
  kind: CatalogHubKind,
  query: string,
  limit = 40
): Promise<Event[]> {
  const q = query.trim();
  if (!q || !isCatalogKind(kind)) return [];
  const slug = normalizeDTag(q);
  const variants = dTagVariants(slug || q);
  const dFilter = { kinds: [kind], '#d': variants.length ? variants : [slug || q], limit };
  const titleFilter = { kinds: [kind], '#title': [q], limit };
  const searchFilter = { kinds: [kind], search: q, limit };

  const batches: Promise<Event[]>[] = [
    cachedEventsByKind(kind).catch(() => [] as Event[]),
    relayPool
      .query(documentStack(), [dFilter], 4000, 4, undefined, {
        priority: true,
        includeCooling: true
      })
      .catch(() => [] as Event[]),
    relayPool
      .query(documentStack(), [titleFilter], 4000, 4, undefined, {
        priority: true,
        includeCooling: true
      })
      .catch(() => [] as Event[]),
    relayPool
      .query(documentStack(), [searchFilter], 4000, 4, undefined, {
        priority: true,
        includeCooling: true
      })
      .catch(() => [] as Event[])
  ];
  if (kind === KIND.PUBLICATION && q.length >= 2) {
    batches.push(
      mercuryPublicationSearch({ q, title: q, limit }).catch(() => [] as Event[]),
      mercuryPublicationSearch({ q, d: slug || q, limit }).catch(() => [] as Event[])
    );
  }

  const settled = await Promise.all(batches);
  return mergeCatalog(settled, kind)
    .filter((e) => catalogMatchesQuery(e, q))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

export function catalogHubResultHref(event: Event): string {
  return `#${libraryDocumentPath(event)}`;
}

export function catalogHubResultLabel(event: Event): string {
  return displayTitle(event);
}

export function catalogHubKindLabel(event: Event): string {
  if (event.kind === KIND.LONG_FORM) return 'Article';
  return 'Publication';
}

export function catalogHubDTag(event: Event): string {
  return firstTag(event, 'd')?.trim() || '';
}

export function catalogHubSearchPath(kind: CatalogHubKind): string {
  return kind === KIND.LONG_FORM ? '/articles/search' : '/publications/search';
}

export function catalogHubHomePath(kind: CatalogHubKind): string {
  return kind === KIND.LONG_FORM ? '/articles' : '/publications';
}

/** Hub listing URL with optional `from=` audience (default trusted is omitted). */
export function catalogHubListingHref(
  kind: CatalogHubKind,
  opts: { from?: string | null } = {}
): string {
  const base = catalogHubHomePath(kind);
  const q = new URLSearchParams();
  const from = (opts.from ?? '').trim().toLowerCase();
  if (from === 'all' || from === 'mine' || from === 'follows') q.set('from', from);
  else if (from && from !== 'trusted') q.set('from', from);
  const qs = q.toString();
  return qs ? `#${base}?${qs}` : `#${base}`;
}

export function catalogHubTitle(kind: CatalogHubKind): string {
  return kind === KIND.LONG_FORM ? 'Articles' : 'Publications';
}

export function catalogHubTagline(kind: CatalogHubKind): string {
  return kind === KIND.LONG_FORM
    ? 'Read long-form notes (kind 30023) — search a topic, browse recent posts, or open a random article.'
    : 'Read publication indexes (kind 30040) — search a title, browse recent editions, or open a random work.';
}

export function catalogHubSearchPlaceholder(kind: CatalogHubKind): string {
  return kind === KIND.LONG_FORM ? 'Search articles…' : 'Search publications…';
}

export function catalogHubSingular(kind: CatalogHubKind): string {
  return kind === KIND.LONG_FORM ? 'article' : 'publication';
}

/** Compose deep-link for a new document of this hub kind. */
export function catalogHubComposeHref(kind: CatalogHubKind): string {
  return `#/compose?kind=${kind}`;
}

/** Button label: Create New Publication / Create New Article. */
export function catalogHubCreateLabel(kind: CatalogHubKind): string {
  return kind === KIND.LONG_FORM ? 'Create New Article' : 'Create New Publication';
}
