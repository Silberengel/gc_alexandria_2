import { viteHex, viteList, viteString } from './build-env';

/** Semver from package.json, baked in at build time. */
export const APP_VERSION: string = __APP_VERSION__;
/** Semver+git SHA — changes every deploy; used for update detection. */
export const APP_BUILD: string = __APP_BUILD__;

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

/**
 * Open Graph preview sidecar (`POST {url}` JSON → HTML card or 204).
 * Same contract as unfold `/og-preview/` (embed/embed on blog.imwald.eu).
 * Unset, the client uses same-origin `/api/og-preview` (Vite proxy in dev).
 */
export const OG_PREVIEW_URL =
  (import.meta.env.VITE_OG_PREVIEW_URL as string | undefined)?.trim() || '/api/og-preview';

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

/** Kind 1 / thread search (NIP-10 parents, replies). Comma-separated `VITE_SOCIAL_SEARCH_RELAYS`. */
export const SOCIAL_SEARCH_RELAYS = viteList(env.VITE_SOCIAL_SEARCH_RELAYS, [
  'wss://primus.nostr1.com',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://nostrelites.org',
  'wss://pipe.imwald.eu',
  'wss://wheat.happytavern.co'
]);

/**
 * Shared public lane: signed-out broadcast (“Broadcast to your outboxes”) and
 * NIP-53 live chat / room presence (pipe, thecitadel, freelay).
 */
