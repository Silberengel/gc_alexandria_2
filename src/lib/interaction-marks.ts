import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { isPublicationLabelEvent, publicationTargets } from './nip32';
import { publicationTargetsFromDirectory } from './bookshelf';
import { publicationCoordinateFromRatingEvent } from './ratings';
import { referencedLibraryAddress } from './library-scope';
import { eventAddress } from './nostr/verify';

export type InteractionMark =
  | 'labeled'
  | 'bookmarked'
  | 'highlighted'
  | 'commented'
  | 'rated'
  | 'shelved';

export const INTERACTION_MARK_LABELS: Record<InteractionMark, string> = {
  labeled: 'labeled',
  bookmarked: 'bookmarked',
  highlighted: 'highlighted',
  commented: 'commented-on',
  rated: 'rated',
  shelved: 'shelved'
};

function addMark(
  map: Map<string, Set<InteractionMark>>,
  key: string,
  mark: InteractionMark
): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(mark);
}

/** Build address → marks from the viewer's interaction events. */
export function interactionMarksFromEvents(events: Event[]): Map<string, Set<InteractionMark>> {
  const map = new Map<string, Set<InteractionMark>>();
  for (const event of events) {
    if (event.kind === KIND.LABEL && isPublicationLabelEvent(event)) {
      const t = publicationTargets(event);
      for (const a of t.addresses) addMark(map, a, 'labeled');
      for (const id of t.eventIds) addMark(map, id, 'labeled');
    } else if (event.kind === KIND.BOOKMARK) {
      const t = publicationTargets(event);
      for (const a of t.addresses) addMark(map, a, 'bookmarked');
      for (const id of t.eventIds) addMark(map, id, 'bookmarked');
    } else if (event.kind === KIND.DIRECTORY) {
      const t = publicationTargetsFromDirectory(event);
      for (const a of t.addresses) addMark(map, a, 'shelved');
      for (const id of t.eventIds) addMark(map, id, 'shelved');
    } else if (event.kind === KIND.HIGHLIGHT) {
      const lib = referencedLibraryAddress(event);
      if (lib) addMark(map, lib, 'highlighted');
      const a = event.tags.find((t) => t[0] === 'a')?.[1];
      if (a) addMark(map, a, 'highlighted');
    } else if (event.kind === KIND.COMMENT) {
      const lib = referencedLibraryAddress(event);
      if (lib) addMark(map, lib, 'commented');
      const A = event.tags.find((t) => t[0] === 'A')?.[1];
      const a = event.tags.find((t) => t[0] === 'a')?.[1];
      if (A) addMark(map, A, 'commented');
      if (a) addMark(map, a, 'commented');
    } else if (event.kind === KIND.RATING) {
      const coord = publicationCoordinateFromRatingEvent(event);
      if (coord) addMark(map, coord, 'rated');
    }
  }
  return map;
}

export function marksForPublication(
  marks: Map<string, Set<InteractionMark>>,
  publication: Event
): InteractionMark[] {
  const addr = eventAddress(publication);
  const merged = new Set<InteractionMark>();
  for (const key of [addr, publication.id.toLowerCase()]) {
    const set = marks.get(key);
    if (set) for (const m of set) merged.add(m);
  }
  const order: InteractionMark[] = [
    'labeled',
    'shelved',
    'bookmarked',
    'highlighted',
    'commented',
    'rated'
  ];
  return order.filter((m) => merged.has(m));
}
