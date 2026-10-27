import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { displayTitle } from './metadata';
import { kindDescription } from './kind-label';
import { memoryFindMetadata } from './nostr/event-memory';
import { peekProfileThumb } from './profile-cache';
import { parseKind0 } from './profile-fields';

export type SearchRefineFilters = {
  kind?: number | null;
  pubkey?: string | null;
  /** Inclusive local-day start (unix seconds). */
  since?: number | null;
  /** Inclusive local-day end (unix seconds). */
  until?: number | null;
};

export type SearchSortMode = 'best' | 'newest' | 'oldest' | 'title-asc' | 'title-desc';

/** Distinct kinds in the result set, sorted ascending. */
export function uniqueKinds(events: Event[]): number[] {
  const set = new Set<number>();
  for (const e of events) set.add(e.kind);
  return [...set].sort((a, b) => a - b);
}

/** Distinct author pubkeys, order of first appearance. */
export function uniquePubkeys(events: Event[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    const pk = e.pubkey.toLowerCase();
    if (seen.has(pk)) continue;
    seen.add(pk);
    out.push(pk);
  }
  return out;
}

export function filterSearchEvents(events: Event[], filters: SearchRefineFilters): Event[] {
  const kind = filters.kind;
  const pubkey = filters.pubkey?.trim().toLowerCase() || null;
  const since = filters.since ?? null;
  const until = filters.until ?? null;
  return events.filter((e) => {
    if (kind != null && e.kind !== kind) return false;
    if (pubkey && e.pubkey.toLowerCase() !== pubkey) return false;
    if (since != null && e.created_at < since) return false;
    if (until != null && e.created_at > until) return false;
    return true;
  });
}

export function sortSearchEvents(events: Event[], mode: SearchSortMode): Event[] {
  if (mode === 'best') return events;
  const copy = events.slice();
  if (mode === 'newest') {
    copy.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
    return copy;
  }
  if (mode === 'oldest') {
    copy.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
    return copy;
  }
  const titled = copy.map((e) => ({ e, t: displayTitle(e).toLocaleLowerCase() }));
  titled.sort((a, b) => {
    const cmp = a.t.localeCompare(b.t);
    if (cmp !== 0) return mode === 'title-asc' ? cmp : -cmp;
    return a.e.id.localeCompare(b.e.id);
  });
  return titled.map((row) => row.e);
}

/** Label for a refine publisher `<option>` — display name when warm, else truncated npub. */
export function pubkeyOptionLabel(pubkey: string): string {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return pubkey;
  const peek = peekProfileThumb(pk)?.name?.trim();
  if (peek) return peek;
  const meta = memoryFindMetadata(pk);
  if (meta) {
    const fields = parseKind0(meta);
    const name = fields.title?.trim() || fields.name?.trim() || fields.displayName?.trim();
    if (name) return name;
  }
  try {
    const npub = nip19.npubEncode(pk);
    return `${npub.slice(0, 12)}…${npub.slice(-4)}`;
  } catch {
    return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
  }
}

/** Local midnight unix for an `YYYY-MM-DD` date input (start of day). */
export function dateInputToSince(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

/** Local end-of-day unix for an `YYYY-MM-DD` date input. */
export function dateInputToUntil(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

export function kindOptionLabel(kind: number): string {
  return `${kind} · ${kindDescription(kind)}`;
}
