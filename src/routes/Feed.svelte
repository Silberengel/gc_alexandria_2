<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { untrack } from 'svelte';
  import { link, querystring, replace } from 'svelte-spa-router';
  import TopBar from '$lib/components/TopBar.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import EventBody from '$lib/components/EventBody.svelte';
  import EditionHeader from '$lib/components/EditionHeader.svelte';
  import DetailsPanel from '$lib/components/DetailsPanel.svelte';
  import EventCard from '$lib/components/EventCard.svelte';
  import WorkCommentsPanel from '$lib/components/WorkCommentsPanel.svelte';
  import LiveChatFeed from '$lib/components/LiveChatFeed.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import FeedBoosters from '$lib/components/FeedBoosters.svelte';
  import { KIND } from '$lib/constants';
  import { isNip53Kind, NIP53_KIND, parseLiveStream } from '$lib/nip53';
  import {
    collectLivePresence,
    LIVE_PRESENCE_REFRESH_MS,
    localRoomPresence,
    roomPresenceDraft
  } from '$lib/live-chat';
  import { isSignInFlight, signAndPublish } from '$lib/sign';
  import {
    emptyWorkResponses,
    eventsPointingAtId,
    fetchWorkResponses,
    type WorkResponses
  } from '$lib/comments';
  import { cropRenderedUrlsInText } from '$lib/crop-url';
  import { resolveReactionEmoji } from '$lib/emoji-content';
  import { filterMuted, muteState, type MuteState } from '$lib/mute';
  import { deletionRevision, filterDeletedEvents } from '$lib/deletions';
  import { liveChatShield } from '$lib/stores/live-chat-shield';
  import { eventPreview } from '$lib/event-preview';
  import { eventKindDescription } from '$lib/kind-label';
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
    collectNewFeedEvents,
    feedEventsWatermark,
    feedFollowAuthors,
    feedListPath,
    feedRelayGroups,
    eventMatchesThreadTarget,
    isFeedInteractionEvent,
    feedThreadPath,
    feedThreadPointerFromId,
    fetchFeedThreadTarget,
    mergeFeedPosts,
    loadAuthorFeed,
    loadAuthorFeedWithReplies,
    loadFeed,
    loadFeedWithReplies,
    loadNotifications,
    parseFeedAuthorParam,
    parseFeedTab,
    parseFeedThreadParam,
    parseFeedThreadTarget,
    recallAuthorFeedPosts,
    recallAuthorFeedWithReplies,
    recallFeedPosts,
    recallFeedWithReplies,
    recallNotifications,
    type FeedTab
  } from '$lib/feed';
  import { takePendingNavEvent, warmNavEvent } from '$lib/nav-warm';
  import { memoryGetEvent } from '$lib/nostr/event-memory';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { getSelectorContext, onSelectorContext } from '$lib/nostr/selector';
  import { textHighlightsFromEvents } from '$lib/text-highlights';

  let { params: _params = {} }: { params?: Record<string, string> } = $props();

  /** Open thread from `?thread=` (nevent / naddr / hex) — same `/feed` route. */
  const threadTarget = $derived(parseFeedThreadTarget($querystring));
  const pointer = $derived(threadTarget ? parseFeedThreadParam($querystring) : null);
  const signedIn = $derived(!!$session.pubkey);
  const feedQuery = $derived(new URLSearchParams($querystring ?? ''));
  const feedAuthor = $derived(parseFeedAuthorParam(feedQuery.get('author')));
  const feedTab = $derived(
    feedAuthor && parseFeedTab(feedQuery.get('tab')) === 'notifications'
      ? 'replies'
      : parseFeedTab(feedQuery.get('tab'))
  );
  let metadataEvents = $state<Event[]>([]);
  /**
   * Stable feed-load deps. Raw `metadataEvents` / `$muteState` get new identities on every
   * kind-0 merge and would cancel in-flight list REQs forever ("Loading original posts…").
   */
  const followAuthorsKey = $derived(feedFollowAuthors(metadataEvents, $muteState).join('\n'));
  const muteKey = $derived.by(() => {
    const m = $muteState;
    return `${[...m.pubkeys].sort().join(',')}|${[...m.eventIds].sort().join(',')}`;
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
    if (feedTab === 'notifications') {
      return signedIn
        ? 'Replies, comments, reactions, boosts, highlights, quotes, and zaps aimed at you.'
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

  function setFeedTab(next: FeedTab): void {
    if (feedAuthor && next === 'notifications') return;
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
    void replace(feedListPath(next, { author: feedAuthor }));
  }

  let items = $state<Event[]>([]);
  const visibleItems = $derived.by(() => {
    $deletionRevision;
    return filterDeletedEvents(
      filterMuted(
        feedAuthor
          ? items.filter((event) => event.pubkey.toLowerCase() === feedAuthor)
          : items,
        $muteState
      )
    );
  });
  /** Reposts collapse onto the target event; boosters show as profile pics. */
  const feedRows = $derived(collapseFeedReposts(visibleItems));
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
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
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
    if (item.kind === KIND.ZAP) return 'Zap receipt';
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

  const libraryKind = $derived(
    !!event &&
      (event.kind === KIND.LONG_FORM ||
        event.kind === KIND.PUBLICATION ||
        event.kind === KIND.WIKI ||
        event.kind === KIND.SPEC)
  );
  const fullPage = $derived(event && libraryKind ? libraryDocumentPath(event) : '');
  const mutedHighlights = $derived(filterMuted(responses.highlights, $muteState));
  const bodyHighlights = $derived(textHighlightsFromEvents(mutedHighlights));
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

  function armListRestore(focusId: string): void {
    pendingFocusId = focusId.toLowerCase();
    savedListScrollY = window.scrollY;
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
      window.scrollTo({ top: y, left: 0, behavior: 'auto' });
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
    return feedThreadPath(item, feedTab, { author: feedAuthor });
  }

  function openThreadForEvent(item: Event, e: MouseEvent, restoreId: string): void {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        'a, button, input, textarea, video, audio, .generic-card, .note-card, .pub-card, .picture-card, .video-card, .result-card-wrap, .userbadge'
      )
    ) {
      return;
    }
    armListRestore(restoreId);
    if (isFeedInteractionEvent(item)) {
      const eTags = item.tags.filter((t) => t[0] === 'e' && t[1] && /^[0-9a-f]{64}$/i.test(t[1]));
      const targetId = eTags[eTags.length - 1]?.[1]?.toLowerCase();
      const warm = targetId ? memoryGetEvent(targetId) : null;
      warmNavEvent(warm ?? item);
    } else {
      warmNavEvent(item);
    }
    void replace(feedOpenPath(item));
    queueMicrotask(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }

  function openThreadForTargetId(targetId: string, e: MouseEvent, warm?: Event | null): void {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest('a, button, input, textarea, video, audio, .userbadge')) return;
    armListRestore(targetId);
    if (warm) warmNavEvent(warm);
    const q = new URLSearchParams();
    q.set('thread', feedThreadPointerFromId(targetId));
    if (feedTab !== 'original') q.set('tab', feedTab);
    if (feedAuthor) q.set('author', feedAuthor);
    void replace(`/feed?${q.toString()}`);
    queueMicrotask(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }

  function openThreadLink(item: Event, restoreId = item.id): void {
    armListRestore(restoreId);
    warmNavEvent(item);
    queueMicrotask(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }

  /** Back to the feed list at the card that was opened (same route — list state intact). */
  function returnToFeedList(): void {
    void replace(feedListPath(feedTab, { author: feedAuthor }));
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
    const listKey = `${tab}:${author ?? ''}`;
    const pubkey = $session.pubkey;
    const sessionLoading = $session.loading;
    // Snapshot via untrack — identity churn on these must not re-subscribe the effect.
    const meta = untrack(() => metadataEvents);
    const muted = untrack(() => $muteState);
    const threadOpen = !!pointer;
    let cancelled = false;

    if (threadOpen) {
      return () => {
        cancelled = true;
      };
    }

    listError = '';

    if (loadedTab !== listKey) {
      items = [];
      shown = {};
      boostTargets = {};
      boostFetchQueued = {};
      pendingNew = [];
      feedWatermark = 0;
      loadedTab = listKey;
      listLoading = true;
      listSettled = false;
    } else if (!untrack(() => items.length) && !untrack(() => listSettled)) {
      listLoading = true;
    }

    if (tab === 'notifications' && !pubkey) {
      items = [];
      pendingNew = [];
      listLoading = false;
      listSettled = true;
      return;
    }

    if (pubkey && sessionLoading && !feedRelayGroups().personal.length && tab !== 'notifications') {
      const recall = author
        ? tab === 'replies'
          ? recallAuthorFeedWithReplies(author)
          : recallAuthorFeedPosts(author)
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

    // Already settled for this tab — quiet polling handles New Events.
    if (untrack(() => listSettled) && untrack(() => items.length)) {
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
        return loadNotifications(pubkey!, muted, onCache);
      }
      if (author) {
        return tab === 'replies'
          ? loadAuthorFeedWithReplies(author, muted, onCache)
          : loadAuthorFeed(author, muted, onCache);
      }
      if (tab === 'replies') {
        return loadFeedWithReplies(meta, muted, onCache);
      }
      return loadFeed(meta, muted, onCache);
    };

    const recallForTab = (): Promise<Event[]> => {
      if (tab === 'notifications' && pubkey) return recallNotifications(pubkey);
      if (author) {
        return tab === 'replies'
          ? recallAuthorFeedWithReplies(author)
          : recallAuthorFeedPosts(author);
      }
      if (tab === 'replies') return recallFeedWithReplies();
      return recallFeedPosts();
    };

    void recallForTab().then((cached) => {
      if (cancelled || !cached.length) return;
      ingestFeedEvents(cached, muted);
      listLoading = false;
    });

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
            listLoading = false;
            listSettled = true;
            feedWatermark = Math.max(feedWatermark, feedEventsWatermark(items));
            return;
          }
          if (items.length) listLoading = false;
          if (tab === 'notifications' && items.length) {
            listLoading = false;
            listSettled = true;
            feedWatermark = Math.max(feedWatermark, feedEventsWatermark(items));
            return;
          }
        } catch (err: unknown) {
          if (cancelled) return;
          if (items.length) {
            listLoading = false;
            listSettled = true;
            feedWatermark = Math.max(feedWatermark, feedEventsWatermark(items));
            return;
          }
          listError = err instanceof Error ? err.message : 'Could not load the feed.';
          listLoading = false;
          listSettled = true;
          return;
        }
        if (attempt < 3 && !cancelled) await wait(1200);
      }
      if (cancelled || items.length) {
        if (!cancelled) {
          listLoading = false;
          listSettled = true;
          feedWatermark = Math.max(feedWatermark, feedEventsWatermark(items));
        }
        return;
      }
      listLoading = false;
      listSettled = true;
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
    const pubkey = $session.pubkey;
    const meta = untrack(() => metadataEvents);
    const muted = untrack(() => $muteState);
    if (tab === 'notifications' && !pubkey) return;

    let cancelled = false;
    const pull = async () => {
      try {
        let events: Event[] = [];
        if (tab === 'notifications' && pubkey) {
          events = await loadNotifications(pubkey, muted);
        } else if (author) {
          events =
            tab === 'replies'
              ? await loadAuthorFeedWithReplies(author, muted)
              : await loadAuthorFeed(author, muted);
        } else if (tab === 'replies') {
          events = await loadFeedWithReplies(meta, muted);
        } else {
          events = await loadFeed(meta, muted);
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
      return;
    }
    responses = emptyWorkResponses();
    socialLoading = false;
    const warm = takePendingNavEvent();
    const seeded = warm && eventMatchesThreadTarget(warm, target) ? warm : null;
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
        const signed = await signAndPublish(roomPresenceDraft(activity, { relayHint }));
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

<TopBar />
<main class="shell reading-body feed-page">
  {#if pointer}
    <div class="feed-thread-pane">
      <p class="feed-back">
        <button type="button" class="btn feed-return-btn" onclick={returnToFeedList}>Return</button>
      </p>
      {#if threadLoading}
        <LoadingHint message="Opening this thread…" />
      {:else if event}
        {#if isNip53Kind(event.kind) && event.kind !== NIP53_KIND.LIVE_CHAT}
          <EventCard {event} asCard presence={livePresence} />
          <DetailsPanel {event} appHandlers={panelResponses.appHandlers ?? []} />
        {:else}
          <article class="card reading-body">
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
            <EventBody {event} quotes={bodyHighlights} />
            <DetailsPanel {event} appHandlers={panelResponses.appHandlers ?? []} />
          </article>
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
    <div class="feed-tabs" role="tablist" aria-label="Feed view">
      <button
        type="button"
        role="tab"
        class="feed-tab"
        class:active={feedTab === 'original'}
        aria-selected={feedTab === 'original'}
        tabindex={pointer ? -1 : 0}
        onclick={() => setFeedTab('original')}>Original Posts</button
      >
      <button
        type="button"
        role="tab"
        class="feed-tab"
        class:active={feedTab === 'replies'}
        aria-selected={feedTab === 'replies'}
        tabindex={pointer ? -1 : 0}
        onclick={() => setFeedTab('replies')}>Replies</button
      >
      {#if !feedAuthor}
        <button
          type="button"
          role="tab"
          class="feed-tab"
          class:active={feedTab === 'notifications'}
          aria-selected={feedTab === 'notifications'}
          tabindex={pointer ? -1 : 0}
          onclick={() => setFeedTab('notifications')}>Notifications</button
        >
      {/if}
    </div>
    {#if feedTab === 'notifications' && !signedIn}
      <p class="muted">
        <button type="button" class="btn btn-primary" onclick={() => openLoginDialog()}
          >Sign in</button
        >
        to see responses to your posts.
      </p>
    {:else if !visibleItems.length && listError}
      <p class="muted">{listError}</p>
    {:else if !visibleItems.length && !listSettled}
      <LoadingHint
        message={feedTab === 'notifications'
          ? 'Loading notifications…'
          : feedTab === 'replies'
            ? 'Loading posts and replies…'
            : 'Loading original posts…'}
      />
    {:else if !visibleItems.length}
      <p class="muted">
        {#if feedTab === 'notifications'}
          No notifications yet.
        {:else if feedTab === 'replies'}
          No posts or replies here yet.
        {:else}
          No original posts here yet.
        {/if}
      </p>
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
            {@const threadHref = `#${feedOpenPath(item)}`}
            <li
              class="card feed-row"
              class:feed-row-oneline={reactionRow}
              data-feed-row={item.id.toLowerCase()}
              use:watchRow={item.id}
            >
              <div
                class="feed-hit"
                class:feed-hit-oneline={reactionRow}
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
                <div class="thread-head">
                  <UserBadge pubkey={item.pubkey} />
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
                </div>
                <div class="feed-body">
                  {#if shown[item.id.toLowerCase()]}
                    <EventBody event={item} />
                  {:else}
                    <p class="feed-preview">{rowText(item)}</p>
                  {/if}
                </div>
              </div>
            </li>
          {:else}
            {@const target = boostTargets[row.targetId]}
            {@const threadHref = `#/feed?thread=${feedThreadPointerFromId(row.targetId)}${feedTab !== 'original' ? `&tab=${feedTab}` : ''}${feedAuthor ? `&author=${feedAuthor}` : ''}`}
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
                {#if target}
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
                    {#if shown[row.targetId]}
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
</main>

<style>
  .feed-back {
    margin: 0 0 0.75rem;
  }
  .feed-return-btn {
    font-size: 0.9rem;
    padding: 0.3rem 0.7rem;
  }
  .feed-new-wrap {
    margin: 0 0 0.65rem;
    max-width: 40rem;
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
  .feed-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem 0.35rem;
    margin: 0 0 1rem;
    max-width: 40rem;
  }
  .feed-tab {
    appearance: none;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 0.35rem 0.55rem;
    margin: 0;
    font: inherit;
    font-size: 0.95rem;
    color: color-mix(in srgb, currentColor 55%, transparent);
    cursor: pointer;
  }
  .feed-tab:hover {
    color: inherit;
  }
  .feed-tab.active {
    color: inherit;
    border-bottom-color: var(--accent, currentColor);
    font-weight: 600;
  }
  .feed-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 40rem;
    overflow-anchor: none;
  }
  .feed-row {
    display: flex;
    flex-direction: column;
    max-height: 500px;
    padding: 0.55rem 0.75rem;
    overflow: hidden;
    overflow-anchor: none;
  }
  .feed-row-oneline {
    max-height: none;
    overflow: visible;
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
  }
  .feed-hit-oneline .feed-body {
    margin-top: 0;
    flex: 0 1 auto;
    min-width: 0;
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
    flex: 1;
    margin-top: 0.25rem;
    cursor: pointer;
  }
  .feed-body :global(:is(.generic-card, .note-card, .pub-card, .picture-card, .video-card, .result-card-wrap)) {
    cursor: auto;
  }
  .feed-preview {
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: pre-wrap;
  }
  .feed-comments {
    margin-top: 1rem;
    padding: 1rem 1.1rem 1.25rem;
  }
  .feed-full-page {
    margin: 0.75rem 0 0;
  }
</style>
