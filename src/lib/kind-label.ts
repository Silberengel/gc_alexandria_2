import { KIND } from './constants';
import type { Event } from 'nostr-tools';

/** Short human label for a Nostr kind (jumble-style). */
export function kindDescription(kind: number): string {
  switch (kind) {
    case KIND.METADATA:
      return 'Profile metadata';
    case KIND.TEXT_NOTE:
      return 'Short text note';
    case KIND.REACTION:
      return 'Reaction';
    case KIND.HIGHLIGHT:
      return 'Highlight';
    case KIND.COMMENT:
      return 'Comment';
    case KIND.PICTURE:
      return 'Picture';
    case KIND.VIDEO:
      return 'Video';
    case KIND.LONG_FORM:
      return 'Long-form article';
    case KIND.PUBLICATION:
      return 'Publication';
    case KIND.SECTION:
      return 'Publication section';
    case KIND.WIKI:
      return 'Wiki article';
    case KIND.SPEC:
      return 'Specification';
    case KIND.RATING:
      return 'Rating';
    case KIND.LABEL:
      return 'Label';
    case KIND.BOOKMARK:
      return 'Bookmarks';
    case KIND.READING_QUEUE:
      return 'Reading queue';
    case KIND.DIRECTORY:
      return 'Directory';
    case 6:
      return 'Repost';
    case 7:
      return 'Reaction';
    case 11:
      return 'Discussion';
    default:
      return `Event (kind ${kind})`;
  }
}

/** Compact kind line for cards: `KIND: 1 · Short text note`. */
export function kindLabelLine(kind: number): string {
  const desc = kindDescription(kind);
  if (desc.startsWith('Event (kind ')) return desc;
  return `KIND: ${kind} · ${desc}`;
}
