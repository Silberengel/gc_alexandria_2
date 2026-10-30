<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { link, location, push, querystring, replace } from 'svelte-spa-router';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import ProseGrammarField from '$lib/components/ProseGrammarField.svelte';
  import EventBody from '$lib/components/EventBody.svelte';
  import EditionHeader from '$lib/components/EditionHeader.svelte';
  import DetailsPanel from '$lib/components/DetailsPanel.svelte';
  import EventCard from '$lib/components/EventCard.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import DirectoryExplorer from '$lib/components/DirectoryExplorer.svelte';
  import ProfileMetadataCard from '$lib/components/ProfileMetadataCard.svelte';
  import WorkCommentsPanel from '$lib/components/WorkCommentsPanel.svelte';
  import LiveChatFeed from '$lib/components/LiveChatFeed.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import FeedBoosters from '$lib/components/FeedBoosters.svelte';
  import TipReceiptCard from '$lib/components/TipReceiptCard.svelte';
  import InteractivePollCard from '$lib/components/InteractivePollCard.svelte';
  import GitRepositoryCard from '$lib/components/GitRepositoryCard.svelte';
  import GitIssueCard from '$lib/components/GitIssueCard.svelte';
  import IssueRepoHeader from '$lib/components/IssueRepoHeader.svelte';
  import RepoIssuesPanel from '$lib/components/RepoIssuesPanel.svelte';
  import CalendarEventCard from '$lib/components/CalendarEventCard.svelte';
  import CopyPointerButton from '$lib/components/CopyPointerButton.svelte';
  import { appClientHeight, appOffsetTop, appScrollTo, appScrollY } from '$lib/app-scroll';
  import { KIND } from '$lib/constants';
  import { isNip53Kind, NIP53_KIND, parseLiveStream } from '$lib/nip53';
  import {
    collectLivePresence,
    LIVE_PRESENCE_REFRESH_MS,
    localRoomPresence,
    roomPresenceDraft
  } from '$lib/live-chat';
  import {
    proseHasShareTrackers,
    scrubClipboardTextPaste,
    scrubProseText,
    SHARE_TRACKER_WARNING
  } from '$lib/clean-url';
  import { isSignInFlight, publishComment, signAndPublish } from '$lib/sign';
  import { showNotice } from '$lib/stores/toast';
  import { articleHighlightDraft, commentDraft } from '$lib/drafts';
  import SelectionActionTray from '$lib/components/SelectionActionTray.svelte';
  import { attachReaderPenSelect } from '$lib/reader-pen-select';
  import { hasNonEmptySelection } from '$lib/pointer-activate';
  import {
    emptyWorkResponses,
    eventsPointingAtId,
    fetchWorkResponses,
    highlightsForEvent,
    type WorkResponses
  } from '$lib/comments';
  import { cropRenderedUrlsInText } from '$lib/crop-url';
  import { resolveReactionEmoji } from '$lib/emoji-content';
  import { filterMuted, muteState, type MuteState } from '$lib/mute';
  import { deletionRevision, filterDeletedEvents } from '$lib/deletions';
  import { liveChatShield } from '$lib/stores/live-chat-shield';
  import { eventPreview } from '$lib/event-preview';
  import { isAllowedMediaUrl } from '$lib/markup';
  import { uniqueMedia } from '$lib/media';
  import { eventKindDescription, kindDescription } from '$lib/kind-label';
  import { eventHref } from '$lib/listing-table';
  import { libraryDocumentPath } from '$lib/metadata';
  import { fetchById } from '$lib/nostr/fetch';
  import { eventAddress } from '$lib/nostr/verify';
  import {
    DEFAULT_LIKE_REACTION_CONTENT,
    DEFAULT_LIKE_REACTION_DISPLAY_EMOJI,
    isPositiveLikeContent
  } from '$lib/reactions';
  import { collapseFeedReposts, peekRepostTarget } from '$lib/repost';
  import {
    isMoneroTipEvent,
    parseZap,
    tipActorPubkey,
    tipNotificationText
  } from '$lib/zaps';
  import {
    collectNewFeedEvents,
    feedEventsWatermark,
    feedFollowAuthors,
    feedListPath,
    feedRelayGroups,
    FEED_FILTER_KINDS,
    feedTabKinds,
    feedTabLabel,
    eventMatchesThreadTarget,
    isKindFeedTab,
    isOptionalBuiltinFeedTab,
    isRemovableFeedTab,
    normalizeFeedKinds,
    OPTIONAL_BUILTIN_FEED_TABS,
    feedThreadPath,
    feedThreadPathFromId,
    feedThreadWarmSeed,
    fetchFeedThreadTarget,
    mergeFeedPosts,
    loadAuthorFeed,
    loadAuthorFeedWithReplies,
    loadFeed,
    loadFeedWithReplies,
    loadFollowsFeed,
    loadKindFeed,
    loadNotifications,
    NOTIFICATION_LOOKBACK_OPTIONS,
    notificationLookbackSeconds,
    applyFeedListFilters,
    parseFeedAuthorParam,
    parseFeedKindParam,
    parseNotificationLookback,
    parseFeedTab,
    parseFeedThreadParam,
    parseFeedThreadTarget,
    recallAuthorFeedPosts,
    recallAuthorFeedWithReplies,
    recallFeedPosts,
    recallFeedWithReplies,
    recallFollowsFeed,
    recallKindFeed,
    recallNotifications,
    isFeedTab,
    type FeedTab,
    type NotificationLookbackId
  } from '$lib/feed';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import { filterPageEvents } from '$lib/page-filter';
  import { feedTabOrder } from '$lib/stores/feed-tab-order';
  const feedTabLabels = feedTabOrder.labels;
  import { skipNextNavTrack } from '$lib/nav-history';
  import { takePendingNavEvent, warmNavEvent } from '$lib/nav-warm';
  import { memoryGetEvent, rememberEvents } from '$lib/nostr/event-memory';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { getSelectorContext, onSelectorContext } from '$lib/nostr/selector';
  import { inkMarginChipsFromEvents } from '$lib/ink-margin';
  import {
    mergeInkIntoHighlights,
    seedHighlightProfile,
    textHighlightsFromEvents
  } from '$lib/text-highlights';
  import DrawingEditor from '$lib/components/DrawingEditor.svelte';
  import {
    deleteThreadDraft,
    loadThreadDraft,
    quoteDraftScope,
    saveThreadDraft
  } from '$lib/comment-drafts';

  let { params: _params = {} }: { params?: Record<string, string> } = $props();
  let drawOpen = $state(false);
  let pendingImeta = $state<string[][]>([]);
  const feedNoteDraftScope = 'feed:note';
  let feedNoteHydrated = false;

  /** Open thread from `?thread=` (nevent / naddr / hex) — same `/feed` route. */
  const threadTarget = $derived(parseFeedThreadTarget($querystring));
  const pointer = $derived(threadTarget ? parseFeedThreadParam($querystring) : null);
  const signedIn = $derived(!!$session.pubkey);
  const feedQuery = $derived(new URLSearchParams($querystring ?? ''));
  const feedAuthor = $derived(parseFeedAuthorParam(feedQuery.get('author')));
  /** Raw `?tab=` — null/empty means “use the first strip tab”. */
  const feedTabParam = $derived(feedQuery.get('tab'));
  /** Kinds checked in the add-tab picker (multi-select). */
  let kindDraftSelected = $state<Record<number, boolean>>({});
  /** Extra kind numbers typed in the + picker (one row per string). */
  let kindDraftCustomRows = $state<string[]>(['']);
  let kindDraftName = $state('');
  let kindPickerOpen = $state(false);
  /** Tab awaiting remove confirmation (modal). */
  let tabPendingRemove = $state<FeedTab | null>(null);
  let kindPickerWrap = $state<HTMLElement | null>(null);
  /** Tab id under the pointer — never a visible-strip index (visibility can change mid-drag). */
  let dragFromTab = $state<FeedTab | null>(null);
  let dragOverTab = $state<FeedTab | null>(null);
  /** Suppress the synthetic click after a pointer reorder (or a pointer-handled tap). */
  let dragMoved = $state(false);
  /** Active tab-strip pointer gesture (HTML5 DnD does not work for touch/stylus). */
  let tabDragPointerId: number | null = null;
  let tabDragActive = $state(false);
  let tabDragStartX = 0;
  let tabDragStartY = 0;
  const TAB_DRAG_THRESHOLD_PX = 8;
  let metadataEvents = $state<Event[]>([]);
  /**
   * Stable feed-load deps. Raw `metadataEvents` / `$muteState` get new identities on every
   * kind-0 merge and would cancel in-flight list REQs forever ("Loading original posts…").
   */
  const followAuthorsKey = $derived(feedFollowAuthors(metadataEvents, $muteState).join('\n'));
  const hasFollows = $derived(followAuthorsKey.length > 0);
  /**
   * Author-scoped feed: Original / Replies only (even if the user hid them on
   * the home strip). Follows needs a signed-in contact list; Notifications needs
   * a session. While session metadata is still loading, keep Follows visible so
   * a deep link is not bounced before the contact list arrives.
   */
  const visibleFeedTabs = $derived.by(() => {
    if (feedAuthor) {
      const preferred = $feedTabOrder.filter((tab) => tab === 'original' || tab === 'replies');
      const missing = OPTIONAL_BUILTIN_FEED_TABS.filter((tab) => !preferred.includes(tab));
      return [...preferred, ...missing];
    }
    return $feedTabOrder.filter((tab) => {
      if (tab === 'notifications') return signedIn;
      if (tab === 'follows') return signedIn && (hasFollows || $session.loading);
      return true;
    });
  });
  /** Optional built-ins the user removed — offered again in the + picker. */
  const missingOptionalBuiltins = $derived(
    feedAuthor
      ? []
      : OPTIONAL_BUILTIN_FEED_TABS.filter((tab) => !$feedTabOrder.includes(tab))
  );
  const defaultFeedTab = $derived(visibleFeedTabs[0] ?? 'original');
  const feedTab = $derived.by(() => {
    if (feedTabParam == null || feedTabParam === '') return defaultFeedTab;
    const tab = parseFeedTab(feedTabParam);
    if (feedAuthor && (tab === 'notifications' || tab === 'follows' || isKindFeedTab(tab))) {
      return 'replies';
    }
    return tab;
  });
  const muteKey = $derived.by(() => {
    const m = $muteState;
    return [
      [...m.pubkeys].sort().join(','),
      [...m.eventIds].sort().join(','),
      [...m.hashtags].sort().join(','),
      [...m.words].sort().join(',')
    ].join('|');
  });
  const lede = $derived.by(() => {
    void $session.pubkey;
    void feedTab;
    void feedAuthor;
    if (feedAuthor) {
      return feedTab === 'replies'
        ? 'Original posts and replies from this reader.'
        : 'Original posts from this reader.';
    }
    const kinds = feedTabKinds(feedTab);
    if (kinds.length) {
      const label = kinds.length === 1 ? `kind ${kinds[0]}` : `kinds ${kinds.join('+')}`;
      return signedIn
        ? `Events of ${label} from your feed relays.`
        : `Events of ${label} from theforest.`;
    }
    if (feedTab === 'follows') {
      return signedIn
        ? 'Original posts from accounts you follow.'
        : 'Sign in to see posts from accounts you follow.';
    }
    if (feedTab === 'notifications') {
      return signedIn
        ? 'Replies, comments, reactions, boosts, highlights, quotes, and zaps that #p-tag you.'
        : 'Sign in to see responses to your posts.';
    }
    if (feedTab === 'replies') {
      if (!signedIn) return 'Original posts and their replies from theforest.';
      const follows = feedFollowAuthors(metadataEvents, $muteState).length
        ? ', plus notes from people you follow'
        : '';
      const { favorites, inbox } = getSelectorContext();
      if (!favorites.length && !inbox.length) {
        return `Original posts and replies from theforest${follows}.`;
      }
      return favorites.length
        ? `Original posts and replies from your favorite and inbox relays${follows}.`
        : `Original posts and replies from your inbox relays${follows}.`;
    }
    if (!signedIn) return 'Original posts from theforest.';
    const follows = feedFollowAuthors(metadataEvents, $muteState).length
      ? ', plus notes from people you follow'
      : '';
    const { favorites, inbox } = getSelectorContext();
    if (!favorites.length && !inbox.length) return `Original posts from theforest${follows}.`;
    return favorites.length
      ? `Original posts from your favorite and inbox relays${follows}.`
      : `Original posts from your inbox relays${follows}.`;
  });

  /**
   * Bare `/feed` → first strip tab. Hidden/invalid `?tab=` → same.
   * Wait out session loading before bouncing Follows away.
   * Only while still on `/feed` — `$querystring` is global, so leaving for Home
   * must not re-`replace` us back onto the feed.
   */
  $effect(() => {
    const path = ($location ?? '').split('?')[0] || '';
    if (path !== '/feed') return;
    if (pointer) return;
    const first = defaultFeedTab;
    if (feedTabParam == null || feedTabParam === '') {
      // Quiet rewrite — must not create a Back step of bare `/feed`.
      skipNextNavTrack();
      void replace(feedListPath(first, feedNavOpts({ author: feedAuthor })));
      return;
    }
    if (feedAuthor) return;
    if (feedTab === 'follows' && signedIn && $session.loading) return;
    if (visibleFeedTabs.includes(feedTab)) return;
    skipNextNavTrack();
    void replace(feedListPath(first, feedNavOpts()));
  });

  function setFeedTab(next: FeedTab): void {
    if (!visibleFeedTabs.includes(next)) return;
    if (next === feedTab) return;
    pendingFocusId = null;
    listRestorePending = false;
    listRestoreGen += 1;
    pendingNew = [];
    feedWatermark = 0;
    loadedTab = null;
    items = [];
    shown = {};
    boostTargets = {};
    boostFetchQueued = {};
    listSettled = false;
    listLoading = true;
    void replace(feedListPath(next, feedNavOpts({ author: feedAuthor })));
  }

  function reorderFeedTab(fromTab: FeedTab, toTab: FeedTab): void {
    if (fromTab === toTab) return;
    // Reorder in the persisted full order so hidden tabs (follows/notifications
    // when signed out) keep their slots; visible indices would mis-target those.
    const full = $feedTabOrder;
    const from = full.indexOf(fromTab);
    const to = full.indexOf(toTab);
    if (from >= 0 && to >= 0) feedTabOrder.reorder(from, to);
  }

  function tabUnderPoint(clientX: number, clientY: number): FeedTab | null {
    const hit = document.elementFromPoint(clientX, clientY);
    const el = hit?.closest?.('[data-feed-tab]');
    if (!(el instanceof HTMLElement)) return null;
    const raw = el.dataset.feedTab ?? '';
    return isFeedTab(raw) ? raw : null;
  }

  function clearTabDragListeners(): void {
    window.removeEventListener('pointermove', onTabPointerMove);
    window.removeEventListener('pointerup', onTabPointerUp);
    window.removeEventListener('pointercancel', onTabPointerCancel);
  }

  function endTabPointerGesture(selectIfTap: boolean): void {
    const fromTab = dragFromTab;
    const toTab = dragOverTab;
    const didDrag = tabDragActive;
    clearTabDragListeners();
    tabDragPointerId = null;
    tabDragActive = false;
    dragFromTab = null;
    dragOverTab = null;
    if (didDrag) {
      if (fromTab && toTab) reorderFeedTab(fromTab, toTab);
      // Swallow the follow-up click after a drag.
      dragMoved = true;
      queueMicrotask(() => {
        dragMoved = false;
      });
      return;
    }
    if (selectIfTap && fromTab) {
      setFeedTab(fromTab);
      // Stylus/touch often still synthesize a click — absorb it.
      dragMoved = true;
      queueMicrotask(() => {
        dragMoved = false;
      });
    }
  }

  function onTabPointerMove(e: PointerEvent): void {
    if (tabDragPointerId !== e.pointerId || dragFromTab == null) return;
    const dx = e.clientX - tabDragStartX;
    const dy = e.clientY - tabDragStartY;
    if (!tabDragActive) {
      if (dx * dx + dy * dy < TAB_DRAG_THRESHOLD_PX * TAB_DRAG_THRESHOLD_PX) return;
      tabDragActive = true;
      dragMoved = true;
    }
    // Required so touch/stylus keep delivering moves instead of scrolling.
    e.preventDefault();
    const over = tabUnderPoint(e.clientX, e.clientY);
    if (over && over !== dragOverTab) dragOverTab = over;
  }

  function onTabPointerUp(e: PointerEvent): void {
    if (tabDragPointerId !== e.pointerId) return;
    endTabPointerGesture(true);
  }

  function onTabPointerCancel(e: PointerEvent): void {
    if (tabDragPointerId !== e.pointerId) return;
    endTabPointerGesture(false);
  }

  function onTabPointerDown(tab: FeedTab, e: PointerEvent): void {
    if (pointer) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as Element | null)?.closest?.('.feed-tab-remove')) return;
    // One gesture at a time.
    if (tabDragPointerId != null) endTabPointerGesture(false);

    tabDragPointerId = e.pointerId;
    tabDragActive = false;
    tabDragStartX = e.clientX;
    tabDragStartY = e.clientY;
    dragFromTab = tab;
    dragOverTab = tab;
    dragMoved = false;

    // Capture on the tab so pen/touch keep tracking after leaving the hit box.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', onTabPointerMove, { passive: false });
    window.addEventListener('pointerup', onTabPointerUp);
    window.addEventListener('pointercancel', onTabPointerCancel);
  }

  function onTabClick(tab: FeedTab): void {
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    // Keyboard / non-pointer activation (pointer path selects on pointerup).
    setFeedTab(tab);
  }

  $effect(() => {
    return () => {
      if (tabDragPointerId != null) endTabPointerGesture(false);
    };
  });

  function parseCustomKindRow(raw: string): number | null {
    const t = raw.trim();
    if (!t || !/^\d+$/.test(t)) return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0) return null;
    return n;
  }

  const kindDraftKinds = $derived(
    normalizeFeedKinds([
      ...FEED_FILTER_KINDS.filter((kind) => kindDraftSelected[kind]),
      ...kindDraftCustomRows
        .map(parseCustomKindRow)
        .filter((kind): kind is number => kind != null)
    ])
  );

  const kindPickerOptions = $derived(
    FEED_FILTER_KINDS.map((kind) => ({
      kind,
      label: `${kind} · ${kindDescription(kind)}`
    }))
  );

  function toggleKindDraft(kind: number): void {
    kindDraftSelected = { ...kindDraftSelected, [kind]: !kindDraftSelected[kind] };
  }

  function toggleKindPicker(): void {
    kindPickerOpen = !kindPickerOpen;
    if (kindPickerOpen && !kindDraftCustomRows.length) kindDraftCustomRows = [''];
  }

  function addCustomKindRow(): void {
    kindDraftCustomRows = [...kindDraftCustomRows, ''];
  }

  function setCustomKindRow(index: number, value: string): void {
    kindDraftCustomRows = kindDraftCustomRows.map((row, i) => (i === index ? value : row));
  }

  function removeCustomKindRow(index: number): void {
    if (kindDraftCustomRows.length <= 1) {
      kindDraftCustomRows = [''];
      return;
    }
    kindDraftCustomRows = kindDraftCustomRows.filter((_, i) => i !== index);
  }

  function addKindTab(): void {
    const tab = feedTabOrder.addKinds(kindDraftKinds, kindDraftName);
    kindDraftSelected = {};
    kindDraftCustomRows = [''];
    kindDraftName = '';
    kindPickerOpen = false;
    if (tab) setFeedTab(tab);
  }

  function requestRemoveTab(tab: FeedTab, e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    if (!isRemovableFeedTab(tab)) return;
    // Author profiles always need Original / Replies; only hide them on the home strip.
    if (feedAuthor && isOptionalBuiltinFeedTab(tab)) return;
    tabPendingRemove = tab;
  }

  function cancelRemoveTab(): void {
    tabPendingRemove = null;
  }

  function confirmRemoveTab(): void {
    const tab = tabPendingRemove;
    tabPendingRemove = null;
    if (!tab || !isRemovableFeedTab(tab)) return;
    if (feedAuthor && isOptionalBuiltinFeedTab(tab)) return;
    const next = visibleFeedTabs.find((t) => t !== tab) ?? 'follows';
    const wasActive = feedTab === tab;
    feedTabOrder.remove(tab);
    if (wasActive) setFeedTab(next);
  }

  const tabPendingRemoveLabel = $derived(
    tabPendingRemove
      ? feedTabLabel(tabPendingRemove, $feedTabLabels[tabPendingRemove])
      : ''
  );

  function restoreOptionalBuiltin(tab: (typeof OPTIONAL_BUILTIN_FEED_TABS)[number]): void {
    const restored = feedTabOrder.addOptionalBuiltin(tab);
    kindPickerOpen = false;
    if (restored) setFeedTab(restored);
  }

  $effect(() => {
    if (!kindPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (kindPickerWrap && t && !kindPickerWrap.contains(t)) kindPickerOpen = false;
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  });

  $effect(() => {
    if (!tabPendingRemove) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelRemoveTab();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  /**
   * List filters live in the query string (`since` / `kind` / `q`) so refresh and
   * tab/thread navigation keep them. Lookback + kind are URL-derived; text uses a
   * local draft kept in sync both ways.
   */
  const feedLookback = $derived.by(() =>
    parseNotificationLookback(feedQuery.get('since'))
  );
  /** Empty string = all kinds; otherwise a kind number as decimal text. */
  const feedKindFilter = $derived.by(() => parseFeedKindParam(feedQuery.get('kind')));
  /** Seed from the current URL so refresh keeps `q` before effects run. */
  let feedTextFilter = $state(
    new URLSearchParams(get(querystring) ?? '').get('q') ?? ''
  );
  $effect(() => {
    const urlQ = feedQuery.get('q') ?? '';
    if (urlQ !== feedTextFilter) feedTextFilter = urlQ;
  });
  $effect(() => {
    const text = feedTextFilter;
    const q = new URLSearchParams($querystring ?? '');
    if ((q.get('q') ?? '') === text) return;
    applyFeedListFilters(q, {
      since: parseNotificationLookback(q.get('since')),
      kind: parseFeedKindParam(q.get('kind')),
      q: text
    });
    const qs = q.toString();
    void replace(qs ? `/feed?${qs}` : '/feed');
  });

  function feedNavOpts(extra: { author?: string | null } = {}) {
    return {
      author: extra.author !== undefined ? extra.author : feedAuthor,
      since: feedLookback,
      kind: feedKindFilter,
      q: feedTextFilter
    };
  }

  function setFeedLookback(next: NotificationLookbackId): void {
    const q = new URLSearchParams($querystring ?? '');
    applyFeedListFilters(q, {
      since: next,
      kind: feedKindFilter,
      q: feedTextFilter
    });
    const qs = q.toString();
    void replace(qs ? `/feed?${qs}` : '/feed');
  }

  function setFeedKindFilter(next: string): void {
    const q = new URLSearchParams($querystring ?? '');
    applyFeedListFilters(q, {
      since: feedLookback,
      kind: next,
      q: feedTextFilter
    });
    const qs = q.toString();
    void replace(qs ? `/feed?${qs}` : '/feed');
  }

  let items = $state<Event[]>([]);
  /** Lookback last fetched for the current tab — change → relay requery. */
  let fetchedLookback = $state<NotificationLookbackId | null>(null);

  const feedKindNumber = $derived.by(() => {
    const raw = feedKindFilter.trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  });
  const feedLookbackSeconds = $derived(notificationLookbackSeconds(feedLookback));
  const feedSinceUnix = $derived.by(() => {
    const seconds = feedLookbackSeconds;
    if (seconds == null) return null;
    return Math.floor(Date.now() / 1000) - seconds;
  });
  const feedListFiltered = $derived(
    !feedAuthor &&
      (feedLookback !== 'all' ||
        feedKindNumber != null ||
        Boolean(feedTextFilter.trim()))
  );

  function loadingMessageForTab(tab: FeedTab): string {
    if (tab === 'notifications') return 'Loading notifications…';
    if (tab === 'follows') return 'Loading follows…';
    if (tab === 'replies') return 'Loading posts and replies…';
    const kinds = feedTabKinds(tab);
    if (kinds.length === 1) return `Loading kind ${kinds[0]}…`;
    if (kinds.length) return `Loading kinds ${kinds.join('+')}…`;
    return 'Loading original posts…';
  }

  function emptyMessageForTab(tab: FeedTab): string {
    if (feedListFiltered && items.length) return 'No posts match this filter.';
    if (tab === 'notifications') return 'No notifications yet.';
    if (feedAuthor) {
      return tab === 'replies'
        ? 'No posts or replies from this reader yet.'
        : 'No original posts from this reader yet.';
    }
    if (tab === 'follows') {
      return signedIn ? 'No posts from follows yet.' : 'Sign in to see follows.';
    }
    if (tab === 'replies') return 'No posts or replies here yet.';
    const kinds = feedTabKinds(tab);
    if (kinds.length === 1) return `No kind ${kinds[0]} events here yet.`;
    if (kinds.length) return `No events for kinds ${kinds.join('+')} here yet.`;
    return 'No original posts here yet.';
  }

  /** Unmuted / undeleted / in-window rows — kind filter options come from these. */
  const feedScopeItems = $derived.by(() => {
    $deletionRevision;
    let base = filterDeletedEvents(
      filterMuted(
        feedAuthor
          ? items.filter((event) => event.pubkey.toLowerCase() === feedAuthor)
          : items,
        $muteState
      )
    );
    if (feedAuthor) return base;
    if (feedSinceUnix != null) {
      base = base.filter((event) => event.created_at >= feedSinceUnix);
    }
    return base;
  });

  const feedKindOptions = $derived.by(() => {
    const present = new Set<number>();
    for (const event of feedScopeItems) present.add(event.kind);
    // Keep the active selection listed even if the window momentarily has none.
    if (feedKindNumber != null) present.add(feedKindNumber);
    return [...present]
      .sort((a, b) => a - b)
      .map((kind) => ({
        kind,
        label: `${kind} · ${kindDescription(kind)}`
      }));
  });

  const visibleItems = $derived.by(() => {
    let base = feedScopeItems;
    if (feedAuthor) return base;
    if (feedKindNumber != null) {
      base = base.filter((event) => event.kind === feedKindNumber);
    }
    if (!feedTextFilter.trim()) return base;
    return filterPageEvents(base, feedTextFilter);
  });
  /** Reposts collapse onto the target event; boosters show as profile pics. */
  const feedRows = $derived(collapseFeedReposts(visibleItems));
  let noteDraft = $state('');
  let notePreviewing = $state(false);
  let notePosting = $state(false);
  let listLoading = $state(true);
  /** True only after a load finishes once the viewer's relay lists are in place. */
  let listSettled = $state(false);
  let listError = $state('');
  let feedRelays = $state(0);
  /** Last tab+author whose list is currently shown — wipe rows when the scope changes. */
  let loadedTab = $state<string | null>(null);
  /** Rows in view. Each one renders its body and embedded cards; the rest stay a preview. */
  let shown = $state<Record<string, true>>({});
  /** Resolved target events for collapsed boost-only rows (undefined = not fetched). */
  let boostTargets = $state<Record<string, Event | null>>({});
  /** Target ids already handed to fetchById (avoid re-queue on effect re-entry). */
  let boostFetchQueued = $state<Record<string, true>>({});
  /** Row to scroll into view after Return (same component instance — list never remounts). */
  let pendingFocusId: string | null = null;
  let savedListScrollY = 0;
  /** Non-reactive arm so restore runs once when `?thread=` clears (Return or back). */
  let listRestorePending = false;
  let listRestoreGen = 0;
  /** Newer posts held above the timeline until the user clicks New Events. */
  let pendingNew = $state<Event[]>([]);
  /** Max created_at already in the timeline (or last admit). */
  let feedWatermark = 0;

  function ingestFeedEvents(incoming: Event[], muted: MuteState): void {
    const next = filterMuted(incoming, muted);
    if (!next.length) return;
    // Keep list rows in session memory so thread opens can seed the OP without a relay round-trip.
    rememberEvents(next);
    const settled = untrack(() => listSettled);
    const current = untrack(() => items);
    if (!settled || !current.length) {
      // Merge (don't replace) so streaming batches don't reshuffle the viewport.
      items = mergeFeedPosts(current, next);
      if (items.length) feedWatermark = feedEventsWatermark(items);
      return;
    }
    pendingNew = collectNewFeedEvents(next, {
      shown: current,
      pending: untrack(() => pendingNew),
      watermark: feedWatermark || feedEventsWatermark(current)
    });
  }

  function admitNewEvents(): void {
    const fresh = untrack(() => pendingNew);
    if (!fresh.length) return;
    items = mergeFeedPosts(untrack(() => items), fresh);
    pendingNew = [];
    feedWatermark = feedEventsWatermark(items);
    appScrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }

  function watchRow(node: HTMLElement, id: string) {
    const key = id.toLowerCase();
    if (shown[key]) return { destroy() {} };
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        shown = { ...shown, [key]: true };
        io.disconnect();
      },
      { rootMargin: '600px' }
    );
    io.observe(node);
    return {
      destroy() {
        io.disconnect();
      }
    };
  }

  function clearNoteDraft(): void {
    noteDraft = '';
    pendingImeta = [];
    notePreviewing = false;
    const pubkey = $session.pubkey;
    if (pubkey) deleteThreadDraft(pubkey, feedNoteDraftScope);
  }

  /** Unsigned kind-1 for the feed compose Preview tab. */
  const notePreviewEvent = $derived.by((): Event => {
    const pk = $session.pubkey ?? '0'.repeat(64);
    return {
      id: '',
      sig: '',
      pubkey: pk,
      created_at: Math.floor(Date.now() / 1000),
      kind: KIND.TEXT_NOTE,
      content: scrubProseText(noteDraft),
      tags: pendingImeta.map((row) => [...row])
    };
  });

  $effect(() => {
    const pubkey = $session.pubkey;
    if (!pubkey || feedNoteHydrated) return;
    feedNoteHydrated = true;
    const saved = loadThreadDraft(pubkey, feedNoteDraftScope);
    if (!saved) return;
    if (!noteDraft.trim()) noteDraft = saved.text;
    if (!pendingImeta.length && saved.imetaTags.length) {
      pendingImeta = saved.imetaTags.map((row) => [...row]);
    }
  });

  $effect(() => {
    const pubkey = $session.pubkey;
    void noteDraft;
    void pendingImeta;
    if (!pubkey || !feedNoteHydrated) return;
    const t = setTimeout(() => {
      saveThreadDraft(pubkey, feedNoteDraftScope, {
        text: noteDraft,
        imetaTags: pendingImeta,
        asKind1Reply: false
      });
    }, 280);
    return () => clearTimeout(t);
  });

  function onNotePaste(event: ClipboardEvent): void {
    scrubClipboardTextPaste(event, (scrubbed, start, end) => {
      noteDraft = noteDraft.slice(0, start) + scrubbed + noteDraft.slice(end);
    });
  }

  function onDrawingComplete(result: {
    url: string;
    imeta: string[];
    alt: string;
  }): void {
    const url = result.url.trim();
    if (!url) return;
    const sep = noteDraft.trim() ? (noteDraft.endsWith('\n') ? '' : '\n') : '';
    noteDraft = `${noteDraft}${sep}${url}`;
    const next = [...pendingImeta];
    if (result.imeta.length) next.push(result.imeta);
    pendingImeta = next;
    showNotice('Drawing attached — post when ready.', true);
  }

  async function postNote(): Promise<void> {
    const content = scrubProseText(noteDraft).trim();
    if (!content || notePosting) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    noteDraft = content;
    notePosting = true;
    try {
      const tags = pendingImeta.map((row) => [...row]);
      const signed = await signAndPublish({
        kind: KIND.TEXT_NOTE,
        content,
        tags
      });
      if (!signed) return; // signAndPublish already toasted
      rememberEvents([signed]);
      clearNoteDraft();
      items = mergeFeedPosts(untrack(() => items), [signed]);
    } finally {
      notePosting = false;
    }
  }

  /**
   * Notes with imeta / bare media URLs need EventBody (not the text preview),
   * including caption+image posts — otherwise the feed shows the blurb and skips
   * the picture until (or unless) intersection fires.
   */
  function feedNeedsFullBody(item: Event): boolean {
    return uniqueMedia(item).some((m) => isAllowedMediaUrl(m.url));
  }

  function rowText(item: Event): string {
    if (item.kind === KIND.REACTION) {
      const face = item.content.trim() || DEFAULT_LIKE_REACTION_CONTENT;
      if (isPositiveLikeContent(face)) {
        return face === '' || face === DEFAULT_LIKE_REACTION_CONTENT
          ? DEFAULT_LIKE_REACTION_DISPLAY_EMOJI
          : face;
      }
      const resolved = resolveReactionEmoji(item);
      if (resolved?.unicode) return resolved.unicode;
      if (resolved?.url) return resolved.shortcode ? `:${resolved.shortcode}:` : face;
      if (resolved?.shortcode) return `:${resolved.shortcode}:`;
      return face;
    }
    const tipText = tipNotificationText(item);
    if (tipText) return tipText;
    const preview = eventPreview(item);
    const text =
      item.kind === KIND.TEXT_NOTE
        ? preview.body || preview.summary || 'Note'
        : preview.body
          ? `${preview.headline} — ${preview.body}`
          : preview.headline;
    return cropRenderedUrlsInText(text);
  }

  /** Resolve boosted note bodies for collapsed boost-only rows. */
  $effect(() => {
    const rows = feedRows;
    const pending: string[] = [];
    const seed: Record<string, Event | null> = {};
    const targets = untrack(() => boostTargets);
    const queued = untrack(() => boostFetchQueued);
    for (const row of rows) {
      if (row.type !== 'boost-only') continue;
      if (targets[row.targetId] !== undefined || queued[row.targetId]) continue;
      const fromBoost = peekRepostTarget(row.boosts[0]!);
      if (fromBoost) {
        seed[row.targetId] = fromBoost;
        continue;
      }
      pending.push(row.targetId);
    }
    if (Object.keys(seed).length) {
      untrack(() => {
        boostTargets = { ...boostTargets, ...seed };
      });
    }
    if (!pending.length) return;
    untrack(() => {
      boostFetchQueued = {
        ...boostFetchQueued,
        ...Object.fromEntries(pending.map((id) => [id, true as const]))
      };
    });
    let cancelled = false;
    void (async () => {
      for (const id of pending) {
        if (cancelled) return;
        const target = await fetchById(id);
        if (cancelled) return;
        untrack(() => {
          boostTargets = { ...boostTargets, [id]: target };
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  let event = $state<Event | null>(null);
  let threadLoading = $state(true);
  let socialLoading = $state(false);
  let responses = $state<WorkResponses>(emptyWorkResponses());
  /** Issues vs Comments under a NIP-34 repository thread. */
  let repoThreadTab = $state<'issues' | 'comments'>('issues');
  let threadArticlePane = $state<HTMLElement | undefined>();
  let threadSelDraft = $state<{ quote: string; context?: string } | null>(null);
  let keepThreadSelDraft = false;
  let markMode = $state(false);
  $effect(() => {
    const root = threadArticlePane;
    if (!root || typeof window === 'undefined') return;
    void markMode;
    return attachReaderPenSelect(root, { markMode: () => markMode });
  });
  let inkOpen = $state(false);
  let inkQuote = $state<string | null>(null);
  let notePromptOpen = $state(false);
  let notePromptText = $state('');
  let replyComposeOpen = $state(false);
  let replyDraftText = $state('');
  let selectionSheet = $state(false);

  const libraryKind = $derived(
    !!event &&
      (event.kind === KIND.LONG_FORM ||
        event.kind === KIND.PUBLICATION ||
        event.kind === KIND.WIKI ||
        event.kind === KIND.SPEC)
  );
  const fullPage = $derived(event && libraryKind ? libraryDocumentPath(event) : '');
  const mutedHighlights = $derived(filterMuted(responses.highlights, $muteState));
  const bodyHighlights = $derived(
    event
      ? mergeInkIntoHighlights(
          textHighlightsFromEvents(highlightsForEvent(mutedHighlights, event)),
          inkMarginChipsFromEvents(responses.thread)
        )
      : []
  );

  $effect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 720px)');
    const sync = () => {
      selectionSheet = mq.matches;
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });

  function threadContextFromSelection(sel: Selection | null, quote: string): string | undefined {
    try {
      const node = sel?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const block = el?.closest('p, li, blockquote, pre, div.paragraph, article');
      const full = block?.textContent?.trim();
      if (full && full !== quote && full.includes(quote)) return full.slice(0, 500);
    } catch {
      /* ignore */
    }
    return undefined;
  }

  function syncThreadSelection(): void {
    const sel = window.getSelection();
    const quote = sel?.toString().trim() ?? '';
    const holdDraft = keepThreadSelDraft || inkOpen || notePromptOpen || replyComposeOpen;
    if (!quote || !sel || !threadArticlePane) {
      if (!holdDraft) threadSelDraft = null;
      return;
    }
    const node = sel.anchorNode;
    if (!node || !threadArticlePane.contains(node)) {
      if (!holdDraft) threadSelDraft = null;
      return;
    }
    keepThreadSelDraft = false;
    threadSelDraft = { quote, context: threadContextFromSelection(sel, quote) };
  }

  $effect(() => {
    if (!pointer || !event || !threadArticlePane) {
      threadSelDraft = null;
      keepThreadSelDraft = false;
      return;
    }
    const onSel = () => syncThreadSelection();
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.sel-tray, .reader-sel-host, .reader-mini-dialog, .draw-overlay')) {
        keepThreadSelDraft = true;
      }
    };
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  });

  async function saveThreadHighlight(comment?: string): Promise<void> {
    if (!event || !threadSelDraft) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    const signed = await signAndPublish(
      articleHighlightDraft(event, threadSelDraft.quote, threadSelDraft.context, comment)
    );
    if (signed) {
      const mine = session
        .getMetadata()
        .find((e) => e.kind === KIND.METADATA && e.pubkey.toLowerCase() === signed.pubkey.toLowerCase());
      seedHighlightProfile(signed.pubkey, mine ?? null);
      responses = {
        ...responses,
        highlights: [signed, ...responses.highlights.filter((h) => h.id !== signed.id)]
      };
      clearThreadSelectionDraft('note', threadSelDraft.quote);
      threadSelDraft = null;
      notePromptOpen = false;
      notePromptText = '';
      window.getSelection()?.removeAllRanges();
    }
  }

  async function submitThreadQuoteReply(): Promise<void> {
    if (!event || !threadSelDraft) return;
    const text = replyDraftText.trim();
    if (!text) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    const quote = threadSelDraft.quote;
    const body = `> ${quote.replace(/\n/g, '\n> ')}\n\n${text}`;
    const signed = await publishComment(commentDraft(event, body));
    if (signed) {
      clearThreadSelectionDraft('reply', quote);
      responses = {
        ...responses,
        thread: [signed, ...responses.thread.filter((e) => e.id !== signed.id)]
      };
      replyComposeOpen = false;
      replyDraftText = '';
      threadSelDraft = null;
      window.getSelection()?.removeAllRanges();
    }
  }

  async function onThreadInkComplete(result: {
    url: string;
    imeta: string[];
  }): Promise<void> {
    const quote = inkQuote ?? threadSelDraft?.quote;
    if (!event || !quote) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    const body = `> ${quote.replace(/\n/g, '\n> ')}\n\n${result.url}`;
    const partial = commentDraft(event, body);
    const signed = await publishComment({ ...partial, tags: [...partial.tags, result.imeta] });
    if (signed) {
      responses = {
        ...responses,
        thread: [signed, ...responses.thread.filter((e) => e.id !== signed.id)]
      };
      inkOpen = false;
      inkQuote = null;
      threadSelDraft = null;
      keepThreadSelDraft = false;
      window.getSelection()?.removeAllRanges();
      // publishComment already toasts success.
    }
  }

  function openThreadInk(): void {
    if (!threadSelDraft) return;
    inkQuote = threadSelDraft.quote;
    keepThreadSelDraft = true;
    inkOpen = true;
  }

  const threadInkDraftScope = $derived(
    event && inkQuote
      ? `ink:${event.id.toLowerCase()}:${quoteDraftScope(inkQuote)}`
      : ''
  );

  function threadSelectionDraftScope(kind: 'reply' | 'note', quote: string): string {
    if (!event) return '';
    return `feed-${kind}:${event.id.toLowerCase()}:${quoteDraftScope(quote)}`;
  }

  function hydrateThreadSelectionDraft(kind: 'reply' | 'note', quote: string): void {
    const pubkey = $session.pubkey;
    const scope = threadSelectionDraftScope(kind, quote);
    if (!pubkey || !scope) return;
    const saved = loadThreadDraft(pubkey, scope);
    if (!saved?.text) return;
    if (kind === 'reply') replyDraftText = saved.text;
    else notePromptText = saved.text;
  }

  function persistThreadSelectionDraft(kind: 'reply' | 'note', quote: string, text: string): void {
    const pubkey = $session.pubkey;
    const scope = threadSelectionDraftScope(kind, quote);
    if (!pubkey || !scope) return;
    saveThreadDraft(pubkey, scope, {
      text,
      imetaTags: [],
      asKind1Reply: false
    });
  }

  function clearThreadSelectionDraft(kind: 'reply' | 'note', quote: string): void {
    const pubkey = $session.pubkey;
    const scope = threadSelectionDraftScope(kind, quote);
    if (!pubkey || !scope) return;
    deleteThreadDraft(pubkey, scope);
  }

  $effect(() => {
    if (!replyComposeOpen || !threadSelDraft) return;
    const quote = threadSelDraft.quote;
    const text = replyDraftText;
    const t = setTimeout(() => persistThreadSelectionDraft('reply', quote, text), 280);
    return () => clearTimeout(t);
  });

  $effect(() => {
    if (!notePromptOpen || !threadSelDraft) return;
    const quote = threadSelDraft.quote;
    const text = notePromptText;
    const t = setTimeout(() => persistThreadSelectionDraft('note', quote, text), 280);
    return () => clearTimeout(t);
  });
  /**
   * Kind 6 / 16 for the open thread OP.
   * Prefer list-row boosts for an instant strip, then merge relay responses.
   */
  const threadBoosts = $derived.by(() => {
    if (!event) return [] as Event[];
    const id = event.id.toLowerCase();
    const byId = new Map<string, Event>();
    for (const row of feedRows) {
      const boosts =
        row.type === 'event' && row.event.id.toLowerCase() === id
          ? row.boosts
          : row.type === 'boost-only' && row.targetId === id
            ? row.boosts
            : null;
      if (!boosts) continue;
      for (const boost of boosts) byId.set(boost.id.toLowerCase(), boost);
    }
    for (const boost of eventsPointingAtId(responses.boosts ?? [], id)) {
      byId.set(boost.id.toLowerCase(), boost);
    }
    return [...byId.values()];
  });
  /** Own kind-10312 while watching — merged for the avatar strip before relays echo it. */
  let selfPresence = $state<Event | null>(null);
  /** `${activityId}:${pubkey}` — publish once per room entry, not on every effect re-run. */
  let presenceRoomKey = '';
  const livePresence = $derived(
    event?.kind === KIND.LIVE_EVENT
      ? collectLivePresence(event, {
          ...responses,
          other: selfPresence
            ? [
                ...responses.other.filter(
                  (e) =>
                    !(
                      e.kind === KIND.ROOM_PRESENCE &&
                      e.pubkey.toLowerCase() === selfPresence!.pubkey.toLowerCase()
                    )
                ),
                selfPresence
              ]
            : responses.other
        })
      : []
  );
  /** Presence is shown on the live card — keep it out of the comments “other” list. */
  const panelResponses = $derived.by(() => {
    if (event?.kind !== KIND.LIVE_EVENT) return responses;
    return {
      ...responses,
      other: responses.other.filter((e) => e.kind !== KIND.ROOM_PRESENCE)
    };
  });
  const focusComment = $derived(
    (new URLSearchParams($querystring ?? '').get('comment') ?? '').trim().toLowerCase()
  );
  /** Last `?comment=` id we scrolled to in the open thread. */
  let commentFocusApplied = $state('');

  $effect(() => {
    if (!pointer || !event) return;
    const id = focusComment;
    if (!id) {
      commentFocusApplied = '';
      return;
    }
    // Wait for social responses so `comment-${id}` can mount.
    void responses;
    void socialLoading;
    void threadLoading;
    if (id === commentFocusApplied) return;
    let attempts = 40;
    let timer = 0;
    const tryScroll = () => {
      const el = document.getElementById(`comment-${id}`);
      if (el) {
        const top = Math.max(0, appOffsetTop(el) - Math.round(appClientHeight() / 3));
        appScrollTo({ top, left: 0, behavior: 'smooth' });
        commentFocusApplied = id;
        return;
      }
      if (attempts-- <= 0) return;
      timer = window.setTimeout(tryScroll, 100);
    };
    // After openThread's scroll-to-top microtask, then retry until the node exists.
    const start = window.setTimeout(() => requestAnimationFrame(tryScroll), 50);
    return () => {
      clearTimeout(start);
      clearTimeout(timer);
    };
  });

  function armListRestore(focusId: string): void {
    pendingFocusId = focusId.toLowerCase();
    savedListScrollY = appScrollY();
    listRestorePending = true;
    shown = { ...shown, [pendingFocusId]: true };
  }

  /** One-shot scroll restore after `?thread=` clears — never driven by reactive $state. */
  function runListRestore(): void {
    if (!listRestorePending) return;
    listRestorePending = false;
    const id = pendingFocusId;
    const y = savedListScrollY;
    pendingFocusId = null;
    const gen = ++listRestoreGen;
    const finish = () => {
      if (gen !== listRestoreGen) return;
      // List pane stays mounted (only `hidden`) so saved scrollY matches layout.
      appScrollTo({ top: y, left: 0, behavior: 'auto' });
      if (!id) return;
      const el = document.querySelector(`[data-feed-row="${id}"]`);
      if (!(el instanceof HTMLElement)) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < 8 || rect.bottom > window.innerHeight - 8) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    };
    // Double rAF: wait for the list pane to un-hide and lay out.
    requestAnimationFrame(() => {
      requestAnimationFrame(finish);
    });
  }

  /** Dedicated library page when one exists (e.g. publication rating → edition info). */
  function feedOpenPath(item: Event): string {
    const href = eventHref(item);
    if (href) return href.startsWith('#') ? href.slice(1) : href;
    return feedThreadPath(item, feedTab, feedNavOpts());
  }

  /** Stash the thread OP (not just the clicked row) for the thread pane seed. */
  function warmThreadOpen(item: Event): void {
    rememberEvents([item]);
    const seed = feedThreadWarmSeed(item);
    warmNavEvent(seed, item.id);
  }

  function openThreadForEvent(item: Event, e: MouseEvent, restoreId: string): void {
    const target = e.target;
    if (!(target instanceof Element)) return;
    // Stylus/text select in the preview must not navigate on lift.
    if (hasNonEmptySelection(target.closest('.feed-hit, .feed-row, article, li') ?? target)) return;
    /* Directory listing indicators: whole card opens the OP thread. */
    if (target.closest('.directory-explorer-header-only')) {
      armListRestore(restoreId);
      warmThreadOpen(item);
      // Push (not replace) so browser Back returns to the feed list.
      void push(feedOpenPath(item));
      queueMicrotask(() => appScrollTo({ top: 0, left: 0, behavior: 'auto' }));
      return;
    }
    if (
      target.closest(
        'a, button, input, textarea, video, audio, .generic-card, .note-card, .pub-card, .picture-card, .video-card, .result-card-wrap, .userbadge, .directory-explorer, .event-more-menu, .menu-panel'
      )
    ) {
      return;
    }
    armListRestore(restoreId);
    warmThreadOpen(item);
    const path = feedOpenPath(item);
    void push(path);
    // Reply deep-links (`?comment=`) scroll to the focused node; bare threads go to top.
    if (!path.includes('comment=')) {
      queueMicrotask(() => appScrollTo({ top: 0, left: 0, behavior: 'auto' }));
    }
  }

  function openThreadForTargetId(targetId: string, e: MouseEvent, warm?: Event | null): void {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest('a, button, input, textarea, video, audio, .userbadge')) return;
    armListRestore(targetId);
    if (warm) warmThreadOpen(warm);
    else {
      const fromMem = memoryGetEvent(targetId);
      if (fromMem) warmNavEvent(fromMem);
    }
    const path = warm
      ? feedThreadPath(warm, feedTab, feedNavOpts())
      : feedThreadPathFromId(targetId, feedTab, feedNavOpts());
    void push(path);
    if (!path.includes('comment=')) {
      queueMicrotask(() => appScrollTo({ top: 0, left: 0, behavior: 'auto' }));
    }
  }

  function openThreadLink(item: Event, restoreId = item.id): void {
    armListRestore(restoreId);
    warmThreadOpen(item);
    queueMicrotask(() => appScrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }

  $effect(() => {
    return session.metadata.subscribe((events) => {
      metadataEvents = events;
    });
  });

  $effect(() => {
    return onSelectorContext(() => {
      feedRelays += 1;
    });
  });

  $effect(() => {
    // Never wipe the in-memory timeline when only `?thread=` toggles.
    // Pause list REQs while a thread is open so comment fetches keep pool slots
    // (list load uses priority and was starving "Loading comments…").
    // Read deps first, then bail before any listLoading setup — otherwise opening
    // a thread falsely paints the feed as "Loading…".
    void feedRelays;
    void followAuthorsKey;
    void muteKey;
    const tab = feedTab;
    const author = feedAuthor;
    const lookback = feedLookback;
    const lookbackSec = notificationLookbackSeconds(lookback);
    const listKey = `${tab}:${author ?? ''}`;
    const pubkey = $session.pubkey;
    const sessionLoading = $session.loading;
    // Snapshot via untrack — identity churn on these must not re-subscribe the effect.
    const meta = untrack(() => metadataEvents);
    const muted = untrack(() => $muteState);
    const threadOpen = !!pointer;
    const prevFetched = untrack(() => fetchedLookback);
    const tabChanged = loadedTab !== listKey;
    // Author feeds ignore the lookback control; list feeds requery on any since change
    // (widen or narrow) so relay `since` always matches the dropdown.
    const lookbackChanged =
      !author && !tabChanged && prevFetched != null && prevFetched !== lookback;
    let cancelled = false;

    if (threadOpen) {
      return () => {
        cancelled = true;
      };
    }

    listError = '';

    if (tabChanged) {
      items = [];
      shown = {};
      boostTargets = {};
      boostFetchQueued = {};
      pendingNew = [];
      feedWatermark = 0;
      fetchedLookback = null;
      loadedTab = listKey;
      listLoading = true;
      listSettled = false;
    } else if (lookbackChanged) {
      // Keep current rows visible while the new window loads.
      listLoading = true;
      listSettled = false;
    } else if (!untrack(() => items.length) && !untrack(() => listSettled)) {
      listLoading = true;
    }

    if ((tab === 'notifications' || tab === 'follows') && !pubkey) {
      items = [];
      pendingNew = [];
      listLoading = false;
      listSettled = true;
      fetchedLookback = lookback;
      return;
    }

    if (pubkey && sessionLoading && !feedRelayGroups().personal.length && tab !== 'notifications') {
      const kinds = feedTabKinds(tab);
      const recall = author
        ? tab === 'replies'
          ? recallAuthorFeedWithReplies(author)
          : recallAuthorFeedPosts(author)
        : tab === 'follows'
          ? recallFollowsFeed(meta, muted)
          : kinds.length
            ? recallKindFeed(kinds)
            : tab === 'replies'
              ? recallFeedWithReplies()
              : recallFeedPosts();
      void recall.then((cached) => {
        if (cancelled || !cached.length) return;
        ingestFeedEvents(cached, muted);
        listLoading = false;
      });
      return () => {
        cancelled = true;
      };
    }

    // Already settled for this tab/window — quiet polling handles New Events.
    if (
      !tabChanged &&
      !lookbackChanged &&
      untrack(() => listSettled) &&
      untrack(() => items.length)
    ) {
      return () => {
        cancelled = true;
      };
    }

    let timer = 0;
    let resumeWait: (() => void) | null = null;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        resumeWait = resolve;
        timer = window.setTimeout(resolve, ms);
      });

    const loadForTab = (
      onCache: (cached: Event[]) => void
    ): Promise<Event[]> => {
      if (tab === 'notifications') {
        return loadNotifications(pubkey!, muted, onCache, lookbackSec);
      }
      if (author) {
        return tab === 'replies'
          ? loadAuthorFeedWithReplies(author, muted, onCache)
          : loadAuthorFeed(author, muted, onCache);
      }
      if (tab === 'follows') {
        return loadFollowsFeed(meta, muted, onCache, lookbackSec);
      }
      const kinds = feedTabKinds(tab);
      if (kinds.length) {
        return loadKindFeed(kinds, muted, onCache, lookbackSec);
      }
      if (tab === 'replies') {
        return loadFeedWithReplies(meta, muted, onCache, lookbackSec);
      }
      return loadFeed(meta, muted, onCache, lookbackSec);
    };

    const recallForTab = (): Promise<Event[]> => {
      if (tab === 'notifications' && pubkey) return recallNotifications(pubkey);
      if (author) {
        return tab === 'replies'
          ? recallAuthorFeedWithReplies(author)
          : recallAuthorFeedPosts(author);
      }
      if (tab === 'follows') return recallFollowsFeed(meta, muted);
      const kinds = feedTabKinds(tab);
      if (kinds.length) return recallKindFeed(kinds);
      if (tab === 'replies') return recallFeedWithReplies();
      return recallFeedPosts();
    };

    void recallForTab().then((cached) => {
      if (cancelled || !cached.length) return;
      ingestFeedEvents(cached, muted);
      listLoading = false;
    });

    const markSettled = (): void => {
      listLoading = false;
      listSettled = true;
      fetchedLookback = lookback;
      feedWatermark = Math.max(feedWatermark, feedEventsWatermark(items));
    };

    void (async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
        try {
          const events = await loadForTab((cached) => {
            if (cancelled || !cached.length) return;
            ingestFeedEvents(cached, muted);
            listLoading = false;
          });
          if (cancelled) return;
          ingestFeedEvents(events, muted);
          const listsMissing =
            tab !== 'notifications' && !!pubkey && !feedRelayGroups().personal.length;
          if (items.length && !listsMissing) {
            markSettled();
            return;
          }
          if (items.length) listLoading = false;
          if (tab === 'notifications' && items.length) {
            markSettled();
            return;
          }
        } catch (err: unknown) {
          if (cancelled) return;
          if (items.length) {
            markSettled();
            return;
          }
          listError = err instanceof Error ? err.message : 'Could not load the feed.';
          markSettled();
          return;
        }
        if (attempt < 3 && !cancelled) await wait(1200);
      }
      if (cancelled || items.length) {
        if (!cancelled) markSettled();
        return;
      }
      markSettled();
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      resumeWait?.();
    };
  });

  /** Quiet refresh: stage newer posts for the New Events control (never auto-insert). */
  $effect(() => {
    if (pointer || !listSettled) return;
    void followAuthorsKey;
    void muteKey;
    const tab = feedTab;
    const author = feedAuthor;
    const lookbackSec = notificationLookbackSeconds(feedLookback);
    const pubkey = $session.pubkey;
    const meta = untrack(() => metadataEvents);
    const muted = untrack(() => $muteState);
    if ((tab === 'notifications' || tab === 'follows') && !pubkey) return;

    let cancelled = false;
    const pull = async () => {
      try {
        let events: Event[] = [];
        if (tab === 'notifications' && pubkey) {
          events = await loadNotifications(pubkey, muted, undefined, lookbackSec);
        } else if (author) {
          events =
            tab === 'replies'
              ? await loadAuthorFeedWithReplies(author, muted)
              : await loadAuthorFeed(author, muted);
        } else if (tab === 'follows') {
          events = await loadFollowsFeed(meta, muted, undefined, lookbackSec);
        } else if (feedTabKinds(tab).length) {
          events = await loadKindFeed(feedTabKinds(tab), muted, undefined, lookbackSec);
        } else if (tab === 'replies') {
          events = await loadFeedWithReplies(meta, muted, undefined, lookbackSec);
        } else {
          events = await loadFeed(meta, muted, undefined, lookbackSec);
        }
        if (cancelled) return;
        ingestFeedEvents(events, muted);
      } catch {
        /* quiet */
      }
    };

    const first = window.setTimeout(() => void pull(), 15_000);
    const interval = window.setInterval(() => void pull(), 45_000);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  });

  $effect(() => {
    const target = threadTarget;
    void $session.pubkey;
    // Live chat lane respects Shield (blocked relays); re-query when it flips.
    void $liveChatShield;
    let cancelled = false;
    if (!target) {
      event = null;
      threadLoading = false;
      responses = emptyWorkResponses();
      repoThreadTab = 'issues';
      return;
    }
    responses = emptyWorkResponses();
    repoThreadTab = 'issues';
    socialLoading = false;
    const warm = takePendingNavEvent();
    // Prefer the pending click seed when it is the OP; otherwise fall back to
    // session memory (feed rows are remembered on ingest / warmThreadOpen).
    let seeded =
      warm && eventMatchesThreadTarget(warm, target)
        ? warm
        : target.type === 'id'
          ? memoryGetEvent(target.id)
          : null;
    if (!seeded && warm) {
      // Pending was often the reply/reaction row — keep it remembered for comment focus.
      rememberEvents([warm]);
      seeded =
        target.type === 'id'
          ? memoryGetEvent(target.id)
          : null;
    }
    event = seeded;
    threadLoading = !seeded;
    void (async () => {
      const found = seeded ?? (await fetchFeedThreadTarget(target));
      if (cancelled) return;
      event = found;
      threadLoading = false;
      if (!found) return;
      socialLoading = true;
      try {
        const hit = await fetchWorkResponses(found, 60, (cached) => {
          if (cancelled) return;
          responses = cached;
          socialLoading = false;
        });
        if (cancelled) return;
        responses = hit;
      } finally {
        if (!cancelled) socialLoading = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  /**
   * NIP-53: show the viewer in the room strip immediately; publish one kind 10312
   * when they enter, then again every {@link LIVE_PRESENCE_REFRESH_MS}.
   */
  $effect(() => {
    const activity = event;
    const pk = $session.pubkey;
    if (!activity || activity.kind !== KIND.LIVE_EVENT || !pk) {
      selfPresence = null;
      presenceRoomKey = '';
      return;
    }
    const roomKey = `${activity.id.toLowerCase()}:${pk.toLowerCase()}`;
    const relayHint = parseLiveStream(activity).relays[0] ?? '';
    // Paint before sign/publish — HMR and slow/rate-limited relays must not blank the strip.
    if (
      !selfPresence ||
      selfPresence.pubkey.toLowerCase() !== pk.toLowerCase() ||
      !selfPresence.tags.some((t) => t[0] === 'a' && t[1] === eventAddress(activity))
    ) {
      selfPresence = localRoomPresence(activity, pk, { relayHint });
    }

    let cancelled = false;
    let timer = 0;
    let pulseInFlight = false;

    const pulse = async () => {
      if (cancelled || pulseInFlight) return;
      pulseInFlight = true;
      try {
        for (let i = 0; i < 15 && isSignInFlight(); i += 1) {
          await new Promise((r) => setTimeout(r, 200));
          if (cancelled) return;
        }
        if (isSignInFlight()) return;
        const signed = await signAndPublish(roomPresenceDraft(activity, { relayHint }), {
          quiet: true
        });
        if (cancelled || !signed) return;
        selfPresence = signed;
      } catch {
        /* quiet — local strip presence remains */
      } finally {
        pulseInFlight = false;
      }
    };

    const entered = presenceRoomKey !== roomKey;
    if (entered) {
      presenceRoomKey = roomKey;
      void pulse();
    }
    timer = window.setInterval(() => void pulse(), LIVE_PRESENCE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      // Keep selfPresence / presenceRoomKey across same-room effect re-runs (HMR, refetch).
    };
  });

  /**
   * When `?thread=` clears (Return or history.back), restore list scroll once.
   * Restore flags are non-reactive so clearing them cannot cancel the rAF (the
   * old $state pendingFocusId loop was fighting itself and the viewport).
   */
  $effect(() => {
    if (pointer) return;
    runListRestore();
  });
</script>

<main class="shell reading-body feed-page">
  {#if pointer}
    <div class="feed-thread-pane">
      {#if threadLoading}
        <LoadingHint message="Opening this thread…" />
      {:else if event}
        {#if isNip53Kind(event.kind) && event.kind !== NIP53_KIND.LIVE_CHAT}
          <EventCard {event} asCard presence={livePresence} />
          <DetailsPanel {event} appHandlers={panelResponses.appHandlers ?? []} />
        {:else if event.kind === KIND.METADATA}
          <article class="card reading-body feed-profile-meta-thread">
            <ProfileMetadataCard {event} showMenu={false} />
            <FeedBoosters boosts={threadBoosts} targetId={event.id} />
            <DetailsPanel {event} appHandlers={panelResponses.appHandlers ?? []} />
          </article>
        {:else if event.kind === KIND.DIRECTORY}
          <article class="card reading-body feed-directory-thread">
            <FeedBoosters boosts={threadBoosts} targetId={event.id} />
            <DirectoryExplorer {event} />
            <DetailsPanel {event} appHandlers={panelResponses.appHandlers ?? []} />
          </article>
        {:else if event.kind === KIND.GIT_REPO}
          <article class="card reading-body feed-git-repo-thread">
            <FeedBoosters boosts={threadBoosts} targetId={event.id} />
            <GitRepositoryCard {event} showMenu={false} />
            <DetailsPanel {event} appHandlers={panelResponses.appHandlers ?? []} />
          </article>
        {:else if event.kind === KIND.ISSUE}
          <article class="card reading-body" class:mark-mode={markMode} bind:this={threadArticlePane}>
            <FeedBoosters boosts={threadBoosts} targetId={event.id} />
            <IssueRepoHeader {event} />
            <EventBody {event} quotes={bodyHighlights} />
            <DetailsPanel {event} appHandlers={panelResponses.appHandlers ?? []} />
          </article>
        {:else if event.kind === KIND.CALENDAR_DATE || event.kind === KIND.CALENDAR_TIME}
          <article class="card reading-body feed-calendar-thread">
            <FeedBoosters boosts={threadBoosts} targetId={event.id} />
            <CalendarEventCard {event} showMenu={false} />
            {#if event.tags.some((t) => t[0] === 'summary' && (t[1] ?? '').trim()) && event.content.trim()}
              <EventBody {event} quotes={bodyHighlights} />
            {/if}
            <DetailsPanel {event} appHandlers={panelResponses.appHandlers ?? []} />
          </article>
        {:else}
          <article class="card reading-body" class:mark-mode={markMode} bind:this={threadArticlePane}>
            <FeedBoosters boosts={threadBoosts} targetId={event.id} />
            {#if libraryKind}
              <EditionHeader {event} />
            {:else}
              <header class="thread-head">
                <UserBadge pubkey={event.pubkey} />
                <time
                  class="thread-time muted"
                  datetime={new Date(event.created_at * 1000).toISOString()}
                  title={formatAbsoluteTime(event.created_at)}
                >{formatRelativeTime(event.created_at)}</time>
                <span class="feed-kind muted">{eventKindDescription(event)}</span>
              </header>
            {/if}
            {#if event.kind === KIND.POLL}
              <InteractivePollCard {event} />
            {:else}
              <EventBody {event} quotes={bodyHighlights} />
            {/if}
            <DetailsPanel {event} appHandlers={panelResponses.appHandlers ?? []} />
          </article>
          {#if threadSelDraft && !inkOpen && !notePromptOpen && !replyComposeOpen}
            {@const selDraft = threadSelDraft}
            <div class="reader-sel-host" class:sheet={selectionSheet}>
              <SelectionActionTray
                quote={selDraft.quote}
                sheet={selectionSheet}
                {markMode}
                onMarkMode={(on) => (markMode = on)}
                onHighlight={() => void saveThreadHighlight()}
                onHighlightNote={() => {
                  keepThreadSelDraft = true;
                  notePromptText = '';
                  hydrateThreadSelectionDraft('note', selDraft.quote);
                  notePromptOpen = true;
                }}
                onReply={() => {
                  keepThreadSelDraft = true;
                  replyDraftText = '';
                  hydrateThreadSelectionDraft('reply', selDraft.quote);
                  replyComposeOpen = true;
                }}
                onInk={openThreadInk}
                onDismiss={() => {
                  threadSelDraft = null;
                  keepThreadSelDraft = false;
                  window.getSelection()?.removeAllRanges();
                }}
              />
            </div>
          {/if}
          {#if notePromptOpen && threadSelDraft}
            <div class="reader-mini-dialog" role="dialog" aria-label="Highlight note">
              <label>
                Note on highlight
                <ProseGrammarField rows={3} bind:value={notePromptText} placeholder="Your note…" />
              </label>
              <div class="compose-actions">
                <button class="btn" type="button" onclick={() => (notePromptOpen = false)}>Cancel</button>
                <button
                  class="btn btn-primary"
                  type="button"
                  disabled={!notePromptText.trim()}
                  onclick={() => void saveThreadHighlight(notePromptText.trim())}
                  >Save highlight</button
                >
              </div>
            </div>
          {/if}
          {#if replyComposeOpen && threadSelDraft}
            <div class="reader-mini-dialog" role="dialog" aria-label="Reply with quote">
              <label>
                Reply
                <ProseGrammarField rows={3} bind:value={replyDraftText} placeholder="Your reply…" />
              </label>
              <div class="compose-actions">
                <button class="btn" type="button" onclick={() => (replyComposeOpen = false)}>Cancel</button>
                <button
                  class="btn btn-primary"
                  type="button"
                  disabled={!replyDraftText.trim()}
                  onclick={() => void submitThreadQuoteReply()}
                  >Post reply</button
                >
              </div>
            </div>
          {/if}
          <DrawingEditor
            bind:open={inkOpen}
            title="Ink note"
            initialPaper="sticky"
            draftScope={threadInkDraftScope}
            onComplete={(r) => void onThreadInkComplete(r)}
            onCancel={() => {
              inkOpen = false;
              inkQuote = null;
            }}
          />
        {/if}
        {#if fullPage}
          <p class="feed-full-page"><a href={`#${fullPage}`} use:link>Open the full page</a></p>
        {/if}
        <div class="card reading-width feed-comments">
          {#if event.kind === KIND.LIVE_EVENT}
            <LiveChatFeed
              target={event}
              responses={panelResponses}
              loading={socialLoading}
            />
          {:else if event.kind === KIND.GIT_REPO}
            <div class="feed-repo-tabs" role="tablist" aria-label="Repository responses">
              <button
                type="button"
                class="feed-repo-tab"
                class:active={repoThreadTab === 'issues'}
                role="tab"
                aria-selected={repoThreadTab === 'issues'}
                onclick={() => (repoThreadTab = 'issues')}
              >Issues</button>
              <button
                type="button"
                class="feed-repo-tab"
                class:active={repoThreadTab === 'comments'}
                role="tab"
                aria-selected={repoThreadTab === 'comments'}
                onclick={() => (repoThreadTab = 'comments')}
              >Comments</button>
            </div>
            {#if repoThreadTab === 'issues'}
              <RepoIssuesPanel repo={event} />
            {:else}
              <WorkCommentsPanel
                target={event}
                responses={panelResponses}
                focusId={focusComment}
                loading={socialLoading}
              />
            {/if}
          {:else}
            <WorkCommentsPanel
              target={event}
              responses={panelResponses}
              focusId={focusComment}
              loading={socialLoading}
            />
          {/if}
        </div>
      {:else}
        <p class="muted">This note was not on your relays.</p>
      {/if}
    </div>
  {/if}

  <!-- Keep the list mounted while a thread is open so Return can scroll to the same row. -->
  <div class="feed-list-pane" hidden={!!pointer} aria-hidden={pointer ? 'true' : undefined}>
    <header class="page-header">
      <h1>Feed</h1>
      <p class="page-lede muted">{lede}</p>
      {#if feedAuthor}
        <p class="feed-author-filter">
          <UserBadge pubkey={feedAuthor} />
          <a class="btn" href="#/feed?tab=replies" use:link>Clear author filter</a>
        </p>
      {/if}
    </header>
    <form
      class="compose feed-note-compose"
      onsubmit={(e) => {
        e.preventDefault();
        void postNote();
      }}
    >
      <ProseGrammarField
        id="feed-note-draft"
        label="Post a note"
        rows={3}
        bind:value={noteDraft}
        placeholder={signedIn ? 'Write a short note…' : 'Sign in to post a note'}
        disabled={notePosting || !signedIn}
        hideBody={notePreviewing}
        onPaste={onNotePaste}
      >
        {#snippet headActions()}
          {#if signedIn}
            <button
              class="btn feed-note-preview-btn"
              type="button"
              disabled={notePosting || (!notePreviewing && !noteDraft.trim() && !pendingImeta.length)}
              aria-pressed={notePreviewing}
              onclick={() => (notePreviewing = !notePreviewing)}
            >{notePreviewing ? 'Edit' : 'Preview'}</button>
          {/if}
        {/snippet}
      </ProseGrammarField>
      {#if notePreviewing}
        <div class="compose-preview feed-note-preview" aria-live="polite">
          {#if noteDraft.trim() || pendingImeta.length}
            {#key `${noteDraft}\0${pendingImeta.length}`}
              <EventBody event={notePreviewEvent} showEmbeds />
            {/key}
          {:else}
            <p class="muted">Nothing to preview yet.</p>
          {/if}
        </div>
      {/if}
      {#if proseHasShareTrackers(noteDraft)}
        <p class="feed-note-track-warn muted">{SHARE_TRACKER_WARNING}</p>
      {/if}
      <div class="compose-actions">
        {#if signedIn}
          <button
            class="btn"
            type="button"
            disabled={notePosting || notePreviewing}
            onclick={() => (drawOpen = true)}
          >Draw</button>
          <button
            class="btn btn-primary"
            type="submit"
            disabled={notePosting || !noteDraft.trim()}
          >{notePosting ? 'Posting…' : 'Post'}</button>
          <button
            class="btn"
            type="button"
            disabled={notePosting || !noteDraft}
            onclick={clearNoteDraft}
          >Clear</button>
        {:else}
          <button type="button" class="btn btn-primary" onclick={() => openLoginDialog()}
            >Sign in</button
          >
        {/if}
      </div>
    </form>
    <DrawingEditor
      bind:open={drawOpen}
      draftScope={`draw:${feedNoteDraftScope}`}
      onComplete={onDrawingComplete}
    />
    <div class="feed-tabs-row">
      <div class="feed-tabs" role="tablist" aria-label="Feed view">
        {#each visibleFeedTabs as tab (tab)}
          <button
            type="button"
            role="tab"
            class="feed-tab"
            class:active={feedTab === tab}
            class:feed-tab-dragging={dragFromTab === tab && tabDragActive}
            class:feed-tab-drop={dragOverTab === tab && dragFromTab !== null && dragFromTab !== tab && tabDragActive}
            data-feed-tab={tab}
            aria-selected={feedTab === tab}
            tabindex={pointer ? -1 : 0}
            title="Drag to reorder tabs"
            onpointerdown={(e) => onTabPointerDown(tab, e)}
            onclick={() => onTabClick(tab)}
          >
            <span class="feed-tab-label">{feedTabLabel(tab, $feedTabLabels[tab])}</span>
            {#if isRemovableFeedTab(tab) && !(feedAuthor && isOptionalBuiltinFeedTab(tab))}
              <span
                class="feed-tab-remove"
                role="presentation"
                title={isKindFeedTab(tab) ? 'Remove kind tab' : `Remove ${feedTabLabel(tab)}`}
                onpointerdown={(e) => e.stopPropagation()}
                onclick={(e) => requestRemoveTab(tab, e)}>×</span
              >
            {/if}
          </button>
        {/each}
      </div>
      {#if !feedAuthor}
        <div class="feed-kind-add" bind:this={kindPickerWrap}>
          <button
            class="btn feed-kind-add-btn"
            type="button"
            disabled={!!pointer}
            aria-expanded={kindPickerOpen}
            aria-haspopup="true"
            aria-label="Add feed tab"
            title="Add feed tab"
            onclick={toggleKindPicker}
          >+</button>
          {#if kindPickerOpen}
            <div class="feed-kind-picker" role="group" aria-label="Add a feed tab">
              {#if missingOptionalBuiltins.length}
                <div class="feed-kind-picker-restore-block">
                  <p class="feed-kind-picker-hint muted">Restore tab</p>
                  <ul class="feed-kind-picker-list feed-kind-picker-list-restore">
                    {#each missingOptionalBuiltins as tab (tab)}
                      <li>
                        <button
                          class="btn feed-kind-picker-restore"
                          type="button"
                          onclick={() => restoreOptionalBuiltin(tab)}
                        >{feedTabLabel(tab)}</button>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
              <div class="feed-kind-picker-kinds-block">
                <p class="feed-kind-picker-hint muted">Select kinds for a custom feed tab</p>
                <label class="feed-kind-picker-name">
                  <span class="muted">Tab name</span>
                  <input
                    class="feed-kind-picker-name-input"
                    type="text"
                    maxlength="40"
                    placeholder="Optional — e.g. Social"
                    bind:value={kindDraftName}
                    autocomplete="off"
                  />
                </label>
                <ul class="feed-kind-picker-list">
                  {#each kindPickerOptions as opt (opt.kind)}
                    <li>
                      <label class="feed-kind-picker-row">
                        <input
                          type="checkbox"
                          checked={!!kindDraftSelected[opt.kind]}
                          onchange={() => toggleKindDraft(opt.kind)}
                        />
                        <span>{opt.label}</span>
                      </label>
                    </li>
                  {/each}
                </ul>
                <div class="feed-kind-picker-custom">
                  <div class="feed-kind-picker-custom-head">
                    <span class="muted">Other kinds</span>
                    <button
                      type="button"
                      class="feed-kind-picker-row-btn"
                      onclick={addCustomKindRow}
                      aria-label="Add kind number"
                      title="Add kind number"
                    >+</button>
                  </div>
                  <p class="feed-kind-picker-hint muted">Any integer kind not listed above</p>
                  {#each kindDraftCustomRows as row, i (i)}
                    <div class="feed-kind-picker-custom-row">
                      <input
                        class="feed-kind-picker-name-input feed-kind-picker-kind-input"
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        placeholder="e.g. 31923"
                        value={row}
                        aria-label={`Custom kind ${i + 1}`}
                        autocomplete="off"
                        spellcheck="false"
                        oninput={(e) => setCustomKindRow(i, e.currentTarget.value)}
                      />
                      <button
                        type="button"
                        class="feed-kind-picker-row-btn"
                        onclick={() => removeCustomKindRow(i)}
                        aria-label={`Remove kind row ${i + 1}`}
                        title="Remove row"
                        disabled={kindDraftCustomRows.length <= 1 && !row.trim()}
                      >−</button>
                    </div>
                  {/each}
                </div>
              </div>
              <div class="feed-kind-picker-actions">
                <button
                  class="btn btn-primary"
                  type="button"
                  disabled={!kindDraftKinds.length}
                  onclick={addKindTab}
                >
                  {kindDraftKinds.length <= 1
                    ? 'Add kind tab'
                    : `Add tab (${kindDraftKinds.length} kinds)`}
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
    {#if !feedAuthor}
      <div class="feed-list-filters" role="group" aria-label="Feed filters">
        <label class="feed-filter-since">
          <span class="sr-only">Since</span>
          <select
            id="feed-filter-since"
            class="page-filter feed-filter-since-select"
            value={feedLookback}
            disabled={!!pointer}
            title="Since"
            aria-label="Since"
            onchange={(e) =>
              setFeedLookback(parseNotificationLookback(e.currentTarget.value))}
          >
            {#each NOTIFICATION_LOOKBACK_OPTIONS as opt (opt.id)}
              <option value={opt.id}>{opt.label}</option>
            {/each}
          </select>
        </label>
        <label class="feed-filter-kind">
          <span class="sr-only">Kind</span>
          <select
            id="feed-filter-kind"
            class="page-filter feed-filter-kind-select"
            value={feedKindFilter}
            disabled={!!pointer}
            title="Kind"
            aria-label="Kind"
            onchange={(e) => setFeedKindFilter(e.currentTarget.value)}
          >
            <option value="">All kinds</option>
            {#each feedKindOptions as opt (opt.kind)}
              <option value={String(opt.kind)}>{opt.label}</option>
            {/each}
          </select>
        </label>
        <PageFilter
          id="feed-filter-text"
          bind:value={feedTextFilter}
          placeholder="Filter posts…"
        />
      </div>
    {/if}
    {#if !visibleItems.length && listError}
      <p class="muted">{listError}</p>
    {:else if !visibleItems.length && !listSettled}
      <LoadingHint message={loadingMessageForTab(feedTab)} />
    {:else if !visibleItems.length}
      <p class="muted">{emptyMessageForTab(feedTab)}</p>
      {#if pendingNew.length}
        <p class="feed-new-wrap">
          <button type="button" class="btn feed-new-events" onclick={admitNewEvents}>
            New Events ({pendingNew.length})
          </button>
        </p>
      {/if}
    {:else}
      {#if pendingNew.length}
        <p class="feed-new-wrap">
          <button type="button" class="btn feed-new-events" onclick={admitNewEvents}>
            New Events ({pendingNew.length})
          </button>
        </p>
      {/if}
      <ul class="feed-list">
        {#each feedRows as row (row.type === 'event' ? row.event.id : `boost:${row.targetId}`)}
          {#if row.type === 'event'}
            {@const item = row.event}
            {@const reactionRow = item.kind === KIND.REACTION || item.kind === 17}
            {@const tipRow = !!(parseZap(item) || isMoneroTipEvent(item))}
            {@const tipOneline = tipRow && !shown[item.id.toLowerCase()]}
            {@const actorPubkey = tipRow ? tipActorPubkey(item) : item.pubkey}
            {@const threadHref = `#${feedOpenPath(item)}`}
            <li
              class="card feed-row"
              class:feed-row-oneline={reactionRow || tipOneline}
              data-feed-row={item.id.toLowerCase()}
              use:watchRow={item.id}
            >
              <div
                class="feed-hit"
                class:feed-hit-oneline={reactionRow || tipOneline}
                role="link"
                tabindex="0"
                onclick={(e) => openThreadForEvent(item, e, item.id)}
                onkeydown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  openThreadForEvent(item, e as unknown as MouseEvent, item.id);
                }}
              >
                <FeedBoosters boosts={row.boosts} targetId={item.id} />
                {#if item.kind === KIND.DIRECTORY}
                  <div class="feed-body feed-body-directory">
                    <DirectoryExplorer
                      event={item}
                      showMenu={feedTab === 'notifications'}
                      headerOnly
                    />
                  </div>
                {:else if item.kind === KIND.METADATA}
                  <div class="feed-body feed-body-profile">
                    <ProfileMetadataCard
                      event={item}
                      showMenu={feedTab === 'notifications'}
                      compact
                    />
                  </div>
                {:else if item.kind === KIND.LONG_FORM}
                  <div class="feed-body feed-body-card">
                    <PublicationCard
                      event={item}
                      showMenu={feedTab === 'notifications'}
                      enlargeOnClick={false}
                    />
                  </div>
                {:else if item.kind === KIND.POLL}
                  <div class="thread-head">
                    <UserBadge pubkey={actorPubkey} />
                    <a
                      class="thread-time muted"
                      href={threadHref}
                      use:link
                      title={formatAbsoluteTime(item.created_at)}
                      onclick={() => openThreadLink(item)}
                    >{formatRelativeTime(item.created_at)}</a>
                    <span class="feed-kind muted">{eventKindDescription(item)}</span>
                    {#if feedTab === 'notifications'}
                      <div class="thread-actions">
                        <CopyPointerButton event={item} class="thread-more feed-row-more" />
                      </div>
                    {/if}
                  </div>
                  <div class="feed-body">
                    <InteractivePollCard
                      event={item}
                      showControls={false}
                      voteHref={threadHref}
                      onVoteOpen={() => openThreadLink(item)}
                    />
                  </div>
                {:else if item.kind === KIND.GIT_REPO}
                  <div class="feed-body feed-body-card">
                    <GitRepositoryCard event={item} showMenu={feedTab === 'notifications'} />
                  </div>
                {:else if item.kind === KIND.ISSUE}
                  <div class="feed-body feed-body-card">
                    <GitIssueCard
                      event={item}
                      showMenu={feedTab === 'notifications'}
                      compact
                    />
                  </div>
                {:else if item.kind === KIND.CALENDAR_DATE || item.kind === KIND.CALENDAR_TIME}
                  <div class="feed-body feed-body-card">
                    <CalendarEventCard
                      event={item}
                      showMenu={feedTab === 'notifications'}
                    />
                  </div>
                {:else}
                  <div class="thread-head">
                    <UserBadge pubkey={actorPubkey} />
                    <a
                      class="thread-time muted"
                      href={threadHref}
                      use:link
                      title={formatAbsoluteTime(item.created_at)}
                      onclick={() => openThreadLink(item)}
                    >{formatRelativeTime(item.created_at)}</a>
                    {#if !reactionRow}
                      <span class="feed-kind muted">{eventKindDescription(item)}</span>
                    {/if}
                    {#if feedTab === 'notifications'}
                      <div class="thread-actions">
                        <CopyPointerButton event={item} class="thread-more feed-row-more" />
                      </div>
                    {/if}
                  </div>
                  <div class="feed-body">
                    {#if tipRow && (shown[item.id.toLowerCase()] || feedNeedsFullBody(item))}
                      <TipReceiptCard event={item} />
                    {:else if shown[item.id.toLowerCase()] || feedNeedsFullBody(item)}
                      <EventBody event={item} />
                    {:else}
                      <p class="feed-preview">{rowText(item)}</p>
                    {/if}
                  </div>
                {/if}
              </div>
            </li>
          {:else}
            {@const target = boostTargets[row.targetId]}
            {@const threadHref = `#${
              target
                ? feedThreadPath(target, feedTab, feedNavOpts())
                : feedThreadPathFromId(row.targetId, feedTab, feedNavOpts())
            }`}
            <li
              class="card feed-row feed-row-boost"
              data-feed-row={row.targetId}
              use:watchRow={row.targetId}
            >
              <div
                class="feed-hit"
                role="link"
                tabindex="0"
                onclick={(e) => openThreadForTargetId(row.targetId, e, target)}
                onkeydown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  openThreadForTargetId(row.targetId, e as unknown as MouseEvent, target);
                }}
              >
                <FeedBoosters boosts={row.boosts} targetId={row.targetId} />
                {#if target && target.kind === KIND.METADATA}
                  <div class="feed-body feed-body-profile">
                    <ProfileMetadataCard event={target} showMenu={false} compact />
                  </div>
                {:else if target && target.kind === KIND.DIRECTORY}
                  <div class="feed-body feed-body-directory">
                    <DirectoryExplorer event={target} showMenu={false} headerOnly />
                  </div>
                {:else if target && target.kind === KIND.LONG_FORM}
                  <div class="feed-body feed-body-card">
                    <PublicationCard event={target} showMenu={false} enlargeOnClick={false} />
                  </div>
                {:else if target && target.kind === KIND.POLL}
                  <div class="thread-head">
                    <UserBadge pubkey={target.pubkey} />
                    <a
                      class="thread-time muted"
                      href={threadHref}
                      use:link
                      title={formatAbsoluteTime(target.created_at)}
                      onclick={() => openThreadLink(target, row.targetId)}
                    >{formatRelativeTime(target.created_at)}</a>
                    <span class="feed-kind muted">{eventKindDescription(target)}</span>
                  </div>
                  <div class="feed-body">
                    <InteractivePollCard
                      event={target}
                      showControls={false}
                      voteHref={threadHref}
                      onVoteOpen={() => openThreadLink(target, row.targetId)}
                    />
                  </div>
                {:else if target && target.kind === KIND.GIT_REPO}
                  <div class="feed-body feed-body-card">
                    <GitRepositoryCard event={target} showMenu={false} />
                  </div>
                {:else if target && target.kind === KIND.ISSUE}
                  <div class="feed-body feed-body-card">
                    <GitIssueCard event={target} showMenu={false} compact />
                  </div>
                {:else if target && (target.kind === KIND.CALENDAR_DATE || target.kind === KIND.CALENDAR_TIME)}
                  <div class="feed-body feed-body-card">
                    <CalendarEventCard event={target} showMenu={false} />
                  </div>
                {:else if target}
                  <div class="thread-head">
                    <UserBadge pubkey={target.pubkey} />
                    <a
                      class="thread-time muted"
                      href={threadHref}
                      use:link
                      title={formatAbsoluteTime(target.created_at)}
                      onclick={() => openThreadLink(target, row.targetId)}
                    >{formatRelativeTime(target.created_at)}</a>
                    <span class="feed-kind muted">{eventKindDescription(target)}</span>
                  </div>
                  <div class="feed-body">
                    {#if shown[row.targetId] || feedNeedsFullBody(target)}
                      <EventBody event={target} />
                    {:else}
                      <p class="feed-preview">{rowText(target)}</p>
                    {/if}
                  </div>
                {:else if target === null}
                  <p class="muted feed-boost-missing">That note was not on your relays.</p>
                {:else}
                  <p class="muted feed-boost-missing">Loading reposted note…</p>
                {/if}
              </div>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  </div>

  {#if tabPendingRemove}
    <div
      class="login-overlay"
      role="presentation"
      onclick={cancelRemoveTab}
    >
      <div
        class="login-dialog card feed-tab-remove-dialog"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="feed-tab-remove-title"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <header class="login-dialog-head">
          <h2 id="feed-tab-remove-title">Remove feed tab?</h2>
        </header>
        <p class="login-lede">
          Remove <strong>{tabPendingRemoveLabel}</strong> from this feed? You can add it again
          later from the + menu.
        </p>
        <div class="feed-tab-remove-actions">
          <button class="btn" type="button" onclick={cancelRemoveTab}>Cancel</button>
          <button class="btn btn-primary" type="button" onclick={confirmRemoveTab}>Remove</button>
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  /*
   * Feed uses the full `.shell` column (--max-page), same as catalog/settings —
   * a nested 40rem strip left wide monitors looking empty.
   */
  .page-header {
    max-width: none;
  }
  .feed-note-compose {
    margin: 0 0 1rem;
    max-width: none;
  }
  .feed-note-preview-btn {
    flex: 0 0 auto;
    min-height: 1.65rem;
    padding: 0.15rem 0.6rem;
    font-size: 0.78rem;
  }
  .feed-note-preview-btn[aria-pressed='true'] {
    color: var(--text);
    background: color-mix(in srgb, var(--surface) 55%, var(--surface-2));
  }
  .feed-note-preview {
    margin-top: 0.15rem;
    min-height: 4.5rem;
  }
  /* ProseGrammarField owns the textarea — pierce scoped styles into the child. */
  .feed-note-compose :global(textarea) {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 4.5rem;
    padding: 0.55rem 0.65rem;
    font: inherit;
    line-height: 1.45;
    color: var(--ink);
    caret-color: var(--ink);
    background: var(--paper-light, var(--paper));
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    border-radius: 0.4rem;
  }
  .feed-note-compose :global(textarea:focus) {
    caret-color: var(--accent-strong);
  }
  .feed-note-compose :global(textarea:disabled) {
    opacity: 0.7;
  }
  .feed-note-track-warn {
    margin: 0.4rem 0 0;
    font-size: 0.78rem;
    line-height: 1.35;
    color: color-mix(in srgb, #b45309 55%, var(--ink-soft));
  }
  .feed-new-wrap {
    margin: 0 0 0.65rem;
    max-width: none;
  }
  .feed-new-events {
    width: 100%;
    justify-content: center;
    font-weight: 650;
  }
  .feed-author-filter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem 0.85rem;
    margin: 0.35rem 0 0;
  }
  .feed-list-filters {
    --feed-filter-h: 1.65rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.4rem;
    margin: 0 0 0.45rem;
    max-width: none;
  }
  .feed-filter-since,
  .feed-filter-kind {
    flex: 0 0 auto;
  }
  .feed-list-filters :global(.page-filter) {
    box-sizing: border-box;
    margin: 0;
    height: var(--feed-filter-h);
    min-height: var(--feed-filter-h);
    max-height: var(--feed-filter-h);
    padding: 0 0.4rem;
    border: 1px solid color-mix(in srgb, var(--rule) 42%, transparent);
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--ink-soft) 6%, transparent);
    color: var(--ink-soft);
    font-size: 0.72rem;
    line-height: calc(var(--feed-filter-h) - 2px);
    box-shadow: none;
  }
  /*
   * Native <option> popups often keep a light system surface while inheriting
   * the control’s text color — ink-soft on dark theme became white-on-white.
   * Force color-scheme + explicit option colors so the list stays readable.
   */
  .feed-filter-since-select,
  .feed-filter-kind-select {
    box-sizing: border-box;
    margin: 0;
    height: var(--feed-filter-h);
    min-height: var(--feed-filter-h);
    max-height: var(--feed-filter-h);
    padding: 0 0.4rem;
    border: 1px solid color-mix(in srgb, var(--rule) 42%, transparent);
    border-radius: 0.25rem;
    background: var(--paper-light);
    color: var(--ink);
    font-size: 0.72rem;
    line-height: calc(var(--feed-filter-h) - 2px);
    box-shadow: none;
    color-scheme: light;
  }
  .feed-filter-since-select option,
  .feed-filter-kind-select option {
    background-color: #fff;
    color: #1a1a1a;
  }
  :global(:root.dark) .feed-filter-since-select,
  :global(:root.dark) .feed-filter-kind-select {
    color-scheme: dark;
  }
  :global(:root.dark) .feed-filter-since-select option,
  :global(:root.dark) .feed-filter-kind-select option {
    background-color: #1c1c1c;
    color: #f2f2f2;
  }
  .feed-list-filters :global(.page-filter:hover) {
    border-color: color-mix(in srgb, var(--rule) 65%, transparent);
    background: color-mix(in srgb, var(--ink-soft) 9%, transparent);
    color: var(--ink);
  }
  .feed-filter-since-select:hover,
  .feed-filter-kind-select:hover {
    border-color: color-mix(in srgb, var(--rule) 65%, transparent);
    background: var(--paper-light);
    color: var(--ink);
  }
  .feed-list-filters :global(.page-filter:focus-visible),
  .feed-filter-since-select:focus-visible,
  .feed-filter-kind-select:focus-visible {
    color: var(--ink);
    background: var(--paper-light);
  }
  .feed-list-filters :global(.page-filter::placeholder) {
    color: color-mix(in srgb, var(--ink-soft) 70%, transparent);
    font-size: 0.72rem;
  }
  .feed-filter-since-select {
    width: auto;
    min-width: 6.25rem;
    padding-right: 1.15rem;
  }
  .feed-filter-kind-select {
    width: auto;
    min-width: 9.5rem;
    max-width: 14rem;
    padding-right: 1.15rem;
  }
  .feed-list-filters :global(.page-filter-control) {
    margin-bottom: 0 !important;
    flex: 1 1 9rem;
    max-width: none !important;
  }
  .feed-list-filters :global(.page-filter-control .page-filter) {
    padding-right: 1.35rem;
  }
  .feed-list-filters :global(.search-form-clear) {
    width: 0.95rem;
    height: 0.95rem;
    right: 0.15rem;
    font-size: 0.8rem;
    color: color-mix(in srgb, var(--ink-soft) 75%, transparent);
  }
  .feed-tabs-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.45rem 0.75rem;
    margin: 0 0 1rem;
    max-width: none;
  }
  .feed-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem 0.35rem;
    min-width: 0;
    flex: 1 1 auto;
  }
  .feed-tab {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 0.35rem 0.55rem;
    margin: 0;
    font: inherit;
    font-size: 0.95rem;
    color: color-mix(in srgb, currentColor 55%, transparent);
    cursor: grab;
    /* Let pointermove preventDefault so stylus/touch can reorder without scrolling. */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .feed-tab:active {
    cursor: grabbing;
  }
  .feed-tab:hover {
    color: inherit;
  }
  .feed-tab.active {
    color: inherit;
    border-bottom-color: var(--accent, currentColor);
    font-weight: 600;
  }
  .feed-tab-dragging {
    opacity: 0.55;
  }
  .feed-tab-drop {
    border-bottom-color: color-mix(in srgb, var(--accent, currentColor) 45%, transparent);
  }
  .feed-tab-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    margin-left: 0.05rem;
    border-radius: 999px;
    font-size: 0.85rem;
    line-height: 1;
    color: color-mix(in srgb, currentColor 55%, transparent);
  }
  .feed-tab-remove:hover {
    color: inherit;
    background: color-mix(in srgb, var(--rule) 55%, transparent);
  }
  .feed-tab-remove-dialog {
    width: min(22rem, 100%);
  }
  .feed-tab-remove-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .feed-kind-add {
    --feed-filter-h: 1.65rem;
    position: relative;
    display: inline-flex;
    align-items: center;
    margin: 0;
    flex: 0 0 auto;
  }
  .feed-kind-add-btn {
    box-sizing: border-box;
    height: var(--feed-filter-h);
    min-height: var(--feed-filter-h);
    min-width: var(--feed-filter-h);
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--rule) 42%, transparent);
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--ink-soft) 6%, transparent);
    color: var(--ink-soft);
    font-size: 0.85rem;
    line-height: 1;
  }
  .feed-kind-add-btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--rule) 65%, transparent);
    background: color-mix(in srgb, var(--ink-soft) 9%, transparent);
    color: var(--ink);
  }
  .feed-kind-picker {
    position: absolute;
    top: calc(100% + 0.35rem);
    right: 0;
    z-index: 40;
    box-sizing: border-box;
    width: min(18.5rem, calc(100vw - 2rem));
    max-height: min(28rem, 75vh);
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.55rem 0.6rem 0.6rem;
    border: 1px solid color-mix(in srgb, var(--rule) 55%, transparent);
    border-radius: 0.35rem;
    background: var(--paper-light, var(--paper));
    box-shadow: 0 0.45rem 1.1rem color-mix(in srgb, var(--ink) 14%, transparent);
    overflow: hidden;
  }
  .feed-kind-picker-restore-block {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-bottom: 0.45rem;
    border-bottom: 1px solid color-mix(in srgb, var(--rule) 40%, transparent);
  }
  .feed-kind-picker-kinds-block {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .feed-kind-picker-hint {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.3;
    flex: 0 0 auto;
  }
  .feed-kind-picker-list-restore {
    flex: 0 0 auto;
    overflow: visible;
    min-height: 0;
  }
  .feed-kind-picker-custom {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    flex: 0 0 auto;
  }
  .feed-kind-picker-custom-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.72rem;
  }
  .feed-kind-picker-custom-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .feed-kind-picker-kind-input {
    flex: 1 1 auto;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }
  .feed-kind-picker-row-btn {
    appearance: none;
    box-sizing: border-box;
    flex: 0 0 auto;
    width: 1.65rem;
    height: 1.65rem;
    margin: 0;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--rule) 45%, transparent);
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--ink-soft) 6%, transparent);
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
  }
  .feed-kind-picker-row-btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--rule) 65%, transparent);
    background: color-mix(in srgb, var(--ink-soft) 10%, transparent);
    color: var(--ink);
  }
  .feed-kind-picker-row-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .feed-kind-picker-name {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin: 0;
    font-size: 0.72rem;
  }
  .feed-kind-picker-name-input {
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    padding: 0.35rem 0.45rem;
    border: 1px solid color-mix(in srgb, var(--rule) 42%, transparent);
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--ink-soft) 6%, transparent);
    color: var(--ink);
    font: inherit;
    font-size: 0.8rem;
    line-height: 1.3;
  }
  .feed-kind-picker-name-input::placeholder {
    color: color-mix(in srgb, var(--ink-soft) 70%, transparent);
  }
  .feed-kind-picker-name-input:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent, currentColor) 45%, transparent);
    outline-offset: 1px;
  }
  .feed-kind-picker-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    flex: 0 0 auto;
  }
  .feed-kind-picker-kinds-block > .feed-kind-picker-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }
  .feed-kind-picker-row {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    margin: 0;
    padding: 0.28rem 0.3rem;
    border-radius: 0.25rem;
    font-size: 0.78rem;
    line-height: 1.35;
    color: var(--ink);
    cursor: pointer;
  }
  .feed-kind-picker-row:hover {
    background: color-mix(in srgb, var(--ink-soft) 8%, transparent);
  }
  .feed-kind-picker-row input {
    margin: 0.15rem 0 0;
    flex: 0 0 auto;
  }
  .feed-kind-picker-row span {
    min-width: 0;
  }
  .feed-kind-picker-restore {
    width: 100%;
    justify-content: flex-start;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.35rem 0.55rem;
    color: var(--ink);
    background: var(--paper-light, var(--paper));
    border: 1px solid color-mix(in srgb, var(--rule) 65%, transparent);
  }
  .feed-kind-picker-restore:hover:not(:disabled) {
    color: var(--ink);
    background: color-mix(in srgb, var(--accent) 10%, var(--paper-light, var(--paper)));
    border-color: color-mix(in srgb, var(--accent) 45%, var(--rule));
  }
  .feed-kind-picker-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.35rem;
    flex: 0 0 auto;
    padding-top: 0.15rem;
    border-top: 1px solid color-mix(in srgb, var(--rule) 40%, transparent);
  }
  .feed-kind-picker-actions .btn {
    font-size: 0.78rem;
    padding: 0.3rem 0.65rem;
  }
  .feed-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: none;
    overflow-anchor: none;
  }
  .feed-row {
    display: flex;
    flex-direction: column;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    max-height: 500px;
    padding: 0.55rem 0.75rem;
    overflow: hidden;
    overflow-anchor: none;
  }
  .feed-row-oneline {
    max-height: none;
    /* Keep menus usable vertically; never spill text past the card. */
    overflow-x: clip;
    overflow-y: visible;
    padding: 0.4rem 0.75rem;
  }
  .feed-boost-missing {
    margin: 0.15rem 0 0;
    font-size: 0.92rem;
  }
  .feed-hit {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    max-width: 100%;
    width: 100%;
    overflow: hidden;
    cursor: pointer;
  }
  .feed-hit-oneline {
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.45rem;
  }
  .feed-hit-oneline .thread-head {
    margin-bottom: 0;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 70%;
  }
  .feed-hit-oneline .feed-body {
    margin-top: 0;
    flex: 1 1 0;
    min-width: 0;
    max-width: 100%;
  }
  .feed-hit .thread-actions {
    opacity: 0.45;
  }
  .feed-hit:hover .thread-actions,
  .feed-hit:focus-within .thread-actions,
  .feed-hit .thread-actions:focus-within {
    opacity: 1;
  }
  .feed-hit-oneline .thread-actions {
    margin-left: 0.15rem;
  }
  .feed-hit :global(.feed-row-more .copy-pointer-btn) {
    width: 1.85rem;
    height: 1.85rem;
    min-width: 1.85rem;
    background: transparent;
    border-color: transparent;
    box-shadow: none;
    color: var(--text-muted);
  }
  .feed-hit :global(.feed-row-more .copy-pointer-btn:hover),
  .feed-hit :global(.feed-row-more .copy-pointer-btn:focus-visible),
  .feed-hit :global(.feed-row-more.event-more-menu-open .copy-pointer-btn) {
    color: var(--text);
    background: color-mix(in srgb, var(--surface) 55%, var(--surface-2));
  }
  .feed-hit-oneline :global(.event-body),
  .feed-hit-oneline :global(.reaction-face) {
    margin: 0;
  }
  .feed-hit-oneline :global(.reaction-face) {
    font-size: 1.25rem;
  }
  .feed-hit-oneline :global(.reaction-face .reaction-emoji) {
    width: 1.25em !important;
    height: 1.25em !important;
    max-width: 1.25em !important;
    max-height: 1.25em !important;
  }
  .feed-hit-oneline .feed-preview {
    display: block;
    min-width: 0;
    max-width: 100%;
    -webkit-line-clamp: unset;
    line-clamp: unset;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .feed-kind {
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .feed-body {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    margin-top: 0.25rem;
    cursor: pointer;
    overflow-x: clip;
  }
  /* Keep imeta media inside the feed-row 500px clip instead of showing only alt. */
  .feed-body :global(.event-imeta-btn .event-imeta),
  .feed-body :global(img.event-imeta),
  .feed-body :global(video.event-imeta) {
    max-height: min(40vh, 14rem) !important;
    margin-block: 0.45rem !important;
  }
  /* Notes with markdown headings stay compact in the list (full size in the OP thread). */
  .feed-body :global(.event-body h1),
  .feed-body :global(.event-body .sect1 > h2),
  .feed-preview :global(h1) {
    font-size: 1.05rem;
    line-height: 1.3;
    margin: 0 0 0.35rem;
    font-weight: 650;
  }
  .feed-body :global(.event-body h2) {
    font-size: 1rem;
    line-height: 1.3;
    margin: 0.55rem 0 0.3rem;
  }
  .feed-body :global(.event-body h3),
  .feed-body :global(.event-body h4) {
    font-size: 0.95rem;
    line-height: 1.3;
    margin: 0.45rem 0 0.25rem;
  }
  .feed-body :global(:is(.generic-card, .note-card, .pub-card, .picture-card, .video-card, .result-card-wrap, .directory-explorer, .profile-meta-card)) {
    cursor: auto;
  }
  .feed-body-card {
    margin-top: 0;
  }
  .feed-body-card :global(.pub-card) {
    /* Nested inside the feed-row card — drop the second plate. */
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
  }
  .feed-body-directory {
    max-height: min(28rem, 70vh);
    overflow: auto;
  }
  .feed-body-profile {
    margin-top: 0;
  }
  .feed-row:has(.feed-body-directory),
  .feed-row:has(.feed-body-profile),
  .feed-row:has(.feed-body-card) {
    max-height: none;
  }
  .feed-preview {
    margin: 0;
    min-width: 0;
    max-width: 100%;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .feed-repo-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0 0 0.85rem;
    padding: 0.2rem;
    border: 1px solid color-mix(in srgb, var(--rule) 65%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--paper) 45%, var(--paper-light));
  }
  .feed-repo-tab {
    appearance: none;
    border: 0;
    margin: 0;
    padding: 0.4rem 0.75rem;
    border-radius: 0.35rem;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
  .feed-repo-tab.active {
    background: color-mix(in srgb, var(--accent) 18%, var(--paper-light));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .feed-comments {
    margin-top: 1rem;
    padding: 1rem 1.1rem 1.25rem;
  }
  .feed-full-page {
    margin: 0.75rem 0 0;
  }
</style>
