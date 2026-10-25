import {
  AGGR_RELAY,
  BRAINSTORM_SEARCH_RELAY_URL,
  DOCUMENT_SEARCH_RELAYS,
  GRAPEVINE_SCORES_RELAY_URL,
  GRAPEVINE_SCORES_STAGING_RELAY_URL,
  MERCURY_HTTP,
  MERCURY_WSS,
  PROFILE_RELAYS,
  PUBLIC_BROADCAST_RELAYS,
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
const selectorListeners = new Set<() => void>();

function selectorFeedKey(value: SelectorContext): string {
  return [
    value.signedIn ? '1' : '0',
    value.viewerPubkey,
    value.inbox.join('\n'),
    value.favorites.join('\n')
  ].join('|');
}

export function setSelectorContext(partial: Partial<SelectorContext>): void {
  const before = selectorFeedKey(ctx);
  ctx = { ...ctx, ...partial };
  if (selectorFeedKey(ctx) === before) return;
  for (const listener of selectorListeners) listener();
}

/** Fires when the signed-in feed relays (inboxes and favorites) change. */
export function onSelectorContext(listener: () => void): () => void {
  selectorListeners.add(listener);
  return () => {
    selectorListeners.delete(listener);
  };
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

/** theforest. The one relay used when a signed-in viewer has no relays of their own. */
export function forestRelay(): string {
  return (
    SOCIAL_RELAYS.find((url) => url.toLowerCase().includes('theforest')) ??
    'wss://theforest.nostr1.com'
  );
}

function forestFallback(urls: string[]): string[] {
  return urls.length ? urls : [forestRelay()];
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

/**
 * GitCitadel preset relays. Forced on when signed out; when signed in, follows Settings.
 */
export function gitcitadelReadsAllowed(): boolean {
  if (!ctx.signedIn) return true;
  return relayPrefs.get().gitcitadel;
}

/**
 * Other people's relays (outboxes, inboxes, tag hints).
 * Forced on when signed out (all three relay types on); when signed in, follows Outboxes.
 */
export function foreignRelaysAllowed(): boolean {
  if (!ctx.signedIn) return true;
  return relayPrefs.get().outboxes;
}

/**
 * Drop every relay this session is not allowed to dial.
 * Signed out: all three types on — URLs are not filtered here.
 * Signed in, Outboxes off: the viewer's lists, plus GitCitadel's when that toggle is on.
 * An empty viewer list falls back to theforest.
 * Signed in, Outboxes on: callers may also pass one author's inbox or outbox.
 * Those URLs are not rewritten here. Note-hunt relays are separate ({@link socialSearchStack}).
 */
export function constrainRelays(urls: string[]): string[] {
  if (foreignRelaysAllowed()) return urls;
  const allow = new Set<string>();
  if (gitcitadelReadsAllowed()) {
    for (const key of gitcitadelRelayKeys()) allow.add(key);
  }
  const own = viewerRelayLists();
  for (const url of own) allow.add(relayKey(url));
  if (ctx.signedIn && own.length === 0) allow.add(relayKey(forestRelay()));
  return urls.filter((url) => allow.has(relayKey(url)));
}

/**
 * Hard-coded relays (when signed out, or when the GitCitadel toggle is on) plus the
 * viewer's own lists when signed in. Never another person's relays.
 */
function composeReadStack(hardcoded: readonly string[], personal: string[] = viewerRelayLists()): string[] {
  const shipped = gitcitadelReadsAllowed() ? hardcoded : [];
  const urls = maybeAggr(withoutBlocked(stackUrls([...shipped, ...personal])));
  if (ctx.signedIn && urls.length === 0) return withoutBlocked([forestRelay()]);
  return urls;
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
  return forestFallback(withoutBlocked(stackUrls([...ctx.outbox, ...ctx.favorites, ...ctx.local])));
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
 * Popular relays used only to find a missing note / embed (Primus, nos.lol, …).
 * Only when the GitCitadel preset relays setting is on (always for signed-out).
 */
export function socialSearchStack(): string[] {
  if (!gitcitadelReadsAllowed()) return [];
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
    forestFallback(withoutBlocked(dedupe([...ctx.outbox, ...ctx.favorites, ...ctx.local])))
  );
}

/**
 * Relays for “Broadcast to your outboxes”:
 * signed in → viewer's write stack; signed out → {@link PUBLIC_BROADCAST_RELAYS}.
 */
export function broadcastStack(): string[] {
  if (ctx.signedIn) {
    const own = writeStack();
    if (own.length) return own;
  }
  return writeWebSocketRelays(withoutBlocked([...PUBLIC_BROADCAST_RELAYS]));
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
