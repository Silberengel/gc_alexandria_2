/**
 * On-demand local seeds for Douay + reading plans.
 * Loaded only when the user opens a matching edition — never on boot.
 */
import type { Event } from 'nostr-tools';
import { KIND } from '../constants';
import {
  cacheGetPublicationStreamSnapshot,
  cachePutMany,
  cachePutPublicationStream
} from './cache';
import { rememberEvents } from './event-memory';
import { eventAddress, firstTag, ingestEvent } from './verify';

const MANIFEST_URL = '/seeds/manifest.json';
const BATCH = 400;
const YIELD_MS = 0;

export type SeedManifest = {
  version: number;
  /** Unix seconds. Included in seed URLs so a re-export is not stuck in cache. */
  generated_at?: number;
  editions?: Record<
    string,
    { address?: string; d?: string; shards: string[]; event_count?: number }
  >;
  plans?: Record<
    string,
    { address?: string; d?: string; shards: string[]; depends_on?: string[] }
  >;
};

/** edition address / d → manifest.version already ingested this session */
const loaded = new Map<string, number>();
let manifestPromise: Promise<SeedManifest | null> | null = null;

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, YIELD_MS));
}

async function loadManifest(signal?: AbortSignal): Promise<SeedManifest | null> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        const res = await fetch(MANIFEST_URL, { signal });
        if (!res.ok) return null;
        return (await res.json()) as SeedManifest;
      } catch {
        return null;
      }
    })();
  }
  try {
    return await manifestPromise;
  } catch {
    return null;
  }
}

/** Reset cached manifest (tests). */
export function resetSeedLoadState(): void {
  loaded.clear();
  manifestPromise = null;
}

function editionKey(edition: Event): string {
  return eventAddress(edition).toLowerCase();
}

function matchSeedTarget(
  edition: Event,
  manifest: SeedManifest
): { kind: 'edition' | 'plan'; id: string } | null {
  const d = (firstTag(edition, 'd') ?? '').trim();
  const addr = eventAddress(edition).toLowerCase();

  for (const [id, row] of Object.entries(manifest.editions ?? {})) {
    if ((row.d && row.d === d) || (row.address && row.address.toLowerCase() === addr)) {
      return { kind: 'edition', id };
    }
  }
  for (const [id, row] of Object.entries(manifest.plans ?? {})) {
    if ((row.d && row.d === d) || (row.address && row.address.toLowerCase() === addr)) {
      return { kind: 'plan', id };
    }
  }
  return null;
}

function seedUrl(path: string, manifest: SeedManifest): string {
  const base = path.startsWith('/') ? path : `/seeds/${path}`;
  const stamp = manifest.generated_at ?? manifest.version;
  return `${base}?v=${manifest.version}.${stamp}`;
}

function eventFromLine(line: string): Event | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return ingestEvent(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/**
 * Read a seed response as it arrives. Verse text starts well before a shard
 * ends, so the reader can paint while the rest of the file is still downloading
 * into the HTTP / service-worker cache.
 */
async function streamJsonl(
  res: Response,
  signal: AbortSignal | undefined,
  onBatch?: (batch: Event[]) => void
): Promise<Event[]> {
  const accepted: Event[] = [];
  const batch: Event[] = [];

  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const chunk = batch.splice(0, batch.length);
    rememberEvents(chunk);
    void cachePutMany(chunk);
    onBatch?.(chunk);
    accepted.push(...chunk);
    await yieldToUi();
  };

  const takeLine = async (line: string): Promise<void> => {
    const event = eventFromLine(line);
    if (!event) return;
    batch.push(event);
    if (batch.length >= BATCH) await flush();
  };

  if (!res.body) {
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      if (signal?.aborted) break;
      await takeLine(line);
    }
    await flush();
    return accepted;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      buf += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        await takeLine(line);
        if (signal?.aborted) break;
        nl = buf.indexOf('\n');
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!signal?.aborted && buf.trim()) await takeLine(buf);
  await flush();
  return accepted;
}

