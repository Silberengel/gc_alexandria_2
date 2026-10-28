import type { Event, Filter } from 'nostr-tools';
import {
  parseWikiRedirect as catalogParseWikiRedirect,
  type WikiRedirect
} from '@silberengel/kind-compose-catalog';
import { KIND } from './constants';
import { dTagVariants, normalizeDTag } from './dtag';
import { fetchByAddresses } from './nostr/fetch';
import { mercuryFilter } from './nostr/mercury';
import { rememberEvents } from './nostr/event-memory';
import { relayPool } from './nostr/pool';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { wikiStack } from './nostr/selector';
import { eventAddress, firstTag } from './nostr/verify';
import { publicationCoordinateLookupKeys } from './publication-coordinate';
import { SessionTtlCache } from './session-ttl-cache';
import { wikiPathFromCoordinate } from './wiki-defer';

export type { WikiRedirect };

export type WikiAliasLink = {
  /** Redirect d-tag (alias slug). */
  alias: string;
  /** Version-list path for that alias (`/wiki/d/…` or `/spec/d/…`). */
  href: string;
  /** Author of the redirect (for avatar next to the alias). */
  pubkey: string;
};

/** Parse a kind-30819 wiki redirect. */
export function parseWikiRedirect(event: Event): WikiRedirect | null {
  return catalogParseWikiRedirect(event);
}

export function wikiRedirectTargetHref(event: Event): string | null {
  const parsed = parseWikiRedirect(event);
  return wikiPathFromCoordinate(parsed?.targetCoordinate);
}

/** Unique target coordinates from a set of redirect events (normalized). */
export function uniqueRedirectTargets(redirects: readonly Event[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const event of redirects) {
    const coord = parseWikiRedirect(event)?.targetCoordinate?.trim();
    if (!coord) continue;
    const key = coord.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(coord);
  }
  return out;
}

/**
 * Alias redirects (kind 30819) whose `a` points at `target`.
 * The redirect's `d` is the alternate slug (Also see /wiki/d/{alias}).
 */
export function wikiAliasesFromRedirects(
  redirects: readonly Event[],
  target: Event
): WikiAliasLink[] {
  const articleD = firstTag(target, 'd') ?? '';
  const articleDNorm = normalizeDTag(articleD);
  const targetKeys = new Set(publicationCoordinateLookupKeys(eventAddress(target)));
  const prefix = target.kind === KIND.SPEC ? 'spec' : 'wiki';
  const best = new Map<string, { link: WikiAliasLink; created_at: number }>();

  for (const event of redirects) {
    const parsed = parseWikiRedirect(event);
    if (!parsed?.alias?.trim() || !parsed.targetCoordinate) continue;
    const aliasNorm = normalizeDTag(parsed.alias);
    if (!aliasNorm || (articleDNorm && aliasNorm === articleDNorm)) continue;
    const hitsTarget = publicationCoordinateLookupKeys(parsed.targetCoordinate).some((k) =>
      targetKeys.has(k)
    );
    if (!hitsTarget) continue;
    const link: WikiAliasLink = {
      alias: parsed.alias.trim(),
      href: `/${prefix}/d/${encodeURIComponent(parsed.alias.trim())}`,
      pubkey: event.pubkey.toLowerCase()
    };
    const prev = best.get(aliasNorm);
    if (!prev || event.created_at >= prev.created_at) {
      best.set(aliasNorm, { link, created_at: event.created_at });
    }
  }

  return [...best.values()]
    .map((row) => row.link)
    .sort((a, b) => a.alias.localeCompare(b.alias, undefined, { sensitivity: 'base' }));
}

/** Prefill compose values for a redirect pointing at `target` article. */
export function wikiRedirectComposeValues(
  alias: string,
  target: Event
): Record<string, string> {
  const d =
    alias.trim() ||
    target.tags.find((t) => t[0] === 'd')?.[1]?.trim() ||
    '';
  return {
    d,
    redirect_a: `${target.kind}:${target.pubkey.toLowerCase()}:${
      target.tags.find((t) => t[0] === 'd')?.[1]?.trim() ?? ''
    }`
  };
}

