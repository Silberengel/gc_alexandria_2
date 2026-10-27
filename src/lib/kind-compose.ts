/**
 * Shared compose emit + validation from `@silberengel/kind-compose-catalog`.
 * Alexandria imports builders from here so tag shapes stay aligned with Imwald / NostrWiki.
 */
export {
  buildTagsForKind,
  buildKind0Content,
  parseKind0Json,
  buildHighlightSourceTags,
  highlightSourceRef,
  highlightSourceLabelFallback,
  buildHighlightBookSectionScopeTags,
  buildNip22TagsForTarget,
  buildPublicationTags,
  buildReadingQueueBookTags,
  buildDraftWrapTags,
  buildCheckpointTags,
  buildPrivateRelayTagRows,
  draftWrapAddress,
  parsePrivateRelayTags,
  validateCompose,
  validateEvent,
  validateRequired,
  getKind,
  composeKindsForApp,
  kindsWrittenBy,
  kindPickerLabel,
  fieldSpecs,
  composerFieldSpecs,
  readNip54Pointer,
  stripNip54ForkDeferTags,
  parseWikiMergeRequest,
  parseWikiMergeAcceptance,
  parseWikiRedirect,
  isDeferralPlaceholderContent,
} from '@silberengel/kind-compose-catalog';
export type {
  ComposeDraft,
  EmitContext,
  EventValidation,
  HighlightSourceRef,
  HighlightSourceEvent,
  Nip54Reference,
  WikiMergeAcceptance,
  WikiMergeRequest,
  WikiRedirect,
} from '@silberengel/kind-compose-catalog';

import {
  getKind,
  validateCompose,
  validateEvent,
} from '@silberengel/kind-compose-catalog';
import type { EventValidation } from '@silberengel/kind-compose-catalog';

/** Compose + wire gate used before sign. Unknown catalog kinds are skipped (same as Imwald). */
export function assertReadyToSign(partial: {
  kind: number;
  content: string;
  tags: string[][];
}): EventValidation {
  if (!getKind(partial.kind)) return { ok: true };

  if (partial.kind === 9802) {
    const context =
      partial.tags.find((t) => t[0] === 'context')?.[1] ?? '';
    const compose = validateCompose(partial.kind, {
      content: partial.content,
      values: { context },
      tags: partial.tags,
    });
    if (!compose.ok) return compose;
  }

  return validateEvent(partial);
}
