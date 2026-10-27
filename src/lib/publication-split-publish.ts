/**
 * @deprecated Import from `$lib/publication-publish` instead.
 * Compatibility re-exports for existing Compose / splitter imports.
 */
export {
  publishPublicationSplit,
  publishPublicationEvent,
  publishAndVerifyEvents,
  retryPublicationEvents,
  retryPublicationSplitEvents,
  verifyEventOnRelays,
  type PublicationPublishResult,
  type PublicationPublishSuccess,
  type PublishFailure,
  type PublishProgress,
  type PublishPipelineItem,
  type SplitPublishFailure,
  type SplitPublishProgress
} from './publication-publish';