/** True when a redirect's alias d-tag matches the query (exact / prefix / contains). */
export function wikiAliasMatchesQuery(alias: string, query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  const needle = normalizeDTag(q) || q.toLowerCase();
  if (!needle) return false;
  const d = normalizeDTag(alias);
  if (!d) return false;
  return d === needle || d.startsWith(needle) || d.includes(needle);
}

export type WikiAliasResolveResult = {
  /** Wiki/spec articles pointed at by matching redirects. */
  targets: Event[];
  /** Every resolved target id (any alias match strength). */
  aliasMatchedIds: Set<string>;
  /** Targets whose redirect d-tag equals the query exactly. */
  exactAliasIds: Set<string>;
};

const wikiAliasCache = new SessionTtlCache<WikiAliasResolveResult>(5 * 60 * 1000, 40);

function isWikiish(event: Event): boolean {
  return event.kind === KIND.WIKI || event.kind === KIND.SPEC;
}

/**
 * Find kind-30819 aliases whose d matches `query`, resolve their `a` targets,
 * and return the live wiki/spec articles (for hub + catalog search).
 */
export async function resolveWikiAliasArticles(
  query: string,
  limit = 60
): Promise<WikiAliasResolveResult> {
  const empty: WikiAliasResolveResult = {
    targets: [],
    aliasMatchedIds: new Set(),
    exactAliasIds: new Set()
  };
  const q = query.trim();
  if (!q) return empty;
  const cacheKey = `wiki-alias:${q.toLowerCase()}:${limit}`;
  return wikiAliasCache.getOrLoad(cacheKey, () => resolveWikiAliasArticlesUncached(q, limit));
}

async function resolveWikiAliasArticlesUncached(
  q: string,
  limit: number
): Promise<WikiAliasResolveResult> {
  const variants = dTagVariants(q);
  const dValues = variants.length ? variants.slice(0, 12) : [q];
  const aliasFilter: Filter = {
    kinds: [KIND.WIKI_REDIRECT],
    '#d': dValues,
    limit
  };

  const redirectHits = (
    await Promise.all([
      mercuryFilter(aliasFilter).catch(() => [] as Event[]),
      relayPool.query(wikiStack(), [aliasFilter], 4000).catch(() => [] as Event[])
    ])
  ).flat();

  const needle = normalizeDTag(q) || q.toLowerCase();
  const matchingRedirects = pruneToLatestReplaceables(redirectHits).filter((event) => {
    const alias = parseWikiRedirect(event)?.alias;
    return !!alias && wikiAliasMatchesQuery(alias, q);
  });
  rememberEvents(matchingRedirects);

  const exactAliasCoordKeys = new Set<string>();
  for (const redirect of matchingRedirects) {
    const parsed = parseWikiRedirect(redirect);
    if (!parsed?.alias || !parsed.targetCoordinate) continue;
    if (normalizeDTag(parsed.alias) !== needle) continue;
    for (const key of publicationCoordinateLookupKeys(parsed.targetCoordinate)) {
      exactAliasCoordKeys.add(key);
    }
  }

  const targets = (
    await fetchByAddresses(uniqueRedirectTargets(matchingRedirects)).catch(() => [] as Event[])
  ).filter(isWikiish);
  rememberEvents(targets);

  const exactAliasIds = new Set<string>();
  const aliasMatchedIds = new Set<string>();
  for (const event of targets) {
    aliasMatchedIds.add(event.id);
    const keys = new Set(publicationCoordinateLookupKeys(eventAddress(event)));
    for (const key of keys) {
      if (exactAliasCoordKeys.has(key)) {
        exactAliasIds.add(event.id);
        break;
      }
    }
  }

  return { targets, aliasMatchedIds, exactAliasIds };
}