export const PUBLIC_BROADCAST_RELAYS = viteList(env.VITE_PUBLIC_BROADCAST_RELAYS, [
  'wss://pipe.imwald.eu',
  'wss://thecitadel.nostr1.com',
  'wss://freelay.sovbit.host'
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
  /** NIP-A4 public message (plaintext to one or more `p` recipients; no `e` threads). */
  PUBLIC_MESSAGE: 24,
  /** NIP-41 short-note edit (kind-1 content revision). */
  SHORT_NOTE_EDIT: 1010,
  DELETION: 5,
  REPOST: 6,
  GENERIC_REPOST: 16,
  REACTION: 7,
  HIGHLIGHT: 9802,
  /** NIP-57 zap receipt. */
  ZAP: 9735,
  /** Nosmero / Monero tip disclosure. */
  MONERO_TIP: 9736,
  /** Garnet / jumble Monero tip receipt. */
  MONERO_TIP_RECEIPT: 1814,
  /** NIP-51 pin list. */
  PIN: 10001,
  BOOKMARK: 10003,
  MUTE: 10000,
  /** NIP-51 communities list (NIP-72). */
  COMMUNITIES: 10004,
  RELAY_LIST: 10002,
  /**
   * Deprecated NIP-51 categorized list (addressable).
   * Only `d` = pin | bookmark | communities — migrate to 10001 / 10003 / 10004.
   */
  DEPRECATED_CATEGORIZED_LIST: 30001,
  BLOCKED: 10006,
  FAVORITE: 10012,
  /** NIP-37 private storage relay list (encrypted content). */
  PRIVATE_RELAY_LIST: 10013,
  /** NIP-30 user emoji list (pointers to kind 30030 packs). */
  USER_EMOJI_LIST: 10030,
  /** HTTP auth relay list (NIP-66-style). */
  HTTP_RELAY_LIST: 10243,
  LOCAL: 10432,
  /** NIP-37 draft checkpoint (revision of a 31234 wrap). */
  DRAFT_CHECKPOINT: 1234,
  COMMENT: 1111,
  /** NIP-88 poll question. */
  POLL: 1068,
  /** NIP-88 poll response (vote). */
  POLL_RESPONSE: 1018,
  LABEL: 1985,
  /** NIP-34 git issue. */
  ISSUE: 1621,
  /** NIP-34 issue/PR/patch status: Open. */
  ISSUE_STATUS_OPEN: 1630,
  /** NIP-34 status: Resolved (issues) / Applied·Merged (patches). */
  ISSUE_STATUS_RESOLVED: 1631,
  /** NIP-34 status: Closed. */
  ISSUE_STATUS_CLOSED: 1632,
  /** NIP-34 status: Draft. */
  ISSUE_STATUS_DRAFT: 1633,
  PAYMENT: 10133,
  /** Reading queue + Bookshelf-style progress (one replaceable per pubkey). */
  READING_QUEUE: 16374,
  PICTURE: 20,
  VIDEO: 21,
  /** NIP-71 short-form video. */
  SHORT_VIDEO: 22,
  /** NKBIP-03 internal Nostr citation. */
  CITATION_INTERNAL: 30,
  /** NKBIP-03 external web citation. */
  CITATION_WEB: 31,
  /** NKBIP-03 hardcopy citation. */
  CITATION_HARDCOPY: 32,
  /** NKBIP-03 LLM / prompt citation. */
  CITATION_PROMPT: 33,
  /** NIP-A0 voice message. */
  VOICE: 1222,
  LONG_FORM: 30023,
  /** NIP-37 encrypted draft wrap (addressable). */
  DRAFT_WRAP: 31234,
  PUBLICATION: 30040,
  SECTION: 30041,
  /** NIP-34 git repository announcement. */
  GIT_REPO: 30617,
  /** NIP-52 date-based calendar event (all-day / multi-day). */
  CALENDAR_DATE: 31922,
  /** NIP-52 time-based calendar event. */
  CALENDAR_TIME: 31923,
  /** NIP-52 calendar (collection of events). */
  CALENDAR: 31924,
  /** NIP-52 calendar event RSVP. */
  CALENDAR_RSVP: 31925,
  /** NKBIP-04 directory index (bookshelf folders). */
  DIRECTORY: 30045,
  FOLLOW_SET: 30000,
  /** NIP-51 bookmark set (addressable). */
  BOOKMARK_SET: 30003,
  /** NIP-51 article curation set. */
  CURATION_ARTICLE: 30004,
  /** NIP-51 video curation set. */
  CURATION_VIDEO: 30005,
  /** NIP-51 picture curation set. */
  CURATION_PICTURE: 30006,
  /** NIP-30 emoji pack (addressable). */
  EMOJI_SET: 30030,
  /** NIP-53 kinds — numbers match suite `nip53` in kind-compose-catalog. */
  LIVE_CHAT: 1311,
  ROOM_PRESENCE: 10312,
  LIVE_EVENT: 30311,
  MEETING_SPACE: 30312,
  MEETING_ROOM: 30313,
  STATUS: 30315,
  /** NKBIP-01 publication / entity rating. */
  RATING: 34259,
  WIKI: 30818,
  SPEC: 30817,
  /** NIP-54 merge request (fork → destination article). */
  WIKI_MERGE_REQUEST: 818,
  /** Legacy NIP-54 merge acceptance (render only; prefer kind 7 ±). */
  WIKI_MERGE_ACCEPTANCE: 819,
  /** NIP-54 wiki redirect / alias. */
  WIKI_REDIRECT: 30819,
  /** DECK-0003 Simple Nostr Object (addressable 3D mesh). */
  SNO: 33331,
  DJOT: 11,
  /** Music track (catalog kind). */
  MUSIC: 36787,
  /** NIP-B0 web bookmark. */
  WEB_BOOKMARK: 39701,
  /** NIP-89 application handler announcement. */
  APP_HANDLER: 31990,
  /** NIP-85 Trusted Assertions prefs (provider pointer). */
  NIP85_PREFS: 10040,
  /** NIP-85 Trusted Assertion score for a subject pubkey (`d` tag). */
  NIP85_SCORE: 30382
} as const;

/** NKBIP-03 citation event kinds (30–33). */
export const CITATION_KINDS = [
  KIND.CITATION_INTERNAL,
  KIND.CITATION_WEB,
  KIND.CITATION_HARDCOPY,
  KIND.CITATION_PROMPT
] as const;

export function isCitationKind(kind: number): boolean {
  return (CITATION_KINDS as readonly number[]).includes(kind);
}

export const LOGIN_METADATA_KINDS = [
  KIND.METADATA,
  KIND.CONTACT_LIST,
  KIND.MUTE,
  KIND.PIN,
  KIND.RELAY_LIST,
  KIND.BOOKMARK,
  KIND.COMMUNITIES,
  KIND.BLOCKED,
  KIND.FAVORITE,
  KIND.PRIVATE_RELAY_LIST,
  KIND.LOCAL,
  KIND.PAYMENT,
  KIND.LABEL,
  KIND.DIRECTORY,
  KIND.FOLLOW_SET,
  /** Deprecated NIP-51 pin/bookmark/communities lists (`d` reserved). */
  KIND.DEPRECATED_CATEGORIZED_LIST,
  KIND.STATUS
];

export const CACHE_KINDS = [
  KIND.DJOT,
  KIND.PICTURE,
  KIND.VIDEO,
  KIND.LABEL,
  KIND.HIGHLIGHT,
  KIND.PIN,
  KIND.BOOKMARK,
  KIND.TEXT_NOTE,
  KIND.PUBLIC_MESSAGE,
  KIND.REACTION,
  KIND.COMMENT,
  KIND.ISSUE,
  KIND.ISSUE_STATUS_OPEN,
  KIND.ISSUE_STATUS_RESOLVED,
  KIND.ISSUE_STATUS_CLOSED,
  KIND.ISSUE_STATUS_DRAFT,
  KIND.REPOST,
  KIND.GENERIC_REPOST,
  KIND.FOLLOW_SET,
  KIND.LONG_FORM,
  KIND.PUBLICATION,
  KIND.SECTION,
  KIND.GIT_REPO,
  KIND.CALENDAR_DATE,
  KIND.CALENDAR_TIME,
  KIND.DIRECTORY,
  KIND.STATUS,
  KIND.LIVE_CHAT,
  KIND.ROOM_PRESENCE,
  KIND.LIVE_EVENT,
  KIND.MEETING_SPACE,
  KIND.MEETING_ROOM,
  KIND.SPEC,
  KIND.WIKI,
  KIND.RATING,
  KIND.READING_QUEUE
];

export type StackKind = 'document' | 'wiki' | 'social' | 'highlight' | 'profile';
