/**
 * Feed public API — implementation lives under `src/lib/feed/`.
 * Keep this barrel stable for routes and tests.
 */

export {
  NOTIFICATION_LOOKBACK_OPTIONS,
  DEFAULT_NOTIFICATION_LOOKBACK,
  feedSinceFromLookback,
  feedLookbackIsWider,
  isNotificationLookbackId,
  parseNotificationLookback,
  notificationLookbackSeconds,
  type NotificationLookbackId
} from './feed/lookback';

export {
  FEED_POST_KINDS,
  FEED_FILTER_KINDS,
  NOTIFICATION_KINDS,
  isFeedRepost,
  isTopLevelWebComment,
  isOriginalPost,
  isFeedReplyRow,
  isRepliesTimelineEvent,
  isNotificationForViewer
} from './feed/taxonomy';

export {
  CORE_FEED_TABS,
  OPTIONAL_BUILTIN_FEED_TABS,
  BUILTIN_FEED_TABS,
  DEFAULT_FEED_TAB_ORDER,
  normalizeFeedKinds,
  encodeKindFeedTab,
  isKindFeedTab,
  feedTabKinds,
  feedTabKind,
  isFeedTab,
  isCoreFeedTab,
  isOptionalBuiltinFeedTab,
  isRemovableFeedTab,
  parseFeedTab,
  normalizeFeedTabCustomName,
  feedTabLabel,
  parseFeedAuthorParam,
  type BuiltinFeedTab,
  type CoreFeedTab,
  type OptionalBuiltinFeedTab,
  type FeedTab
} from './feed/tabs';

export {
  feedRelayGroups,
  socialAskFilters,
  type FeedRelayGroups
} from './feed/relay-plan';

export {
  keepFeedPosts,
  mergeFeedPosts,
  collectNewFeedEvents,
  feedEventsWatermark,
  feedFetchKey,
  createFeedListState,
  resetForTab,
  beginLookbackChange,
  beginRelayEpochChange,
  ingestFeedList,
  admitPendingVisible,
  markFeedListSettled,
  type FeedListState
} from './feed/list-store';

export { applyFeedView, applyFeedScope, type FeedViewOpts } from './feed/view';

export {
  feedFollowAuthors,
  recallFeedPosts,
  loadFeed,
  recallFollowsFeed,
  loadFollowsFeed,
  recallKindFeed,
  loadKindFeed,
  recallFeedWithReplies,
  loadFeedWithReplies,
  recallAuthorFeedWithReplies,
  recallAuthorFeedPosts,
  loadAuthorFeedWithReplies,
  loadAuthorFeed,
  notificationRelays,
  recallNotifications,
  loadNotifications,
  recallForFeedSource,
  loadForFeedSource
} from './feed/sources';

export {
  startFeedListLoad,
  startFeedQuietPoll,
  admitFeedPendingVisible,
  feedControllerFetchKey
} from './feed/controller';

export {
  fetchFeedEvent,
  feedThreadPointer,
  feedThreadPointerFromId,
  isFeedInteractionEvent,
  feedInteractionTargetPointer,
  feedThreadWarmSeed,
  feedThreadRootPointer,
  parseFeedKindParam,
  applyFeedListFilters,
  feedThreadPath,
  feedThreadPathFromId,
  feedListPath,
  feedAuthorRepliesPath,
  decodeFeedThreadTarget,
  decodeFeedPointer,
  fetchFeedThreadTarget,
  feedThreadTargetKey,
  eventMatchesThreadTarget,
  parseFeedThreadParam,
  parseFeedThreadTarget,
  type FeedListOpts,
  type FeedThreadTarget
} from './feed/paths';
