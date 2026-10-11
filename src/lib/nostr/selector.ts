import {
  AGGR_RELAY,
  BRAINSTORM_SEARCH_RELAY_URL,
  DOCUMENT_SEARCH_RELAYS,
  GRAPEVINE_SCORES_RELAY_URL,
  GRAPEVINE_SCORES_STAGING_RELAY_URL,
  MERCURY_HTTP,
  MERCURY_WSS,
  PROFILE_RELAYS,
  SOCIAL_RELAYS,
  SOCIAL_SEARCH_RELAYS,
  THIRD_PARTY_RELAYS,
  WIKI_RELAYS,
  type StackKind
} from '../constants';
import { relayPrefs } from '../stores/relay-prefs';
import { webSocketRelays, writeWebSocketRelays } from './relay-filters';

export type SelectorContext = {
  signedIn: boolean;
  /** Signed-in viewer. Used to reuse their NIP-65 lists without a second lookup. */
  viewerPubkey: string;
  inbox: string[];
  outbox: string[];
  favorites: string[];
  local: string[];
  blocked: string[];
};

const defaultCtx: SelectorContext = {
  signedIn: false,
  viewerPubkey: '',
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

function relayKey(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

/** Relays Alexandria ships with. Not Damus / Primal / other public social hosts. */
const GITCITADEL_RELAYS = [
  ...DOCUMENT_SEARCH_RELAYS,
  ...SOCIAL_RELAYS,
  ...PROFILE_RELAYS,
  ...WIKI_RELAYS,
  AGGR_RELAY,
  BRAINSTORM_SEARCH_RELAY_URL,
  GRAPEVINE_SCORES_RELAY_URL,
  GRAPEVINE_SCORES_STAGING_RELAY_URL
];

function gitcitadelRelayKeys(): Set<string> {
  return new Set(GITCITADEL_RELAYS.map(relayKey));
}

/** Inbox, outbox, favorites, and local relays. Empty when signed out. */
function viewerRelayLists(): string[] {
  if (!ctx.signedIn) return [];
  return [...ctx.inbox, ...ctx.outbox, ...ctx.favorites, ...ctx.local];
}

function viewerListedNostrLand(): boolean {
  return viewerRelayLists().some((u) => {
    const x = u.toLowerCase();
    return x.includes('nostr.land') && !x.includes('aggr.nostr.land');
  });
}

/** Signed out, or signed in with GitCitadel's relays left on. */
export function gitcitadelReadsAllowed(): boolean {
  if (!ctx.signedIn) return true;
  return relayPrefs.get().gitcitadel;
}

/**
 * Other people's relays. Only when signed in and the Outboxes setting is on.
 * Signed-out sessions stay on the hard-coded set.
 */
export function foreignRelaysAllowed(): boolean {
  return ctx.signedIn && relayPrefs.get().outboxes;
}

/**
 * Drop every relay this session is not allowed to dial.
 * Signed out: GitCitadel's hard-coded relays only.
 * Signed in, Outboxes off: the viewer's lists, plus GitCitadel's when that toggle is on.
 * Signed in, Outboxes on: callers may also pass one author's inbox or outbox, or the
 * popular note-search relays. Those URLs are not rewritten here.
 */
export function constrainRelays(urls: string[]): string[] {
  if (foreignRelaysAllowed()) return urls;
  const allow = new Set<string>();
  if (gitcitadelReadsAllowed()) {
    for (const key of gitcitadelRelayKeys()) allow.add(key);
  }
  for (const url of viewerRelayLists()) allow.add(relayKey(url));
  return urls.filter((url) => allow.has(relayKey(url)));
}

/**
 * Hard-coded relays (when signed out, or when the GitCitadel toggle is on) plus the
 * viewer's own lists when signed in. Never another person's relays.
 */
function composeReadStack(hardcoded: readonly string[], personal: string[] = viewerRelayLists()): string[] {
  const shipped = gitcitadelReadsAllowed() ? hardcoded : [];
  return maybeAggr(withoutBlocked(stackUrls([...shipped, ...personal])));
}

function withoutBlocked(urls: string[]): string[] {
  const blocked = new Set(ctx.blocked.map((u) => u.replace(/\/+$/, '').toLowerCase()));
  return urls.filter((u) => !blocked.has(u.replace(/\/+$/, '').toLowerCase()));
}

function maybeAggr(urls: string[]): string[] {
  if (!ctx.signedIn || !gitcitadelReadsAllowed()) return urls;
  const hasNostrLand = viewerListedNostrLand();
  if (!hasNostrLand) return urls;
  if (urls.some((u) => u.toLowerCase().includes('aggr.nostr.land'))) return urls;
  const idx = urls.findIndex((u) => u.toLowerCase().includes('nostr.land'));
  if (idx >= 0) {
    return [...urls.slice(0, idx + 1), AGGR_RELAY, ...urls.slice(idx + 1)];
  }
  return [AGGR_RELAY, ...urls];
}

/**
 * Document/search WebSocket stack (Mercury read-only WSS + Citadel + third-party).
 * Hard-coded relays, plus the viewer's own lists when signed in and never someone else's.
 */
export function documentStack(): string[] {
  return composeReadStack(DOCUMENT_SEARCH_RELAYS);
}

/**
 * Resolve 30040 covers for shelves: library relays first, then the viewer's own lists.
 * Personal write relays stay behind the library hosts so a small relay cap still
 * reaches thecitadel and Mercury.
 */
export function publicationSearchStack(): string[] {
  if (!ctx.signedIn) return composeReadStack(DOCUMENT_SEARCH_RELAYS);
  return composeReadStack(DOCUMENT_SEARCH_RELAYS, [
    ...ctx.outbox,
    ...ctx.inbox,
    ...ctx.favorites,
    ...ctx.local
  ]);
}

/**
 * Viewer's NIP-65 outboxes (+ favorites/local) only — for reading one's own replaceables.
 * Do not append the full social/document defaults here; that re-fans every login REQ onto
 * rate-limited personal relays (e.g. pipe.imwald.eu 12/min).
 */
export function viewerOutboxStack(): string[] {
  if (!ctx.signedIn) return socialStack().slice(0, 3);
  const personal = withoutBlocked(stackUrls([...ctx.outbox, ...ctx.favorites, ...ctx.local]));
  if (personal.length) return personal;
  if (!gitcitadelReadsAllowed()) return [];
  return withoutBlocked(stackUrls([...SOCIAL_RELAYS.slice(0, 2), ...DOCUMENT_SEARCH_RELAYS.slice(0, 2)]));
}

/** Wiki read stack — wiki hosts first so a 2–3 relay cap still reaches them. */
export function wikiStack(): string[] {
  const wiki = gitcitadelReadsAllowed() ? WIKI_RELAYS : [];
  return withoutBlocked(stackUrls([...wiki, ...documentStack()]));
}

/** Social/interaction stack — library hosts plus the viewer's own lists. */
export function socialStack(): string[] {
  return composeReadStack(SOCIAL_RELAYS);
}

/**
 * Damus, Primal, and the other popular relays used only to find a missing note.
 * Empty unless the signed-in viewer has Outboxes on.
 */
export function socialSearchStack(): string[] {
  if (!foreignRelaysAllowed()) return [];
  return withoutBlocked(stackUrls([...SOCIAL_SEARCH_RELAYS]));
}

/**
 * Kind-0 profile hydration — profile mirrors plus the signed-in viewer's own relays.
 * Mercury is document-only and is never included.
 */
export function profileStack(): string[] {
  return composeReadStack(PROFILE_RELAYS);
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
