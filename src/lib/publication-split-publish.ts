/**
 * Bottom-up publish of a publication AsciiDoc split tree, with verify + republish.
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  MAX_LEAF_BYTES,
  flattenPublishOrder,
  parsePublicationAsciiDoc,
  type PublicationIndexDepth,
  type PublicationSplitNode
} from './publication-asciidoc-split';
import { buildComposePartial, type ComposeFormState } from './compose-build';
import { normalizeDTag } from './dtag';
import { withMarkupTag } from './markup';
import { withClientTag, publishSigned, signUnsigned, consumeSignFailure } from './sign';
import { relayPool } from './nostr/pool';
import { documentStack } from './nostr/selector';
import { rememberEvents } from './nostr/event-memory';

export type SplitPublishProgress = {
  phase: 'signing' | 'publishing' | 'verifying' | 'republishing' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
  missingDTags?: string[];
};

export type SplitPublishItem = {
  node: PublicationSplitNode;
  partial: { kind: number; content: string; tags: string[][] };
  signed?: Event;
  relayAccepted?: boolean;
  verified?: boolean;
};

export type SplitPublishFailure = {
  ok: false;
  error: string;
  missingDTags: string[];
  /** Signed events from the attempt (for Retry). */
  events: Event[];
  missingEvents: Event[];
};

function membershipATag(child: Event, relayHint = ''): string[] {
  const d = child.tags.find((t) => t[0] === 'd')?.[1]?.trim() ?? '';
  const coord = `${child.kind}:${child.pubkey.toLowerCase()}:${d}`;
  return ['a', coord, relayHint, child.id.toLowerCase()];
}

function stripSectionTags(tags: string[][]): string[][] {
  return tags.filter((t) => t[0] !== 'a' && t[0] !== 'e');
}

function ensureTitleD(tags: string[][], title: string, dTag: string): string[][] {
  const out = tags.filter((t) => t[0] !== 'title' && t[0] !== 'd');
  out.unshift(['d', dTag]);
  out.unshift(['title', title]);
  return out;
}

function buildSectionPartial(node: PublicationSplitNode): {
  kind: number;
  content: string;
  tags: string[][];
} {
  let tags: string[][] = [
    ['title', node.title],
    ['d', node.dTag]
  ];
  tags = withMarkupTag(tags, 'asciidoc');
  return {
    kind: KIND.SECTION,
    content: node.content,
    tags: withClientTag(tags)
  };
}

function buildNestedIndexPartial(
  node: PublicationSplitNode,
  childEvents: Event[]
): { kind: number; content: string; tags: string[][] } {
  const tags: string[][] = [
    ['title', node.title],
    ['d', node.dTag],
    ...childEvents.map((ev) => membershipATag(ev))
  ];
  return {
    kind: KIND.PUBLICATION,
    content: '',
    tags: withClientTag(tags)
  };
}

function buildRootPartial(
  form: ComposeFormState,
  root: PublicationSplitNode,
  childEvents: Event[]
): { kind: number; content: string; tags: string[][] } {
  const base = buildComposePartial({
    ...form,
    kind: KIND.PUBLICATION,
    content: '',
    values: { ...form.values, sections: '' }
  });
  let tags = stripSectionTags(base.tags);
  tags = ensureTitleD(tags, form.values.title?.trim() || root.title, root.dTag);
  for (const ev of childEvents) tags.push(membershipATag(ev));
  return { kind: KIND.PUBLICATION, content: '', tags: withClientTag(tags) };
}

/**
 * Confirm the event is present on at least one write/document relay.
 * Does not trust local memory/cache — plan requires a real relay round-trip.
 */
