import type { Event } from 'nostr-tools';
import { commentParentId, isKind1Quote, isKind1Reply } from './comments';
import { KIND } from './constants';
import { parseAddress } from './library-scope';

const HEX_ID = /^[0-9a-f]{64}$/i;

export type NoteRefKind = 'reply' | 'quote';

export type NoteRefSpec =
  | {
      kind: NoteRefKind;
      type: 'id';
      id: string;
      relayHints: string[];
      pubkeyHint: string | null;
    }
  | {
      kind: NoteRefKind;
      type: 'addr';
      coordinate: string;
      relayHints: string[];
      pubkeyHint: string | null;
    }
  | { kind: NoteRefKind; type: 'http'; url: string };

function relayHintFromTag(tag: string[] | undefined): string[] {
  const relay = tag?.[2]?.trim();
  if (!relay || !/^wss?:\/\//i.test(relay)) return [];
  return [relay];
}

function pubkeyHintFromTag(tag: string[] | undefined): string | null {
  const pk = tag?.[3]?.trim() || tag?.[4]?.trim();
  return pk && HEX_ID.test(pk) ? pk.toLowerCase() : null;
}

function qTag(event: Event): string[] | undefined {
  return event.tags.find((t) => t[0] === 'q' && t[1]?.trim());
}

function parseQValue(
  raw: string,
  tag: string[]
): Exclude<NoteRefSpec, { type: 'http' }> | null {
  const v = raw.trim();
  if (HEX_ID.test(v)) {
    return {
      kind: 'quote',
      type: 'id',
      id: v.toLowerCase(),
      relayHints: relayHintFromTag(tag),
      pubkeyHint: pubkeyHintFromTag(tag)
    };
  }
  if (/^https?:\/\//i.test(v)) {
    return null;
  }
  const parsed = parseAddress(v);
  if (parsed) {
    return {
      kind: 'quote',
      type: 'addr',
      coordinate: `${parsed.kind}:${parsed.pubkey}:${parsed.d}`,
      relayHints: relayHintFromTag(tag),
      pubkeyHint: parsed.pubkey
    };
  }
  return null;
}

function replySpec(event: Event): NoteRefSpec | null {
  const parent = commentParentId(event)?.trim();
  if (!parent) return null;
  if (/^https?:\/\//i.test(parent)) {
    return { kind: 'reply', type: 'http', url: parent };
  }
  if (HEX_ID.test(parent)) {
    const eTag = event.tags.find(
      (t) => (t[0] === 'e' || t[0] === 'E') && t[1]?.toLowerCase() === parent.toLowerCase()
    );
    return {
      kind: 'reply',
      type: 'id',
      id: parent.toLowerCase(),
      relayHints: relayHintFromTag(eTag),
      pubkeyHint: pubkeyHintFromTag(eTag)
    };
  }
  const parsed = parseAddress(parent);
  if (!parsed) return null;
  const coord = `${parsed.kind}:${parsed.pubkey}:${parsed.d}`;
  const aTag = event.tags.find((t) => {
    if ((t[0] !== 'a' && t[0] !== 'A') || !t[1]) return false;
    const hit = parseAddress(t[1]);
    return hit != null && `${hit.kind}:${hit.pubkey}:${hit.d}` === coord;
  });
  return {
    kind: 'reply',
    type: 'addr',
    coordinate: coord,
    relayHints: relayHintFromTag(aTag),
    pubkeyHint: parsed.pubkey
  };
}

function quoteSpec(event: Event): NoteRefSpec | null {
  const tag = qTag(event);
  if (!tag?.[1]) return null;
  const v = tag[1].trim();
  if (/^https?:\/\//i.test(v)) return { kind: 'quote', type: 'http', url: v };
  return parseQValue(v, tag);
}

/**
 * Compact “Reply to” / “Quote of” chip target (imwald NoteReferenceBlurb parity).
 * Highlights use {@link highlightSourceRef} instead. Reply wins over quote.
 */
export function noteReferenceSpec(event: Event): NoteRefSpec | null {
  if (
    event.kind === KIND.HIGHLIGHT ||
    event.kind === KIND.PUBLICATION ||
    event.kind === KIND.SECTION ||
    event.kind === KIND.RATING
  ) {
    return null;
  }
  if (isKind1Reply(event) || event.kind === KIND.COMMENT) {
    return replySpec(event);
  }
  if (isKind1Quote(event) || (event.kind === KIND.TEXT_NOTE && qTag(event))) {
    return quoteSpec(event);
  }
  return null;
}

/** One-line preview for a resolved parent/quoted event. */
export function noteReferencePreviewText(event: Event, max = 120): string {
  const title = event.tags.find((t) => t[0] === 'title' && t[1]?.trim())?.[1]?.trim();
  if (title) return title.slice(0, max);
  const line =
    event.content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  if (line) return line.slice(0, max);
  return '…';
}
