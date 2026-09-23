import {
  AGGR_RELAY,
  DOCUMENT_SEARCH_RELAYS,
  MERCURY_HTTP,
  MERCURY_WSS,
  PROFILE_RELAYS,
  SOCIAL_RELAYS,
  THIRD_PARTY_RELAYS,
  WIKI_RELAYS,
  type StackKind
} from '../constants';
import { webSocketRelays, writeWebSocketRelays } from './relay-filters';

export type SelectorContext = {
  signedIn: boolean;
  inbox: string[];
  outbox: string[];
  favorites: string[];
  local: string[];
  blocked: string[];
};

const defaultCtx: SelectorContext = {
  signedIn: false,
  inbox: [],
  outbox: [],
  favorites: [],
  local: [],
  blocked: []
};

let ctx: SelectorContext = { ...defaultCtx };

export function setSelectorContext(partial: Partial<SelectorContext>): void {
  ctx = { ...ctx, ...partial };
}

export function getSelectorContext(): SelectorContext {
  return ctx;
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = u.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

function stackUrls(urls: string[]): string[] {
  return webSocketRelays(dedupe(urls));
}

function withoutBlocked(urls: string[]): string[] {
  const blocked = new Set(ctx.blocked.map((u) => u.replace(/\/+$/, '').toLowerCase()));
  return urls.filter((u) => !blocked.has(u.replace(/\/+$/, '').toLowerCase()));
}

function maybeAggr(urls: string[]): string[] {
  if (!ctx.signedIn) return urls;
  const hasNostrLand = [...ctx.outbox, ...ctx.favorites].some((u) =>
    u.toLowerCase().includes('nostr.land')
  );
  if (hasNostrLand && !urls.some((u) => u.toLowerCase().includes('aggr.nostr.land'))) {
    return [...urls, AGGR_RELAY];
  }
  return urls;
}

/** Document/search WebSocket stack (Mercury read-only WSS + Citadel + third-party). */
export function documentStack(): string[] {
  let relays: string[] = [...DOCUMENT_SEARCH_RELAYS];
  if (ctx.signedIn) {
    relays = [...ctx.inbox, ...ctx.outbox, ...ctx.favorites, ...ctx.local, ...relays];
  }
  return maybeAggr(withoutBlocked(stackUrls(relays)));
}

/**
 * Resolve 30040 covers for shelves: library/index relays first, then the viewer's
 * inbox/outbox (NIP-65) so personal mirrors and a-tag hints still win.
 * Do not put personal write relays alone at the front — a 2–5 relay cap would then
 * never reach thecitadel/Mercury where most editions live.
 */
export function publicationSearchStack(): string[] {
  let relays: string[] = [...DOCUMENT_SEARCH_RELAYS];
  if (ctx.signedIn) {
    relays = [
      ...DOCUMENT_SEARCH_RELAYS,
      ...ctx.outbox,
      ...ctx.inbox,
      ...ctx.favorites,
      ...ctx.local
    ];
  }
  return maybeAggr(withoutBlocked(stackUrls(relays)));
}

/** Viewer's NIP-65 outboxes (+ favorites/local) — for reading one's own replaceables. */
export function viewerOutboxStack(): string[] {
  if (!ctx.signedIn) return socialStack();
  const personal = withoutBlocked(dedupe([...ctx.outbox, ...ctx.favorites, ...ctx.local]));
  // Fall through to social + document defaults so 30045 dirs still hit thecitadel when
  // the personal outbox list is empty or incomplete.
  return maybeAggr(
    withoutBlocked(stackUrls([...personal, ...SOCIAL_RELAYS, ...DOCUMENT_SEARCH_RELAYS]))
  );
}

/** Wiki read stack — wiki hosts first so a 2–3 relay cap still reaches them. */
export function wikiStack(): string[] {
  return withoutBlocked(stackUrls([...WIKI_RELAYS, ...documentStack()]));
}

/** Social/interaction stack */
export function socialStack(): string[] {
  let relays: string[] = [...SOCIAL_RELAYS];
  if (ctx.signedIn) {
    relays = [...ctx.inbox, ...ctx.outbox, ...ctx.favorites, ...ctx.local, ...relays];
  }
  return maybeAggr(withoutBlocked(stackUrls(relays)));
}

/**
 * Kind-0 profile hydration — jumble-style profile mirrors plus the signed-in viewer's own relays.
 * Mercury is document-only and is never included.
 */
export function profileStack(): string[] {
  let relays: string[] = [...PROFILE_RELAYS];
  if (ctx.signedIn) {
    relays = [...ctx.inbox, ...ctx.outbox, ...ctx.favorites, ...ctx.local, ...relays];
  }
  return withoutBlocked(stackUrls(relays));
}

/** Highlight list unions document + social */
export function highlightStack(): string[] {
  return withoutBlocked(stackUrls([...documentStack(), ...socialStack()]));
}

export function writeStack(): string[] {
  if (!ctx.signedIn) return [];
  return writeWebSocketRelays(
    withoutBlocked(dedupe([...ctx.outbox, ...ctx.favorites, ...ctx.local]))
  );
}

export function stackFor(kind: StackKind): string[] {
  switch (kind) {
    case 'document':
      return documentStack();
    case 'wiki':
      return wikiStack();
    case 'social':
      return socialStack();
    case 'highlight':
      return highlightStack();
    case 'profile':
      return profileStack();
  }
}

export function mercuryBase(): string {
  return MERCURY_HTTP;
}

export { THIRD_PARTY_RELAYS, MERCURY_WSS };
