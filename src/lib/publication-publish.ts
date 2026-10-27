/**
 * Public entry points for publishing NKBIP-01 publications (split tree or single event).
 */
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  MAX_LEAF_BYTES,
  flattenPublishOrder,
  parsePublicationAsciiDoc,
  type PublicationIndexDepth
} from './publication-asciidoc-split';
import {
  buildComposePartial,
  validateComposeForm,
  type ComposeFormState
} from './compose-build';
import { normalizeDTag } from './dtag';
import {
  buildNestedIndexPartial,
  buildRootPartial,
  buildSectionPartial
} from './publication-event-build';
import {
  publishAndVerifyEvents,
  retryPublicationEvents,
  type PublishFailure,
  type PublishPipelineItem,
  type PublishProgress
} from './publication-publish-pipeline';

export type {
  PublishFailure,
  PublishProgress,
  PublishPipelineItem,
  SplitPublishFailure,
  SplitPublishProgress
} from './publication-publish-pipeline';

export {
  publishAndVerifyEvents,
  retryPublicationEvents,
  retryPublicationSplitEvents,
  verifyEventOnRelays
} from './publication-publish-pipeline';

export type PublicationPublishSuccess = {
  ok: true;
  root: Event;
  events: Event[];
};

export type PublicationPublishResult = PublicationPublishSuccess | PublishFailure;

function failure(
  error: string,
  extra: Partial<PublishFailure> = {}
): PublishFailure {
  return {
    ok: false,
    error,
    missingDTags: [],
    events: [],
    missingEvents: [],
    ...extra
  };
}

function pickRootEvent(events: Event[], preferredD?: string): Event | undefined {
  // Same rule as publicationPublishRootFromEvents.
  const pubs = events.filter(
    (e) => e.kind === KIND.PUBLICATION && e.tags.some((t) => t[0] === 'd')
  );
  if (preferredD) {
    return pubs.find((e) => e.tags.some((t) => t[0] === 'd' && t[1] === preferredD));
  }
  return pubs[pubs.length - 1] ?? events[events.length - 1] ?? events[0];
}

/**
 * Publish the AsciiDoc split tree bottom-up, verify on relays, republish misses once.
 */
export async function publishPublicationSplit(opts: {
  source: string;
  maxIndexLevel: PublicationIndexDepth;
  form: ComposeFormState;
  /** Resume after a mid-batch sign failure without re-signing those keys. */
  alreadySigned?: Event[];
  onProgress?: (p: PublishProgress) => void;
}): Promise<PublicationPublishResult> {
  const title = opts.form.values.title?.trim() || 'Untitled';
  const rootD = opts.form.values.d?.trim() || normalizeDTag(title) || 'untitled';
  const parsed = parsePublicationAsciiDoc(opts.source, {
    rootTitle: title,
    rootDTag: rootD,
    maxIndexLevel: opts.maxIndexLevel
  });

  if (parsed.warnings.some((w) => w.code === 'empty_source')) {
    return failure('AsciiDoc source is empty.');
  }
  if (parsed.oversizeLeaves.length) {
    const names = parsed.oversizeLeaves.map((l) => l.title).join(', ');
    return failure(
      `Sections over ${MAX_LEAF_BYTES / 1024} KiB — apply Ideal split first: ${names}`
    );
  }
  if (!parsed.root.children.length) {
    return failure('Add at least one == chapter before publishing.');
  }

  const order = flattenPublishOrder(parsed.root);
  if (order.some((n) => !n.dTag.trim())) {
    return failure('Internal error: split tree is missing d-tags.');
  }
  const items: PublishPipelineItem[] = order.map((node) => ({
    // Key must match child.dTag — buildPartial resolves children via getSigned(dTag).
    key: node.dTag,
    label: node.title,
    buildPartial: (getSigned) => {
      const childEvents = node.children
        .map((c) => getSigned(c.dTag))
        .filter((e): e is Event => !!e);
      if (node.level === 0) return buildRootPartial(opts.form, node, childEvents);
      if (node.kind === KIND.SECTION) return buildSectionPartial(node);
      return buildNestedIndexPartial(node, childEvents);
    }
  }));

  const result = await publishAndVerifyEvents({
    items,
    alreadySigned: opts.alreadySigned,
    onProgress: opts.onProgress
  });
  if (!result.ok) return result;

  const root = pickRootEvent(result.events, parsed.root.dTag);
  if (!root) {
    // Pipeline already verified; do not offer Retry of the full batch.
    return failure(
      'Events verified on relays, but the root publication could not be resolved.',
      { events: result.events, missingEvents: [] }
    );
  }
  return { ok: true, root, events: result.events };
}

/**
 * Publish a single catalog-built 30040 (link mode) or 30041 through the shared
 * sign → publish → verify → republish pipeline.
 */
export async function publishPublicationEvent(opts: {
  form: ComposeFormState;
  onProgress?: (p: PublishProgress) => void;
}): Promise<PublicationPublishResult> {
  const kind = opts.form.kind;
  if (kind !== KIND.PUBLICATION && kind !== KIND.SECTION) {
    return failure('Only publication (30040) and section (30041) use this publisher.');
  }

  const gate = validateComposeForm(opts.form);
  if (!gate.ok) return failure(gate.error);

  const partial = buildComposePartial(opts.form);
  const dTag =
    opts.form.values.d?.trim() ||
    partial.tags.find((t) => t[0] === 'd')?.[1]?.trim() ||
    'untitled';
  const label =
    opts.form.values.title?.trim() ||
    partial.tags.find((t) => t[0] === 'title')?.[1]?.trim() ||
    (kind === KIND.SECTION ? 'Section' : 'Publication');

  const result = await publishAndVerifyEvents({
    items: [
      {
        key: dTag,
        label,
        buildPartial: () => partial
      }
    ],
    onProgress: opts.onProgress
  });
  if (!result.ok) return result;

  const root = result.events[0];
  if (!root) {
    return failure('Could not confirm the event on relays.', {
      events: result.events,
      missingEvents: result.events
    });
  }
  return { ok: true, root, events: result.events };
}
