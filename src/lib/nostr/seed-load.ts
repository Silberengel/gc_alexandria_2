/**
 * On-demand local seeds for Douay + reading plans.
 * Loaded only when the user opens a matching edition — never on boot.
 */
import type { Event } from 'nostr-tools';
import { KIND } from '../constants';
import {
  cacheGetPublicationStreamSnapshot,
  cachePutPublicationStream
} from './cache';
import { rememberEvents } from './event-memory';
import { eventAddress, firstTag, ingestTrustedEvent } from './verify';

const MANIFEST_URL = '/seeds/manifest.json';
const BATCH = 250;
/** Let the UI breathe — 0ms still pegs a core verifying/parsing JSONL. */
const YIELD_MS = 16;
const LOG = '[alexandria:seeds]';

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

/** True when this edition is covered by /seeds (caller must not relay-warm it). */
export async function editionHasLocalSeeds(
  edition: Event,
  signal?: AbortSignal
): Promise<boolean> {
  const manifest = await loadManifest(signal);
  if (!manifest) return false;
  return matchSeedTarget(edition, manifest) != null;
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
    // Bundled seeds are trusted — skip secp verify (that was melting the CPU).
    return ingestTrustedEvent(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function snapshotReady(
  snap: { complete: boolean; events: Event[] },
  opts?: { allowIndexOnly?: boolean }
): boolean {
  if (!snap.complete || !snap.events.length) return false;
  if (opts?.allowIndexOnly) return true;
  return snap.events.some((event) => event.kind !== KIND.PUBLICATION);
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
    // Do not cachePutMany each batch — that is O(n) Cache Storage writes and
    // pegs the disk. The publication-stream snapshot at the end is enough.
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

async function streamShardPaths(
  paths: string[],
  manifest: SeedManifest,
  signal: AbortSignal | undefined,
  onBatch: ((batch: Event[]) => void) | undefined,
  label: string
): Promise<{ events: Event[]; missingShard: boolean }> {
  const inflight: Promise<Response | null>[] = [];
  const start = (index: number): void => {
    const path = paths[index];
    if (path) inflight[index] = openSeed(path, manifest, signal);
  };
  // Prefetch at most one shard ahead — two parallel parse pipes fought the fan.
  start(0);

  const all: Event[] = [];
  let missingShard = false;
  const t0 = performance.now();
  for (let i = 0; i < paths.length; i += 1) {
    if (signal?.aborted) break;
    start(i + 1);
    const path = paths[i]!;
    const res = await inflight[i];
    if (!res) {
      console.info(LOG, 'shard missing', { label, shard: i + 1, of: paths.length, path });
      missingShard = true;
      continue;
    }
    const events = await streamJsonl(res, signal, onBatch);
    all.push(...events);
    console.info(LOG, 'shard cached', {
      label,
      shard: i + 1,
      of: paths.length,
      path,
      events: events.length,
      total: all.length,
      ms: Math.round(performance.now() - t0)
    });
  }
  return { events: all, missingShard };
}

async function ensurePlanDependencies(
  dependsOn: string[],
  manifest: SeedManifest,
  signal: AbortSignal | undefined,
  onBatch: ((batch: Event[]) => void) | undefined,
  title: string,
  t0: number
): Promise<void> {
  for (const dep of dependsOn) {
    if (signal?.aborted) break;
    const editionRow = manifest.editions?.[dep];
    if (!editionRow?.shards?.length || !editionRow.address) continue;

    const depSnap = await cacheGetPublicationStreamSnapshot(editionRow.address);
    if (snapshotReady(depSnap)) {
      console.info(LOG, 'dependency cache hit', {
        title,
        dep,
        events: depSnap.events.length,
        ms: Math.round(performance.now() - t0)
      });
      rememberEvents(depSnap.events);
      onBatch?.(depSnap.events);
      continue;
    }

    console.info(LOG, 'dependency load start', {
      title,
      dep,
      shards: editionRow.shards.length
    });
    const { events: depEvents, missingShard } = await streamShardPaths(
      editionRow.shards,
      manifest,
      signal,
      onBatch,
      `${title} → ${dep}`
    );
    if (signal?.aborted) break;
    if (!missingShard && depEvents.length) {
      await cachePutPublicationStream(editionRow.address, depEvents, {
        complete: true,
        trusted: true
      });
    }
  }
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
  const title = firstTag(edition, 'title') ?? firstTag(edition, 'd') ?? edition.id.slice(0, 8);
  const t0 = performance.now();
  const manifest = await loadManifest(signal);
  if (!manifest || signal?.aborted) return null;

  const target = matchSeedTarget(edition, manifest);
  if (!target) return null;

  const key = editionKey(edition);
  const editionAddr = eventAddress(edition);

  // Prefer the parsed Cache Storage snapshot on every open — not only when this
  // tab already streamed shards (the in-memory `loaded` map dies on refresh).
  {
    const snap = await cacheGetPublicationStreamSnapshot(editionAddr);
    if (snapshotReady(snap, { allowIndexOnly: target.kind === 'plan' })) {
      loaded.set(key, manifest.version);
      console.info(LOG, 'cache hit', {
        title,
        kind: target.kind,
        id: target.id,
        events: snap.events.length,
        ms: Math.round(performance.now() - t0)
      });
      rememberEvents(snap.events);
      onBatch?.(snap.events);
      // Plan snapshot is indexes only — verses live in Douay; always hydrate deps.
      if (target.kind === 'plan') {
        const row = manifest.plans?.[target.id];
        if (row?.depends_on?.length) {
          await ensurePlanDependencies(row.depends_on, manifest, signal, onBatch, title, t0);
        }
      }
      return snap.events;
    }
    if (loaded.get(key) === manifest.version) {
      loaded.delete(key);
    }
  }

  if (target.kind === 'edition') {
    const row = manifest.editions?.[target.id];
    if (!row?.shards?.length) return null;

    console.info(LOG, 'background load start', {
      title,
      kind: target.kind,
      id: target.id,
      shards: row.shards.length
    });

    const { events, missingShard } = await streamShardPaths(
      row.shards,
      manifest,
      signal,
      onBatch,
      title
    );
    if (signal?.aborted) return events.length ? events : null;
    if (missingShard || !events.length) {
      console.info(LOG, 'incomplete — keeping partial memory, no relay warm', {
        title,
        missingShard,
        events: events.length,
        ms: Math.round(performance.now() - t0)
      });
      return events.length ? events : null;
    }
    await cachePutPublicationStream(editionAddr, events, { complete: true, trusted: true });
    loaded.set(key, manifest.version);
    console.info(LOG, 'background load done — snapshot in Cache Storage', {
      title,
      events: events.length,
      ms: Math.round(performance.now() - t0)
    });
    return events;
  }

  // Reading plan: plan shard is small; Douay verses come from a dependency snapshot or shards.
  const row = manifest.plans?.[target.id];
  if (!row?.shards?.length) return null;

  console.info(LOG, 'background load start', {
    title,
    kind: target.kind,
    id: target.id,
    shards: row.shards.length,
    dependsOn: row.depends_on ?? []
  });

  const { events: planEvents, missingShard: planMissing } = await streamShardPaths(
    row.shards,
    manifest,
    signal,
    onBatch,
    title
  );
  if (signal?.aborted) return planEvents.length ? planEvents : null;
  if (planMissing || !planEvents.length) {
    console.info(LOG, 'plan shard incomplete', {
      title,
      events: planEvents.length,
      ms: Math.round(performance.now() - t0)
    });
    return planEvents.length ? planEvents : null;
  }

  rememberEvents(planEvents);
  onBatch?.(planEvents);

  await ensurePlanDependencies(row.depends_on ?? [], manifest, signal, onBatch, title, t0);

  // Plan snapshot is day indexes; verses live in the Douay dependency snapshot.
  await cachePutPublicationStream(editionAddr, planEvents, {
    complete: true,
    trusted: true,
    forceComplete: true
  });
  loaded.set(key, manifest.version);
  console.info(LOG, 'background load done — plan snapshot ready', {
    title,
    events: planEvents.length,
    ms: Math.round(performance.now() - t0)
  });
  return planEvents;
}