export async function verifyEventOnRelays(event: Event): Promise<boolean> {
  const id = event.id.toLowerCase();
  const relays = documentStack();
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

async function verifyItem(item: SplitPublishItem): Promise<boolean> {
  if (!item.signed) return false;
  // Publish ACK is necessary but not sufficient; still confirm via REQ.
  if (item.relayAccepted === false) {
    // Try verify anyway in case ACK raced, but do not short-circuit true.
  }
  return verifyEventOnRelays(item.signed);
}

/** Republish + re-verify previously signed events (Retry failed). */
export async function retryPublicationSplitEvents(opts: {
  events: Event[];
  onProgress?: (p: SplitPublishProgress) => void;
}): Promise<{ ok: true; events: Event[] } | SplitPublishFailure> {
  const events = opts.events.filter((e) => e?.id);
  if (!events.length) {
    return { ok: false, error: 'Nothing to retry.', missingDTags: [], events: [], missingEvents: [] };
  }
  const report = (p: SplitPublishProgress) => opts.onProgress?.(p);
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

/**
 * Publish the split tree bottom-up, verify each event on relays, republish misses once.
 */
export async function publishPublicationSplit(opts: {
  source: string;
  maxIndexLevel: PublicationIndexDepth;
  form: ComposeFormState;
  onProgress?: (p: SplitPublishProgress) => void;
}): Promise<{ ok: true; root: Event; events: Event[] } | SplitPublishFailure> {
  const title = opts.form.values.title?.trim() || 'Untitled';
  const rootD = opts.form.values.d?.trim() || normalizeDTag(title) || 'untitled';
  const parsed = parsePublicationAsciiDoc(opts.source, {
    rootTitle: title,
    rootDTag: rootD,
    maxIndexLevel: opts.maxIndexLevel
  });

  if (parsed.warnings.some((w) => w.code === 'empty_source')) {
    return {
      ok: false,
      error: 'AsciiDoc source is empty.',
      missingDTags: [],
      events: [],
      missingEvents: []
    };
  }
  if (parsed.oversizeLeaves.length) {
    const names = parsed.oversizeLeaves.map((l) => l.title).join(', ');
    return {
      ok: false,
      error: `Sections over ${MAX_LEAF_BYTES / 1024} KiB — apply Ideal split first: ${names}`,
      missingDTags: [],
      events: [],
      missingEvents: []
    };
  }
  if (!parsed.root.children.length) {
    return {
      ok: false,
      error: 'Add at least one == chapter before publishing.',
      missingDTags: [],
      events: [],
      missingEvents: []
    };
  }

  const order = flattenPublishOrder(parsed.root);
  const total = order.length;
  const items: SplitPublishItem[] = order.map((node) => ({
    node,
    partial: { kind: node.kind, content: '', tags: [] }
  }));

  const signedByD = new Map<string, Event>();
  const childEventsOf = (node: PublicationSplitNode): Event[] =>
    node.children.map((c) => signedByD.get(c.dTag)).filter((e): e is Event => !!e);

  const report = (p: SplitPublishProgress) => opts.onProgress?.(p);

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const node = item.node;
    report({
      phase: 'publishing',
      done: i,
      total,
      message: `Publishing ${node.kind} “${node.title}”…`
    });

    if (node.level === 0) {
      item.partial = buildRootPartial(opts.form, node, childEventsOf(node));
    } else if (node.kind === KIND.SECTION) {
      item.partial = buildSectionPartial(node);
    } else {
      item.partial = buildNestedIndexPartial(node, childEventsOf(node));
    }

    const signed = await signUnsigned(item.partial);
    if (!signed) {
      return {
        ok: false,
        error: consumeSignFailure() ?? `Could not sign “${node.title}”.`,
        missingDTags: [],
        events: [...signedByD.values()],
        missingEvents: []
      };
    }
    item.signed = signed;
    item.relayAccepted = await publishSigned(signed);
    signedByD.set(node.dTag, signed);
    rememberEvents([signed]);
  }

  report({ phase: 'verifying', done: 0, total, message: 'Verifying on relays…' });
  let missing: SplitPublishItem[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    report({
      phase: 'verifying',
      done: i + 1,
      total,
      message: `Verifying “${item.node.title}”…`
    });
    item.verified = await verifyItem(item);
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
        message: `Republishing “${item.node.title}”…`
      });
      item.relayAccepted = await publishSigned(item.signed);
      item.verified = await verifyEventOnRelays(item.signed);
    }
    missing = items.filter((it) => !it.verified);
  }

  const allEvents = items.map((it) => it.signed!).filter(Boolean);
  const rootEv = signedByD.get(parsed.root.dTag);
  const missingEvents = missing.map((it) => it.signed!).filter(Boolean);

  if (missing.length || !rootEv) {
    return {
      ok: false,
      error: `Could not confirm ${missing.length || 1} event(s) on relays.`,
      missingDTags: missing.map((it) => it.node.dTag),
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
  return { ok: true, root: rootEv, events: allEvents };
}
