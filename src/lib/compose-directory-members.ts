import type { Event } from 'nostr-tools';
import {
  buildDirectoryMemberTags,
  decodePointer,
  directoryMemberRowsFromRaw,
  directoryMembersRawFromTags,
  formatDirectoryMembers,
  type DirectoryMemberRow
} from '@silberengel/kind-compose-catalog';
import { KIND } from './constants';
import { parseAddress } from './library-scope';

export {
  buildDirectoryMemberTags,
  directoryMemberRowsFromRaw,
  directoryMembersRawFromTags,
  formatDirectoryMembers
};
export type { DirectoryMemberRow };

const HEX64 = /^[0-9a-f]{64}$/i;

function isHex64(value: string): boolean {
  return HEX64.test(value.trim());
}

function isAddress(value: string): boolean {
  return !!parseAddress(value.trim());
}

export function moveDirectoryMemberRow(
  rows: DirectoryMemberRow[],
  from: number,
  to: number
): DirectoryMemberRow[] {
  if (from < 0 || to < 0 || from >= rows.length || to >= rows.length || from === to) {
    return rows;
  }
  const next = [...rows];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Primary pointer shown in the row input — a-coordinates stay coordinates (not the optional e id). */
export function directoryMemberDisplayId(row: DirectoryMemberRow): string {
  if (row.tag === 'e') return row.value.trim().toLowerCase();
  return row.value.trim();
}

export function isValidDirectoryMemberValue(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true;
  if (isAddress(v) || isHex64(v)) return true;
  const decoded = decodePointer(v);
  return decoded?.type === 'event' || decoded?.type === 'addr';
}

/** Infer tag type after the user edits the pointer field. */
export function directoryMemberRowFromPointer(
  pointer: string,
  previous?: DirectoryMemberRow
): DirectoryMemberRow {
  const value = pointer.trim();
  const decoded = decodePointer(value);
  if (decoded?.type === 'event') {
    if (previous?.tag === 'a' && isAddress(previous.value) && isHex64(value)) {
      return {
        tag: 'a',
        value: previous.value,
        ...(previous.relay ? { relay: previous.relay } : decoded.relay ? { relay: decoded.relay } : {}),
        extra: decoded.id
      };
    }
    return {
      tag: 'e',
      value: decoded.id,
      ...(decoded.relay
        ? { relay: decoded.relay }
        : previous?.relay
          ? { relay: previous.relay }
          : {}),
      ...(decoded.author
        ? { extra: decoded.author }
        : previous?.tag === 'e' && previous.extra
          ? { extra: previous.extra }
          : {})
    };
  }
  if (decoded?.type === 'addr') {
    const coord = `${decoded.kind}:${decoded.pubkey}:${decoded.identifier}`;
    return {
      tag: 'a',
      value: coord,
      ...(decoded.relay
        ? { relay: decoded.relay }
        : previous?.relay
          ? { relay: previous.relay }
          : {}),
      ...(previous?.tag === 'a' && previous.extra && isHex64(previous.extra)
        ? { extra: previous.extra.toLowerCase() }
        : {})
    };
  }
  if (isHex64(value)) {
    if (previous?.tag === 'a' && isAddress(previous.value)) {
      return {
        tag: 'a',
        value: previous.value,
        ...(previous.relay ? { relay: previous.relay } : {}),
        extra: value.toLowerCase()
      };
    }
    return {
      tag: 'e',
      value: value.toLowerCase(),
      ...(previous?.relay ? { relay: previous.relay } : {}),
      ...(previous?.tag === 'e' && previous.extra ? { extra: previous.extra } : {})
    };
  }
  if (isAddress(value)) {
    return {
      tag: 'a',
      value,
      ...(previous?.relay ? { relay: previous.relay } : {}),
      ...(previous?.tag === 'a' && previous.extra && isHex64(previous.extra)
        ? { extra: previous.extra.toLowerCase() }
        : {})
    };
  }
  return {
    tag: previous?.tag ?? 'a',
    value,
    ...(previous?.relay ? { relay: previous.relay } : {}),
    ...(previous?.extra ? { extra: previous.extra } : {})
  };
}

/** True when this event is a directory we can replace in compose. */
export function isDirectoryEvent(event: Pick<Event, 'kind'>): boolean {
  return event.kind === KIND.DIRECTORY;
}
