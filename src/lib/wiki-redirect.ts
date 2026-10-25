import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { wikiPathFromCoordinate } from './wiki-defer';

export type WikiRedirect = {
  alias: string;
  targetCoordinate?: string;
  relayHint?: string;
};

/** Parse a kind-30819 wiki redirect. */
export function parseWikiRedirect(event: Event): WikiRedirect | null {
  if (event.kind !== KIND.WIKI_REDIRECT) return null;
  const d = event.tags.find((t) => t[0] === 'd' && t[1])?.[1]?.trim() ?? '';
  const aTag = event.tags.find((t) => t[0] === 'a' && t[1]);
  return {
    alias: d,
    targetCoordinate: aTag?.[1],
    relayHint: aTag?.[2] || undefined
  };
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
