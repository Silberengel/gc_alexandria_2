import type { Event } from 'nostr-tools';
import { decodePointer } from '@silberengel/kind-compose-catalog';
import { KIND } from './constants';
import { parseAddress } from './library-scope';

const HEX64 = /^[0-9a-f]{64}$/i;

export type DirectoryMemberRow = {
  /** `a` address membership or `e` event-id membership. */
  tag: 'a' | 'e';
  /** Coordinate (`kind:pubkey:d`) or 64-hex event id. */
  value: string;
  relay?: string;
  /** For `a`: optional event id. For `e`: optional pubkey. */
  extra?: string;
};

function isHex64(value: string): boolean {
  return HEX64.test(value.trim());
}

function isAddress(value: string): boolean {
  return !!parseAddress(value.trim());
}

/** Serialize directory `a`/`e` tags into a compose field value (one member per line). */
export function directoryMembersRawFromTags(tags: readonly string[][]): string {
  const lines: string[] = [];
  for (const tag of tags) {
    if (tag[0] === 'a' && tag[1]?.trim()) {
      const value = tag[1].trim();
      const relay = (tag[2] ?? '').trim();
      const extra = (tag[3] ?? '').trim();
      lines.push(['a', value, relay, extra].join('\t'));
    } else if (tag[0] === 'e' && tag[1]?.trim() && isHex64(tag[1])) {
      const value = tag[1].trim().toLowerCase();
      const relay = (tag[2] ?? '').trim();
      const extra = (tag[3] ?? '').trim();
      lines.push(['e', value, relay, extra].join('\t'));
    }
  }
  return lines.join('\n');
}

export function directoryMemberRowsFromRaw(raw: string): DirectoryMemberRow[] {
  const rows: DirectoryMemberRow[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.includes('\t') ? trimmed.split('\t') : trimmed.split('|');
    let tag: 'a' | 'e' | '' = '';
    let value = '';
    let relay = '';
    let extra = '';
    if (parts[0] === 'a' || parts[0] === 'e') {
      tag = parts[0];
      value = (parts[1] ?? '').trim();
      relay = (parts[2] ?? '').trim();
      extra = (parts[3] ?? '').trim();
    } else {
      value = (parts[0] ?? '').trim();
      relay = (parts[1] ?? '').trim();
      extra = (parts[2] ?? '').trim();
      if (isAddress(value)) tag = 'a';
      else if (isHex64(value)) tag = 'e';
    }
    if (!tag || !value) continue;
    if (tag === 'e') value = value.toLowerCase();
    rows.push({
      tag,
      value,
      ...(relay ? { relay } : {}),
      ...(extra ? { extra } : {})
    });
  }
  return rows.length ? rows : [{ tag: 'a', value: '' }];
}

export function formatDirectoryMembers(rows: DirectoryMemberRow[]): string {
  return rows
    .map((row) => {
      const value = row.value.trim();
      if (!value) return '';
      const tag = row.tag === 'e' || isHex64(value) ? 'e' : 'a';
      const normalized = tag === 'e' ? value.toLowerCase() : value;
      return [tag, normalized, row.relay?.trim() ?? '', row.extra?.trim() ?? ''].join('\t');
    })
    .filter(Boolean)
    .join('\n');
}

/** Build wire `a`/`e` tags from the members field value. */
export function buildDirectoryMemberTags(raw: string): string[][] {
  const out: string[][] = [];
  for (const row of directoryMemberRowsFromRaw(raw)) {
    const value = row.value.trim();
    if (!value) continue;
    const tag = row.tag === 'e' || (row.tag !== 'a' && isHex64(value)) ? 'e' : 'a';
    if (tag === 'a' && !isAddress(value)) continue;
    if (tag === 'e' && !isHex64(value)) continue;
    const relay = row.relay?.trim() ?? '';
    const extra = row.extra?.trim() ?? '';
    if (tag === 'a') {
      const id = extra && isHex64(extra) ? extra.toLowerCase() : '';
      out.push(id ? ['a', value, relay, id] : relay ? ['a', value, relay] : ['a', value]);
    } else {
      const id = value.toLowerCase();
      const pk = extra && isHex64(extra) ? extra.toLowerCase() : '';
      out.push(pk ? ['e', id, relay, pk] : relay ? ['e', id, relay] : ['e', id]);
    }
  }
  return out;
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
    // Keep the wrapping `a` coordinate when the row was already an address membership
    // and the user pasted a bare event id / nevent into the display field.
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
    // Keep the wrapping `a` coordinate when the row was already an address membership.
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
