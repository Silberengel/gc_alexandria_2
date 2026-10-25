import type { Event } from 'nostr-tools';
import { writable } from 'svelte/store';
import { KIND } from './constants';
import { dTagVariants, normalizeDTag } from './dtag';
import { cacheDeleteEvent } from './nostr/cache';
import { relayPool } from './nostr/pool';
import { documentStack, socialStack } from './nostr/selector';
import { eventAddress, firstTag } from './nostr/verify';

const HEX64 = /^[0-9a-f]{64}$/i;

/** Event ids tombstoned by a valid same-pubkey kind-5 `e` tag → required target pubkey. */
const deletedIds = new Map<string, string>();

/**
 * Replaceable/addressable coords tombstoned by a valid same-pubkey kind-5 `a` tag.
 * Value is the deletion's created_at — hide matching events with created_at <= that.
 */
const deletedAddrs = new Map<string, number>();

/**
 * Bumps whenever in-memory tombstones change. Subscribe in list UIs so
 * `$derived` re-runs `filterDeletedEvents` after a local delete.
 */
export const deletionRevision = writable(0);

function bumpDeletionRevision(): void {
  deletionRevision.update((n) => n + 1);
}

function normalizeAddr(raw: string): string | null {
  const parts = raw.trim().split(':');
  if (parts.length < 3) return null;
  const kind = Number(parts[0]);
  const pubkey = parts[1]?.toLowerCase();
  if (!Number.isFinite(kind) || !pubkey || !HEX64.test(pubkey)) return null;
  const d = parts.slice(2).join(':');
  const normalized = normalizeDTag(d) || d;
  return `${kind}:${pubkey}:${normalized}`;
}

function addrVariants(kind: number, pubkey: string, d: string): string[] {
  const pk = pubkey.toLowerCase();
  const variants = new Set<string>([d, ...dTagVariants(d), normalizeDTag(d)].filter(Boolean) as string[]);
  return [...variants].map((v) => `${kind}:${pk}:${normalizeDTag(v) || v}`);
}

/** Record one verified deletion request (same-pubkey targets only). */
export function rememberDeletion(deletion: Event): void {
  if (deletion.kind !== KIND.DELETION || !deletion.pubkey) return;
  const pk = deletion.pubkey.toLowerCase();
  let changed = false;

  for (const tag of deletion.tags) {
    if (tag[0] === 'e' && tag[1] && HEX64.test(tag[1])) {
      const id = tag[1].toLowerCase();
      // NIP-09: optional 4th position is the target pubkey hint.
      const hinted = tag[3]?.toLowerCase();
      if (hinted && !HEX64.test(hinted)) continue;
      if (hinted && hinted !== pk) continue;
      if (deletedIds.get(id) !== pk) {
        deletedIds.set(id, pk);
        changed = true;
      }
    }
    if (tag[0] === 'a' && tag[1]) {
      const addr = normalizeAddr(tag[1]);
      if (!addr) continue;
      const addrPk = addr.split(':')[1];
      if (addrPk !== pk) continue;
      const prev = deletedAddrs.get(addr);
      if (prev === undefined || deletion.created_at > prev) {
        deletedAddrs.set(addr, deletion.created_at);
        changed = true;
      }
    }
  }
  if (changed) bumpDeletionRevision();
}

export function rememberDeletions(events: Event[]): void {
  for (const event of events) rememberDeletion(event);
}

/**
 * After a local delete publish: record the kind-5 and always tombstone the
 * concrete target id (covers drafts that only emitted an `a` tag).
 */
export function rememberDeletedTarget(target: Event, deletion: Event): void {
  rememberDeletion(deletion);
  if (!target?.id || !target.pubkey || !deletion?.pubkey) return;
  const pk = deletion.pubkey.toLowerCase();
  if (target.pubkey.toLowerCase() !== pk) return;
  const id = target.id.toLowerCase();
  if (!HEX64.test(id)) return;
  if (deletedIds.get(id) === pk) return;
  deletedIds.set(id, pk);
  bumpDeletionRevision();
}

