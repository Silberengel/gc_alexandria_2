import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { isValidPubkey } from './nip85-trusted-assertions';
import { isNewerReplaceable } from './nostr/replaceable';
import { relayPool } from './nostr/pool';
import { socialStack } from './nostr/selector';

const FOF_MAX_FOLLOWINGS = 80;
const FOF_SET_CAP = 12_000;
const FOF_REFRESH_MS = 12 * 60 * 60 * 1000;

type CacheRow = { set: Set<string>; updatedAt: number };

const byViewer = new Map<string, CacheRow>();
const inFlight = new Map<string, Promise<void>>();

function pTags(event: Event): string[] {
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'p' && tag[1] && isValidPubkey(tag[1])) {
      out.push(tag[1].toLowerCase());
    }
  }
  return out;
}

/**
 * In-memory follows-of-follows (2-hop) set for grapevine soft-pass.
 * Built from kind-3 contact lists of the viewer's direct follows.
 */
export function getFollowsOfFollowsSet(viewerPubkey: string | null | undefined): ReadonlySet<string> {
  const viewer = viewerPubkey?.trim().toLowerCase();
  if (!viewer || !isValidPubkey(viewer)) return new Set();
  return byViewer.get(viewer)?.set ?? new Set();
}

export function resetFollowsOfFollows(viewerPubkey?: string | null): void {
  if (viewerPubkey) {
    byViewer.delete(viewerPubkey.trim().toLowerCase());
  } else {
    byViewer.clear();
  }
}

/** Ensure FoF is loaded (or refresh if stale). Safe to call often. */
export async function ensureFollowsOfFollows(
  viewerPubkey: string | null | undefined,
  followings: ReadonlySet<string> | readonly string[]
): Promise<ReadonlySet<string>> {
  const viewer = viewerPubkey?.trim().toLowerCase();
  if (!viewer || !isValidPubkey(viewer)) return new Set();

  const cached = byViewer.get(viewer);
  if (cached && Date.now() - cached.updatedAt < FOF_REFRESH_MS) {
    return cached.set;
  }

  const existing = inFlight.get(viewer);
  if (existing) {
    await existing;
    return byViewer.get(viewer)?.set ?? new Set();
  }

  const promise = rebuild(viewer, followings).finally(() => inFlight.delete(viewer));
  inFlight.set(viewer, promise);
  await promise;
  return byViewer.get(viewer)?.set ?? new Set();
}

async function rebuild(
  viewer: string,
  followings: ReadonlySet<string> | readonly string[]
): Promise<void> {
  const direct = [
    ...new Set(
      [...followings]
        .map((p) => p.trim().toLowerCase())
        .filter((p) => isValidPubkey(p) && p !== viewer)
    )
  ].slice(0, FOF_MAX_FOLLOWINGS);

  const out = new Set<string>();
  if (!direct.length) {
    byViewer.set(viewer, { set: out, updatedAt: Date.now() });
    return;
  }

  // Batch authors to keep REQ size reasonable.
  const batchSize = 20;
  for (let i = 0; i < direct.length && out.size < FOF_SET_CAP; i += batchSize) {
    const batch = direct.slice(i, i + batchSize);
    try {
      const events = await relayPool.query(
        socialStack(),
        [{ kinds: [KIND.CONTACT_LIST], authors: batch, limit: batch.length }],
        3500,
        2
      );
      const newest = new Map<string, Event>();
      for (const ev of events) {
        const pk = ev.pubkey.toLowerCase();
        const prev = newest.get(pk);
        if (!prev || isNewerReplaceable(ev, prev)) newest.set(pk, ev);
      }
      for (const ev of newest.values()) {
        for (const p of pTags(ev)) {
          if (p === viewer) continue;
          out.add(p);
          if (out.size >= FOF_SET_CAP) break;
        }
        if (out.size >= FOF_SET_CAP) break;
      }
    } catch {
      /* continue with next batch */
    }
  }

  for (const pk of direct) out.delete(pk);
  byViewer.set(viewer, { set: out, updatedAt: Date.now() });
}
