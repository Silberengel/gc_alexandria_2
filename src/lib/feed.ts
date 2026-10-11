import type { Event, Filter } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import { isKind1Reply } from './comments';
import { filterMuted, followPubkeysFromMetadata, type MuteState } from './mute';
import { uniqueRelayUrls } from './nostr/mailboxes';
import { memoryGetEvent } from './nostr/event-memory';
import { relayPool } from './nostr/pool';
import { pruneToLatestReplaceables } from './nostr/replaceable';
import { forestRelay, getSelectorContext } from './nostr/selector';

const FOLLOW_AUTHOR_BATCH = 50;
const FOLLOW_AUTHOR_CAP = 200;

/** Kinds a feed row can be: a note, or a post the library already knows how to show. */
const FEED_POST_KINDS = [
  KIND.DJOT,
  KIND.PICTURE,
  KIND.VIDEO,
  KIND.LONG_FORM,
  KIND.PUBLICATION,
  KIND.WIKI,
  KIND.SPEC
] as const;

const FEED_KINDS = new Set<number>([KIND.TEXT_NOTE, ...FEED_POST_KINDS]);

function tagMarkedRootOrReply(tag: string[]): boolean {
  return tag[2] === 'root' || tag[2] === 'reply' || tag[3] === 'root' || tag[3] === 'reply';
}

/**
 * An original post: a note or library post with no thread tags.
 * Kind 1 replies (any `e` tag, or an `a` tag marked root/reply) are responses.
 * Addressable posts stay original unless an `e`/`a` tag is marked root or reply.
 */
export function isOriginalPost(event: Event): boolean {
  if (!FEED_KINDS.has(event.kind)) return false;
  if (event.kind === KIND.TEXT_NOTE) return !isKind1Reply(event);
  return !event.tags.some(
    (tag) =>
      (tag[0] === 'e' || tag[0] === 'E' || tag[0] === 'a' || tag[0] === 'A') &&
      tag[1] &&
      tagMarkedRootOrReply(tag)
  );
}

export type FeedRelayGroups = {
  /** Signed-in viewer's favorites (when they have any) and inboxes. */
  personal: string[];
  /** theforest: signed out, or signed in with no favorites and no inboxes. */
  shipped: string[];
};

/**
 * Relays for the feed listing.
 * Signed out: theforest only.
 * Signed in: inboxes, plus favorites when that list is not empty.
 * No inboxes and no favorites: theforest.
 */
export function feedRelayGroups(): FeedRelayGroups {
  const ctx = getSelectorContext();
  const forest = [forestRelay()];
  if (!ctx.signedIn) return { personal: [], shipped: forest };
  const personal = uniqueRelayUrls([...(ctx.favorites.length ? ctx.favorites : []), ...ctx.inbox]);
  if (!personal.length) return { personal: [], shipped: forest };
  return { personal, shipped: [] };
}

function feedFilters(): Filter[] {
  return [
    { kinds: [KIND.TEXT_NOTE], limit: 40 },
    { kinds: [...FEED_POST_KINDS], limit: 24 }
  ];
}

/**
 * Pubkeys whose original notes are added to a signed-in feed.
 * Muted accounts are left out. Capped so one request stays modest.
 */
export function feedFollowAuthors(metadataEvents: Event[], muted: MuteState): string[] {
  const authors: string[] = [];
  for (const pubkey of followPubkeysFromMetadata(metadataEvents)) {
    if (muted.pubkeys.has(pubkey)) continue;
    authors.push(pubkey);
    if (authors.length >= FOLLOW_AUTHOR_CAP) break;
  }
  return authors;
}

function followNoteFilters(authors: string[]): Filter[] {
  const filters: Filter[] = [];
  for (let i = 0; i < authors.length; i += FOLLOW_AUTHOR_BATCH) {
    filters.push({
      kinds: [KIND.TEXT_NOTE],
      authors: authors.slice(i, i + FOLLOW_AUTHOR_BATCH),
      limit: 15
    });
  }
  return filters;
}

const emptyMute: MuteState = { pubkeys: new Set(), eventIds: new Set() };

/** Newest original posts from the session's feed relays, plus follows' notes when signed in. */
export async function loadFeed(metadataEvents: Event[] = [], muted: MuteState = emptyMute): Promise<Event[]> {
  const { personal, shipped } = feedRelayGroups();
  const filters = feedFilters();
  const relays = uniqueRelayUrls([...personal, ...shipped]);
  const authors = getSelectorContext().signedIn ? feedFollowAuthors(metadataEvents, muted) : [];
  const followFilters = followNoteFilters(authors);
  const [fromPersonal, fromShipped, fromFollows] = await Promise.all([
    personal.length
      ? relayPool.query(personal, filters, 7000, Math.min(personal.length, 8), undefined, {
          priority: true
        })
      : Promise.resolve([]),
    shipped.length
      ? relayPool.query(shipped, filters, 7000, 4, undefined, { priority: true })
      : Promise.resolve([]),
    followFilters.length
      ? relayPool
          .query(relays, followFilters, 7000, Math.min(relays.length, 8), undefined, { priority: true })
          .catch(() => [] as Event[])
      : Promise.resolve([] as Event[])
  ]);
  const byId = new Map<string, Event>();
  for (const event of [...fromPersonal, ...fromShipped, ...fromFollows]) {
    if (!isOriginalPost(event)) continue;
    byId.set(event.id, event);
  }
  const posts = pruneToLatestReplaceables([...byId.values()]).sort((a, b) => b.created_at - a.created_at);
  return filterMuted(posts, muted);
}

/** Load one event for a feed thread, from memory and then the same relay groups. */
export async function fetchFeedEvent(id: string): Promise<Event | null> {
  const hex = id.toLowerCase();
  const cached = memoryGetEvent(hex);
  if (cached) return cached;
  const { personal, shipped } = feedRelayGroups();
  const filter: Filter[] = [{ ids: [hex], limit: 1 }];
  if (personal.length) {
    const hit = (
      await relayPool.query(personal, filter, 4000, Math.min(personal.length, 8), undefined, {
        priority: true
      })
    )[0];
    if (hit) return hit;
  }
  if (shipped.length) {
    return (
      (
        await relayPool.query(shipped, filter, 4000, 4, undefined, { priority: true })
      )[0] ?? null
    );
  }
  return null;
}

export function feedThreadPath(event: Event): string {
  return `/feed/${nip19.noteEncode(event.id)}`;
}

/** `note1…`, `nevent1…`, or a 64-char hex id from the feed route. */
export function decodeFeedPointer(raw: string): string | null {
  const value = decodeURIComponent(raw).trim().replace(/^nostr:/i, '');
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'note') return decoded.data;
    if (decoded.type === 'nevent') return decoded.data.id;
  } catch {
    return null;
  }
  return null;
}
