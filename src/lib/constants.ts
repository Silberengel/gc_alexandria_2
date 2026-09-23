export const MERCURY_WSS = 'wss://mercury-relay.imwald.eu';

export const MERCURY_HTTP = import.meta.env.DEV
  ? '/mercury'
  : 'https://mercury-relay.imwald.eu';

export const THIRD_PARTY_RELAYS = [
  'wss://nostr.land',
  'wss://nostr21.com',
  'wss://relay.sovbit.host',
  'wss://nostr.wine',
  'wss://nostr.xmr.rocks'
] as const;

export const DOCUMENT_SEARCH_RELAYS = [
  'wss://thecitadel.nostr1.com',
  MERCURY_WSS,
  ...THIRD_PARTY_RELAYS
] as const;

/** Relays for Amber / NostrConnect (`nostrconnect://`) login URIs. */
export const DEFAULT_NOSTRCONNECT_RELAY = [
  'wss://relay.nsec.app/',
  'wss://bucket.coracle.social/',
  'wss://thecitadel.nostr1.com/'
] as const;

export const WIKI_RELAYS = ['wss://relay.wikifreedia.xyz'] as const;

export const SOCIAL_RELAYS = [
  'wss://theforest.nostr1.com',
  // GitCitadel booklist labels (kind 1985) — keep early so a small relay cap still hits them.
  'wss://thecitadel.nostr1.com',
  ...THIRD_PARTY_RELAYS
] as const;

/** Kind-0 / profile mirrors — same set as jumble `PROFILE_RELAY_URLS` (not Mercury). */
export const PROFILE_RELAYS = [
  'wss://profiles.nostr1.com',
  'wss://indexer.coracle.social',
  'wss://thecitadel.nostr1.com'
] as const;

export const AGGR_RELAY = 'wss://aggr.nostr.land';

/** Brainstorm NIP-50 search (vespa) — extensions only on this host. */
export const BRAINSTORM_SEARCH_RELAY_URL = 'wss://search-staging.brainstorm.world';

/** Community observer when the viewer has no kind 10040. */
export const GRAPEVINE_FALLBACK_OBSERVER_PUBKEY =
  'dd664d5e4016433a8cd69f005ae1480804351789b59de5af06276de65633d319';

/** Builtin Brainstorm scores service (signs kind 30382). */
export const GRAPEVINE_FALLBACK_SERVICE_PUBKEY =
  '0e5c4a064fc6cdbbddaa8b7c452e806d2f8e57a1dc5bc678cfe8cb258ca85546';

/** Production NIP-85 scores relay (often TLS-dead — prefer staging when pointed here). */
export const GRAPEVINE_SCORES_RELAY_URL = 'wss://straycat.brainstorm.social/relay';

export const GRAPEVINE_SCORES_STAGING_RELAY_URL = 'wss://nip85-staging.nosfabrica.com';

/** Protocol / Brainstorm floor (omit-value cases). App Trust-filter default is higher. */
export const GRAPEVINE_RANK_CUTOFF = 2;

/** Default GrapeRank minimum for Trust filter and Brainstorm `filter:rank:gte:`. */
export const GRAPEVINE_RANK_MIN_DEFAULT = 10;

/** GC Publishing — fallback preference tier when grapevine rank is unknown. */
export const LIBRARY_GC_PUBLISHING_PUBKEY =
  '3e1ad0f3a5d3c12245db7788546c43ade3d97c6e046c594f6017cd6cd4164690';

export const GITCITADEL_NPUB =
  'npub1s3ht77dq4zqnya8vjun5jp3p44pr794ru36d0ltxu65chljw8xjqd975wz';

export const GITCITADEL_CURATOR_NPUB =
  'npub18cddpua960qjy3wmw7y9gmzr4h3ajlrwq3k9jnmqzlxke4qkg6gqeyaztw';

export const NIP32_BOOKLIST_LABEL = 'booklist';
export const NIP32_UGC_NAMESPACE = 'ugc';

export const MUTED_PARENT_PLACEHOLDER = 'This author is muted.';
/** Shown while/after a parent id was requested but not returned from relays. */
export const MISSING_PARENT_PLACEHOLDER = 'Parent comment could not be found.';

export const REPO_OWNER_HEX =
  'fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1';

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
  LOCAL: 10432,
  COMMENT: 1111,
  LABEL: 1985,
  ISSUE: 1621,
  PAYMENT: 10133,
  PICTURE: 20,
  VIDEO: 21,
  LONG_FORM: 30023,
  PUBLICATION: 30040,
  SECTION: 30041,
  /** NKBIP-04 directory index (bookshelf folders). */
  DIRECTORY: 30045,
  FOLLOW_SET: 30000,
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
  KIND.RATING
];

export type StackKind = 'document' | 'wiki' | 'social' | 'highlight' | 'profile';
