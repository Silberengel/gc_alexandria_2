import { viteHex, viteList, viteString } from './build-env';

/**
 * Relays and pubkeys below keep these addresses when the matching `VITE_`
 * variable is unset. Set the variable at build time to replace that value.
 * Lists are comma-separated and replace the whole list (they are not appended).
 * `npm run dev` still calls Mercury at `/mercury`; the Vite proxy target is
 * the origin of `VITE_MERCURY_HTTP`.
 */
const env = import.meta.env;

export const MERCURY_WSS = viteString(env.VITE_MERCURY_WSS, 'wss://mercury-relay.imwald.eu');

export const MERCURY_HTTP = import.meta.env.DEV
  ? '/mercury'
  : viteString(env.VITE_MERCURY_HTTP, 'https://mercury-relay.imwald.eu');

/**
 * AsciiDoctor the client calls for EPUB/PDF (`POST {url}/convert/{epub|pdf}`).
 * Set `VITE_ASCIIDOCTOR_SERVER_URL` at build time to that instance's base URL.
 * Unset, the client uses same-origin `/api/asciidoctor`.
 */
export const ASCIIDOCTOR_SERVER_URL =
  (import.meta.env.VITE_ASCIIDOCTOR_SERVER_URL as string | undefined)?.trim() ||
  '/api/asciidoctor';

export const THIRD_PARTY_RELAYS = viteList(env.VITE_THIRD_PARTY_RELAYS, [
  'wss://nostr.land',
  'wss://nostr21.com',
  'wss://relay.sovbit.host',
  'wss://nostr.wine',
  'wss://nostr.xmr.rocks'
]);

export const DOCUMENT_SEARCH_RELAYS = viteList(env.VITE_DOCUMENT_SEARCH_RELAYS, [
  'wss://thecitadel.nostr1.com',
  MERCURY_WSS,
  ...THIRD_PARTY_RELAYS
]);

/** Relays for Amber / NostrConnect (`nostrconnect://`) login URIs. */
export const DEFAULT_NOSTRCONNECT_RELAY = viteList(env.VITE_NOSTRCONNECT_RELAYS, [
  'wss://relay.nsec.app/',
  'wss://bucket.coracle.social/',
  'wss://thecitadel.nostr1.com/'
]);

export const WIKI_RELAYS = viteList(env.VITE_WIKI_RELAYS, ['wss://relay.wikifreedia.xyz']);

export const SOCIAL_RELAYS = viteList(env.VITE_SOCIAL_RELAYS, [
  'wss://theforest.nostr1.com',
  // GitCitadel booklist labels (kind 1985) — keep early so a small relay cap still hits them.
  'wss://thecitadel.nostr1.com',
  ...THIRD_PARTY_RELAYS
]);

/** Kind-0 / profile mirrors — same set as jumble `PROFILE_RELAY_URLS` (not Mercury). */
export const PROFILE_RELAYS = viteList(env.VITE_PROFILE_RELAYS, [
  'wss://profiles.nostr1.com',
  'wss://indexer.coracle.social',
  'wss://thecitadel.nostr1.com'
]);

export const AGGR_RELAY = viteString(env.VITE_AGGR_RELAY, 'wss://aggr.nostr.land');

/** Brainstorm NIP-50 search (vespa) — extensions only on this host. */
export const BRAINSTORM_SEARCH_RELAY_URL = viteString(
  env.VITE_BRAINSTORM_SEARCH_RELAY_URL,
  'wss://search.brainstorm.world'
);

/** Community observer when the viewer has no kind 10040. */
export const GRAPEVINE_FALLBACK_OBSERVER_PUBKEY = viteHex(
  env.VITE_GRAPEVINE_FALLBACK_OBSERVER_PUBKEY,
  'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319'
);

/** Builtin Brainstorm scores service (signs kind 30382). */
export const GRAPEVINE_FALLBACK_SERVICE_PUBKEY = viteHex(
  env.VITE_GRAPEVINE_FALLBACK_SERVICE_PUBKEY,
  '0e5c4a064fc6cdbbddaa8b7c452e806d2f8e57a1dc5bc678cfe8cb258ca85546'
);

/** Production NIP-85 scores relay (often TLS-dead — prefer staging when pointed here). */
export const GRAPEVINE_SCORES_RELAY_URL = viteString(
  env.VITE_GRAPEVINE_SCORES_RELAY_URL,
  'wss://straycat.brainstorm.social/relay'
);

export const GRAPEVINE_SCORES_STAGING_RELAY_URL = viteString(
  env.VITE_GRAPEVINE_SCORES_STAGING_RELAY_URL,
  'wss://nip85-staging.nosfabrica.com'
);

/** GC Publishing — fallback preference tier when grapevine rank is unknown. */
export const LIBRARY_GC_PUBLISHING_PUBKEY = viteHex(
  env.VITE_LIBRARY_GC_PUBLISHING_PUBKEY,
  '3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690'
);