function openSeed(path: string, manifest: SeedManifest, signal?: AbortSignal): Promise<Response | null> {
  return fetch(seedUrl(path, manifest), { signal })
    .then((res) => (res.ok ? res : null))
    .catch(() => null);
}

/**
 * If this edition is Douay or a known reading plan, fetch the scoped seed shards,
 * ingest them, and persist a complete publication-stream snapshot for the opened edition.
 * Returns the events that belong to the opened edition's stream (all ingested for that load),
 * or null when this edition has no seed (caller continues to Mercury/relays).
 */
export async function loadSeedsForEdition(
  edition: Event,
  opts?: { signal?: AbortSignal; onBatch?: (batch: Event[]) => void }
): Promise<Event[] | null> {
  const signal = opts?.signal;
  const onBatch = opts?.onBatch;
  const manifest = await loadManifest(signal);
  if (!manifest || signal?.aborted) return null;

  const target = matchSeedTarget(edition, manifest);
  if (!target) return null;

  const key = editionKey(edition);
  const editionAddr = eventAddress(edition);
  if (loaded.get(key) === manifest.version) {
    const snap = await cacheGetPublicationStreamSnapshot(editionAddr);
    const ready =
      snap.complete && snap.events.some((event) => event.kind !== KIND.PUBLICATION);
    if (ready) {
      rememberEvents(snap.events);
      onBatch?.(snap.events);
      return snap.events;
    }
    // The file cache can still serve a retry when the parsed snapshot missed.
    loaded.delete(key);
  }

  const openedPaths: string[] = [];
  /** Verse shards that also belong in the Douay snapshot, not only this plan. */
  const dependencyByAddress = new Map<string, string[]>();
  if (target.kind === 'edition') {
    const row = manifest.editions?.[target.id];
    if (!row?.shards?.length) return null;
    openedPaths.push(...row.shards);
  } else {
    const row = manifest.plans?.[target.id];
    if (!row?.shards?.length) return null;
    openedPaths.push(...row.shards);
    for (const dep of row.depends_on ?? []) {
      const editionRow = manifest.editions?.[dep];
      if (!editionRow?.shards?.length || !editionRow.address) continue;
      dependencyByAddress.set(editionRow.address, editionRow.shards);
      openedPaths.push(...editionRow.shards);
    }
  }

  // One shard ahead, so the next file is already downloading while this one is parsed.
  const inflight: Promise<Response | null>[] = [];
  const start = (index: number): void => {
    const path = openedPaths[index];
    if (path) inflight[index] = openSeed(path, manifest, signal);
  };
  start(0);
  start(1);

  const all: Event[] = [];
  const dependencyEvents = new Map<string, Event[]>();
  let missingShard = false;
  for (let i = 0; i < openedPaths.length; i += 1) {
    if (signal?.aborted) return all.length ? all : null;
    start(i + 2);
    const res = await inflight[i];
    if (!res) {
      missingShard = true;
      continue;
    }
    const events = await streamJsonl(res, signal, onBatch);
    all.push(...events);
    for (const [address, shards] of dependencyByAddress) {
      if (!shards.includes(openedPaths[i]!)) continue;
      const bucket = dependencyEvents.get(address) ?? [];
      bucket.push(...events);
      dependencyEvents.set(address, bucket);
    }
  }

  if (signal?.aborted) return all.length ? all : null;
  // A hole in the image should fall through to Mercury instead of a partial book.
  if (missingShard || !all.length) return null;

  // Parsed copy for the next open. The raw files stay in the HTTP / SW cache.
  await cachePutPublicationStream(editionAddr, all, { complete: true });
  for (const [address, events] of dependencyEvents) {
    if (events.some((event) => event.kind !== KIND.PUBLICATION)) {
      void cachePutPublicationStream(address, events, { complete: true });
    }
  }
  loaded.set(key, manifest.version);
  return all;
}
