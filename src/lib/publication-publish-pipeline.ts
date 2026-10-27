/**
 * Shared sign → publish → verify → one-republish pipeline for publication events.
 */
import type { Event } from 'nostr-tools';
import { publishSigned, signUnsigned, consumeSignFailure } from './sign';
import { relayPool } from './nostr/pool';
import { documentStack, writeStack } from './nostr/selector';
import { rememberEvents } from './nostr/event-memory';
import type { ComposePartial } from './publication-event-build';

/** Relays used for verify — union of where we write and where the library indexes. */
export function publicationVerifyRelays(): string[] {
  return [...new Set([...writeStack(), ...documentStack()])];
}

export type PublishProgress = {
  phase: 'signing' | 'publishing' | 'verifying' | 'republishing' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
  missingDTags?: string[];
};

/** @deprecated Prefer {@link PublishProgress}. */
export type SplitPublishProgress = PublishProgress;

export type PublishFailure = {
  ok: false;
  error: string;
  missingDTags: string[];
  /** Signed events from the attempt (for Retry / continue). */
  events: Event[];
  missingEvents: Event[];
  /**
   * Mid-batch sign failure: pass `events` as `alreadySigned` on the next attempt.
   * Not set when verify missed or root resolution failed after a full sign.
   */
  canContinueSigning?: boolean;
};

/** @deprecated Prefer {@link PublishFailure}. */
export type SplitPublishFailure = PublishFailure;

export type PublishPipelineItem = {
  /** Stable key (usually d-tag) for progress / child lookup. */
  key: string;
  label: string;
  /**
   * Build the unsigned partial when this item’s turn arrives.
   * `getSigned` returns earlier items in this batch (bottom-up children).
   */
  buildPartial: (getSigned: (key: string) => Event | undefined) => ComposePartial;
};

/**
 * Confirm the event is present on at least one write or document relay.
 * Does not trust local memory/cache — requires a real relay round-trip.
 * Queries writeStack ∪ documentStack so outbox-accepted events verify even when
 * they are not yet on the library index set.
 */
export async function verifyEventOnRelays(event: Event): Promise<boolean> {
  const id = event.id.toLowerCase();
  const relays = publicationVerifyRelays();
  if (!relays.length) return false;
  try {
    const byId = await relayPool.query(relays, [{ ids: [id], limit: 1 }], 6_000);
    if (byId.some((e) => e.id.toLowerCase() === id)) return true;
  } catch {
    /* try address */
  }
  const d = event.tags.find((t) => t[0] === 'd')?.[1]?.trim();
  if (!d) return false;
  try {
    const byAddr = await relayPool.query(
      relays,
      [{ kinds: [event.kind], authors: [event.pubkey.toLowerCase()], '#d': [d], limit: 3 }],
      6_000
    );
    return byAddr.some((e) => e.id.toLowerCase() === id);
  } catch {
    return false;
  }
}

type WorkingItem = PublishPipelineItem & {
  signed?: Event;
  relayAccepted?: boolean;
  verified?: boolean;
};

function eventDTag(ev: Event): string | undefined {
  return ev.tags.find((t) => t[0] === 'd')?.[1]?.trim() || undefined;
}

/**
 * Sign and publish each item bottom-up, verify on relays, republish misses once.
 * Pass `alreadySigned` to resume after a mid-batch sign failure without re-signing
 * (and without minting duplicate replaceable events for keys already accepted).
 */
