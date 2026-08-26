export const MERCURY_WSS = 'wss://mercury-relay.imwald.eu';

export const MERCURY_HTTP = import.meta.env.DEV
  ? '/mercury'
  : 'https://mercury-relay.imwald.eu';

export const THIRD_PARTY_RELAYS = [
  'wss://nostr.land',
  'wss://nostr21.com',
  'wss://relay.sovbit.host',
  'wss://nostr.wine'
] as const;

export const DOCUMENT_SEARCH_RELAYS = [
  'wss://thecitadel.nostr1.com',
  MERCURY_WSS,
  ...THIRD_PARTY_RELAYS
] as const;

export const WIKI_RELAYS = ['wss://relay.wikifreedia.xyz'] as const;

export const SOCIAL_RELAYS = ['wss://theforest.nostr1.com', ...THIRD_PARTY_RELAYS] as const;

export const AGGR_RELAY = 'wss://aggr.nostr.land';

export const GITCITADEL_NPUB =
  'npub1s3ht77dq4zqnya8vjun5jp3p44pr794ru36d0ltxu65chljw8xjqd975wz';

export const GITCITADEL_CURATOR_NPUB =
  'npub18cddpua960qjy3wmw7y9gmzr4h3ajlrwq3k9jnmqzlxke4qkg6gqeyaztw';

export const NIP32_BOOKLIST_LABEL = 'booklist';
export const NIP32_UGC_NAMESPACE = 'ugc';

export const MUTED_PARENT_PLACEHOLDER =
  'This npub is muted or the event could not be found.';

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
  FOLLOW_SET: 30000,
  STATUS: 30315,
  RATING: 34259,
  WIKI: 30818,
  SPEC: 30817,
  DJOT: 11
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
  KIND.STATUS,
  KIND.SPEC,
  KIND.WIKI,
  KIND.RATING
];

export type StackKind = 'document' | 'wiki' | 'social' | 'highlight';