export function isEventDeleted(event: Event): boolean {
  if (!event?.id || !event.pubkey) return false;
  const requiredPk = deletedIds.get(event.id.toLowerCase());
  if (requiredPk && requiredPk === event.pubkey.toLowerCase()) return true;

  const d = firstTag(event, 'd');
  if (d == null) return false;
  const until = Math.max(
    0,
    ...addrVariants(event.kind, event.pubkey, d).map((a) => deletedAddrs.get(a) ?? 0)
  );
  return until > 0 && event.created_at <= until;
}

export function filterDeletedEvents<T extends Event>(events: T[]): T[] {
  return events.filter((e) => !isEventDeleted(e));
}

export async function sweepDeletions(): Promise<void> {
  const filters = [
    { kinds: [KIND.DELETION], limit: 500 },
    { kinds: [KIND.DELETION], '#k': [String(KIND.PUBLICATION)], limit: 200 },
    { kinds: [KIND.DELETION], '#k': [String(KIND.SECTION)], limit: 100 },
    { kinds: [KIND.DELETION], '#k': [String(KIND.WIKI)], limit: 100 },
    { kinds: [KIND.DELETION], '#k': [String(KIND.SPEC)], limit: 100 },
    { kinds: [KIND.DELETION], '#k': [String(KIND.RATING)], limit: 100 },
    { kinds: [KIND.DELETION], '#k': [String(KIND.LABEL)], limit: 100 }
  ];
  const [doc, social] = await Promise.all([
    relayPool.query(documentStack(), filters, 5000),
    relayPool.query(socialStack(), filters, 5000)
  ]);
  const byId = new Map<string, Event>();
  for (const event of [...doc, ...social]) {
    if (event?.id) byId.set(event.id.toLowerCase(), event);
  }
  rememberDeletions([...byId.values()]);

  const ids = [...deletedIds.keys()];
  await Promise.all(ids.map((id) => cacheDeleteEvent(id)));
}

/** Fetch kind-5s that target these events (by id or address) and remember them. */
export async function refreshDeletionsFor(events: Event[]): Promise<void> {
  const ids = [
    ...new Set(events.map((e) => e.id.toLowerCase()).filter((id) => HEX64.test(id)))
  ].slice(0, 40);
  const addrs = [
    ...new Set(
      events
        .map((e) => {
          try {
            return eventAddress(e);
          } catch {
            return '';
          }
        })
        .filter(Boolean)
    )
  ].slice(0, 40);
  if (!ids.length && !addrs.length) return;

  const filters = [
    ...(ids.length ? [{ kinds: [KIND.DELETION], '#e': ids, limit: 100 }] : []),
    ...(addrs.length ? [{ kinds: [KIND.DELETION], '#a': addrs, limit: 100 }] : [])
  ];
  const [doc, social] = await Promise.all([
    relayPool.query(documentStack(), filters, 3500),
    relayPool.query(socialStack(), filters, 3500)
  ]);
  const byId = new Map<string, Event>();
  for (const event of [...doc, ...social]) {
    if (event?.id) byId.set(event.id.toLowerCase(), event);
  }
  rememberDeletions([...byId.values()]);
  await Promise.all(
    [...byId.values()]
      .flatMap((del) =>
        del.tags.filter((t) => t[0] === 'e' && t[1] && HEX64.test(t[1])).map((t) => t[1]!.toLowerCase())
      )
      .map((id) => cacheDeleteEvent(id))
  );
}

export function scheduleDeletionSweep(): void {
  const run = () => {
    void sweepDeletions();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => setTimeout(run, 0));
  } else {
    setTimeout(run, 0);
  }
}

/** Test helper — clear in-memory tombstones. */
export function resetDeletionStateForTests(): void {
  deletedIds.clear();
  deletedAddrs.clear();
  deletionRevision.set(0);
}