export async function publishAndVerifyEvents(opts: {
  items: PublishPipelineItem[];
  /** Previously signed events from an interrupted attempt, keyed by d-tag. */
  alreadySigned?: Event[];
  onProgress?: (p: PublishProgress) => void;
}): Promise<{ ok: true; events: Event[] } | PublishFailure> {
  const items: WorkingItem[] = opts.items.map((it) => ({ ...it }));
  const total = items.length;
  const signedByKey = new Map<string, Event>();
  for (const ev of opts.alreadySigned ?? []) {
    const d = eventDTag(ev);
    if (d) signedByKey.set(d, ev);
  }
  const getSigned = (key: string) => signedByKey.get(key);
  const report = (p: PublishProgress) => opts.onProgress?.(p);

  if (!total) {
    return {
      ok: false,
      error: 'Nothing to publish.',
      missingDTags: [],
      events: [],
      missingEvents: []
    };
  }

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const reused = signedByKey.get(item.key);
    if (reused) {
      report({
        phase: 'publishing',
        done: i,
        total,
        message: `Keeping signed “${item.label}”…`
      });
      item.signed = reused;
      item.relayAccepted = true;
      rememberEvents([reused]);
      continue;
    }
    report({
      phase: 'signing',
      done: i,
      total,
      message: `Signing “${item.label}”…`
    });
    const partial = item.buildPartial(getSigned);
    const signed = await signUnsigned(partial);
    if (!signed) {
      return {
        ok: false,
        error: consumeSignFailure() ?? `Could not sign “${item.label}”.`,
        missingDTags: [],
        events: [...signedByKey.values()],
        missingEvents: [],
        canContinueSigning: true
      };
    }
    report({
      phase: 'publishing',
      done: i,
      total,
      message: `Publishing “${item.label}”…`
    });
    item.signed = signed;
    item.relayAccepted = await publishSigned(signed);
    signedByKey.set(item.key, signed);
    rememberEvents([signed]);
  }

  report({ phase: 'verifying', done: 0, total, message: 'Verifying on relays…' });
  let missing: WorkingItem[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    report({
      phase: 'verifying',
      done: i + 1,
      total,
      message: `Verifying “${item.label}”…`
    });
    item.verified = item.signed ? await verifyEventOnRelays(item.signed) : false;
    if (!item.verified) missing.push(item);
  }

  if (missing.length) {
    report({
      phase: 'republishing',
      done: 0,
      total: missing.length,
      message: `Republishing ${missing.length} missing event(s)…`
    });
    for (let i = 0; i < missing.length; i += 1) {
      const item = missing[i]!;
      if (!item.signed) continue;
      report({
        phase: 'republishing',
        done: i,
        total: missing.length,
        message: `Republishing “${item.label}”…`
      });
      item.relayAccepted = await publishSigned(item.signed);
      item.verified = await verifyEventOnRelays(item.signed);
    }
    missing = items.filter((it) => !it.verified);
  }

  const allEvents = items.map((it) => it.signed!).filter(Boolean);
  const missingEvents = missing.map((it) => it.signed!).filter(Boolean);

  if (missing.length) {
    return {
      ok: false,
      error: `Could not confirm ${missing.length} event(s) on relays.`,
      missingDTags: missing.map((it) => it.key),
      events: allEvents,
      missingEvents
    };
  }

  report({
    phase: 'done',
    done: total,
    total,
    message: `Published and verified ${total} events.`
  });
  return { ok: true, events: allEvents };
}

/** Republish + re-verify previously signed events (Retry failed). */
export async function retryPublicationEvents(opts: {
  events: Event[];
  onProgress?: (p: PublishProgress) => void;
}): Promise<{ ok: true; events: Event[] } | PublishFailure> {
  const events = opts.events.filter((e) => e?.id);
  if (!events.length) {
    return { ok: false, error: 'Nothing to retry.', missingDTags: [], events: [], missingEvents: [] };
  }
  const report = (p: PublishProgress) => opts.onProgress?.(p);
  const missing: Event[] = [];

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]!;
    const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ev.id.slice(0, 8);
    report({
      phase: 'republishing',
      done: i,
      total: events.length,
      message: `Republishing “${d}”…`
    });
    await publishSigned(ev);
    report({
      phase: 'verifying',
      done: i + 1,
      total: events.length,
      message: `Verifying “${d}”…`
    });
    const ok = await verifyEventOnRelays(ev);
    if (!ok) missing.push(ev);
  }

  if (missing.length) {
    return {
      ok: false,
      error: `Still missing ${missing.length} event(s) on relays.`,
      missingDTags: missing.map((e) => e.tags.find((t) => t[0] === 'd')?.[1] ?? e.id.slice(0, 8)),
      events,
      missingEvents: missing
    };
  }

  report({
    phase: 'done',
    done: events.length,
    total: events.length,
    message: `Verified ${events.length} events on relays.`
  });
  return { ok: true, events };
}

/** @deprecated Prefer {@link retryPublicationEvents}. */
export const retryPublicationSplitEvents = retryPublicationEvents;
