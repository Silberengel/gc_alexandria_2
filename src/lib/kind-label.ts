import type { Event } from 'nostr-tools';
import { getKind } from '@silberengel/kind-compose-catalog';
import { isKind1Quote, isKind1Reply } from './comments';
import { KIND } from './constants';

/** Short human label for a Nostr kind — prefer the compose catalog. */
export function kindDescription(kind: number): string {
  const catalog = getKind(kind)?.label?.trim();
  if (catalog) return catalog;

  // Fallbacks for kinds not (yet) in the pinned catalog.
  switch (kind) {
    case KIND.METADATA:
      return 'Profile metadata';
    case KIND.TEXT_NOTE:
      return 'Short text note';
    case KIND.SHORT_NOTE_EDIT:
      return 'Short note edit';
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
    case KIND.SHORT_VIDEO:
      return 'Short video';
    case KIND.VOICE:
      return 'Voice message';
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
      return 'Publication rating';
    case KIND.MUSIC:
      return 'Music track';
    case KIND.WEB_BOOKMARK:
      return 'Web bookmark';
    case KIND.APP_HANDLER:
      return 'App handler';
    case KIND.LABEL:
      return 'Label';
    case KIND.BOOKMARK:
      return 'Bookmarks';
    case KIND.READING_QUEUE:
      return 'Reading queue';
    case KIND.DIRECTORY:
      return 'Directory';
    case KIND.REPOST:
    case KIND.GENERIC_REPOST:
      return 'Repost';
    case KIND.ZAP:
      return 'Zap';
    case 1244:
      return 'Voice comment';
    case KIND.DJOT:
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

/**
 * Kind label for a concrete event — replies and quotes get distinct copy.
 * Reply wins over quote when both tags are present.
 */
export function eventKindDescription(event: Event): string {
  if (event.kind === KIND.TEXT_NOTE) {
    if (isKind1Reply(event)) return 'Short text reply';
    if (isKind1Quote(event)) return 'Quote';
  }
  return kindDescription(event.kind);
}

/** Compact kind line for a concrete event. */
export function eventKindLabelLine(event: Event): string {
  const desc = eventKindDescription(event);
  if (desc.startsWith('Event (kind ')) return desc;
  return `KIND: ${event.kind} · ${desc}`;
}
