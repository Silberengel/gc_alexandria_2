import type { Event } from 'nostr-tools';
import { KIND, NIP32_READ_LABEL } from './constants';
import { coordinatesOverlap, publicationCoordinateLookupKeys } from './publication-coordinate';
import {
  eventTargetsPublication,
  isListPublicationLabelEvent,
  isReadLabelSlug,
  labelEventHasSlug,
  publicationTargets
} from './nip32';
import { parseAddress } from './library-scope';
import { type MuteState, notMuted } from './mute';
import { isNewerReplaceable } from './nostr/replaceable';
import { eventAddress } from './nostr/verify';

export { isReadLabelSlug, isListPublicationLabelEvent };

/** Kind 1985 that carries the reserved read mark. */
export function isReadLabelEvent(event: Event): boolean {
  if (event.kind !== KIND.LABEL) return false;
  return labelEventHasSlug(event, NIP32_READ_LABEL);
}

export function readLabelsForPublication(events: Event[], publication: Event): Event[] {
  return events.filter(
    (e) => isReadLabelEvent(e) && eventTargetsPublication(e, publication)
  );
}

/** Distinct readers who marked this edition (newest event wins per pubkey). */
export function distinctReadPubkeys(events: Event[], mute?: MuteState): string[] {
  const byPk = new Map<string, Event>();
  for (const event of events) {
    if (!isReadLabelEvent(event)) continue;
    if (mute && !notMuted(event, mute)) continue;
    const pk = event.pubkey.toLowerCase();
    const prev = byPk.get(pk);
    if (!prev || isNewerReplaceable(event, prev)) byPk.set(pk, event);
  }
  return [...byPk.keys()];
}

export function myReadLabel(
  events: Event[],
  publication: Event,
  pubkey: string | null | undefined
): Event | null {
  if (!pubkey) return null;
  const pk = pubkey.toLowerCase();
  let best: Event | null = null;
  for (const event of events) {
    if (event.pubkey.toLowerCase() !== pk) continue;
    if (!isReadLabelEvent(event) || !eventTargetsPublication(event, publication)) continue;
    if (!best || isNewerReplaceable(event, best)) best = event;
  }
  return best;
}

/** Distinct publication coordinates marked read by one author. */
export function countReadPublications(events: Event[]): number {
  const addrs = new Set<string>();
  for (const event of events) {
    if (!isReadLabelEvent(event)) continue;
    for (const addr of publicationTargets(event).addresses) {
      let key = addr;
      for (const existing of addrs) {
        if (coordinatesOverlap(existing, addr)) {
          key = existing;
          break;
        }
      }
      addrs.add(key);
    }
  }
  return addrs.size;
}

export function publicationKeysForQuery(publication: Event): string[] {
  return publicationCoordinateLookupKeys(eventAddress(publication));
}

export type EditionPeopleRow = {
  key: 'labeled' | 'bookmarked' | 'highlighted' | 'shelved' | 'reading';
  title: string;
  pubkeys: string[];
};

function newestPubkey(events: Event[], mute?: MuteState): string[] {
  const byPk = new Map<string, Event>();
  for (const event of events) {
    if (mute && !notMuted(event, mute)) continue;
    const pk = event.pubkey.toLowerCase();
    const prev = byPk.get(pk);
    if (!prev || isNewerReplaceable(event, prev)) byPk.set(pk, event);
  }
  return [...byPk.keys()];
}

function targetsEdition(event: Event, publication: Event): boolean {
  const addr = eventAddress(publication);
  const id = publication.id.toLowerCase();
  for (const tag of event.tags) {
    if (tag[0] === 'a' && tag[1] && coordinatesOverlap(tag[1], addr)) return true;
    if (tag[0] === 'A' && tag[1] && coordinatesOverlap(tag[1], addr)) return true;
    if (tag[0] === 'e' && tag[1]?.toLowerCase() === id) return true;
  }
  return false;
}

/**
 * People rows for the edition info page.
 * Labeled ignores `l=read` (those belong on the read toggle count).
 */
export function editionPeopleRows(opts: {
  publication: Event;
  labels?: Event[];
  bookmarks?: Event[];
  highlights?: Event[];
  directories?: Event[];
  readingQueues?: Event[];
  mute?: MuteState;
}): EditionPeopleRow[] {
  const { publication, mute } = opts;
  const labeled = (opts.labels ?? []).filter(
    (e) =>
      e.kind === KIND.LABEL &&
      isListPublicationLabelEvent(e) &&
      targetsEdition(e, publication)
  );
  const bookmarked = (opts.bookmarks ?? []).filter(
    (e) => e.kind === KIND.BOOKMARK && targetsEdition(e, publication)
  );
  const highlighted = (opts.highlights ?? []).filter(
    (e) => e.kind === KIND.HIGHLIGHT && targetsEdition(e, publication)
  );
  const shelved = (opts.directories ?? []).filter((e) => {
    if (e.kind !== KIND.DIRECTORY) return false;
    return e.tags.some(
      (t) =>
        t[0] === 'a' &&
        t[1] &&
        parseAddress(t[1])?.kind === KIND.PUBLICATION &&
        coordinatesOverlap(t[1], eventAddress(publication))
    );
  });
  const reading = (opts.readingQueues ?? []).filter(
    (e) => e.kind === KIND.READING_QUEUE && targetsEdition(e, publication)
  );

  const rows: EditionPeopleRow[] = [
    { key: 'reading', title: 'Reading', pubkeys: newestPubkey(reading, mute) },
    { key: 'labeled', title: 'Labeled', pubkeys: newestPubkey(labeled, mute) },
    { key: 'bookmarked', title: 'Bookmarked', pubkeys: newestPubkey(bookmarked, mute) },
    { key: 'highlighted', title: 'Highlighted', pubkeys: newestPubkey(highlighted, mute) },
    { key: 'shelved', title: 'Shelved', pubkeys: newestPubkey(shelved, mute) }
  ];
  return rows.filter((r) => r.pubkeys.length > 0);
}