export const GITCITADEL_NPUB = viteString(
  env.VITE_GITCITADEL_NPUB,
  'npub1s3ht77dq4zqnya8vjun5jp3p44pr794ru36d0ltxu65chljw8xjqd975wz'
);

export const GITCITADEL_CURATOR_NPUB = viteString(
  env.VITE_GITCITADEL_CURATOR_NPUB,
  'npub18cddpua960qjy3wmw7y9gmzr4h3ajlrwq3k9jnmqzlxke4qkg6gqeyaztw'
);

export const REPO_OWNER_HEX = viteHex(
  env.VITE_REPO_OWNER_HEX,
  'fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1'
);

/** Default GrapeRank minimum for Trust filter and Brainstorm `filter:rank:gte:`. */
export const GRAPEVINE_RANK_MIN_DEFAULT = 10;

/** NIP-89 client tag value on events this app signs. */
export const ALEXANDRIA_CLIENT = 'Alexandria';

export const NIP32_BOOKLIST_LABEL = 'booklist';
/** Personal “I have read this” mark — never shown as a list label. */
export const NIP32_READ_LABEL = 'read';
export const NIP32_UGC_NAMESPACE = 'ugc';

/** Default concurrent active books from the reading queue (Settings). */
export const READING_CONCURRENT_DEFAULT = 3;
export const READING_CONCURRENT_MIN = 1;
export const READING_CONCURRENT_MAX = 10;

export const MUTED_PARENT_PLACEHOLDER = 'This author is muted.';
/** Shown while/after a parent id was requested but not returned from relays. */
export const MISSING_PARENT_PLACEHOLDER = 'Parent comment could not be found.';

export const CONTACT_A_TAG = `30617:${REPO_OWNER_HEX}:Alexandria`;

export const KIND = {
  METADATA: 0,
  CONTACT_LIST: 3,
  TEXT_NOTE: 1,
  DELETION: 5,
  REACTION: 7,
  HIGHLIGHT: 9802,
  BOOKMARK: 10003,
  MUTE: 10000,
  RELAY_LIST: 10002,
  BLOCKED: 10006,
  FAVORITE: 10012,
  /** NIP-30 user emoji list (pointers to kind 30030 packs). */
  USER_EMOJI_LIST: 10030,
  LOCAL: 10432,
  COMMENT: 1111,
  LABEL: 1985,
  ISSUE: 1621,
  PAYMENT: 10133,
  /** Reading queue + Bookshelf-style progress (one replaceable per pubkey). */
  READING_QUEUE: 16374,
  PICTURE: 20,
  VIDEO: 21,
  LONG_FORM: 30023,
  PUBLICATION: 30040,
  SECTION: 30041,
  /** NKBIP-04 directory index (bookshelf folders). */
  DIRECTORY: 30045,
  FOLLOW_SET: 30000,
  /** NIP-30 emoji pack (addressable). */
  EMOJI_SET: 30030,
  STATUS: 30315,
  RATING: 34259,
  WIKI: 30818,
  SPEC: 30817,
  DJOT: 11,
  /** NIP-85 Trusted Assertions prefs (provider pointer). */
  NIP85_PREFS: 10040,
  /** NIP-85 Trusted Assertion score for a subject pubkey (`d` tag). */
  NIP85_SCORE: 30382
} as const;

export const LOGIN_METADATA_KINDS = [
  KIND.METADATA,
  KIND.CONTACT_LIST,
  KIND.MUTE,
  KIND.RELAY_LIST,
  KIND.BOOKMARK,
  KIND.BLOCKED,
  KIND.FAVORITE,
  KIND.LOCAL,
  KIND.PAYMENT,
  KIND.LABEL,
  KIND.DIRECTORY,
  KIND.FOLLOW_SET,
  KIND.STATUS
];

export const CACHE_KINDS = [
  KIND.METADATA,
  KIND.CONTACT_LIST,
  KIND.DJOT,
  KIND.PICTURE,
  KIND.VIDEO,
  KIND.LABEL,
  KIND.HIGHLIGHT,
  KIND.MUTE,
  KIND.RELAY_LIST,
  KIND.BOOKMARK,
  KIND.BLOCKED,
  KIND.FAVORITE,
  KIND.LOCAL,
  KIND.PAYMENT,
  KIND.COMMENT,
  KIND.FOLLOW_SET,
  KIND.LONG_FORM,
  KIND.PUBLICATION,
  KIND.SECTION,
  KIND.DIRECTORY,
  KIND.STATUS,
  KIND.SPEC,
  KIND.WIKI,
  KIND.RATING,
  KIND.READING_QUEUE
];

export type StackKind = 'document' | 'wiki' | 'social' | 'highlight' | 'profile';
