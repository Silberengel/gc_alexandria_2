<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { untrack } from 'svelte';
  import { link, querystring, replace } from 'svelte-spa-router';
  import TopBar from '$lib/components/TopBar.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import EventBody from '$lib/components/EventBody.svelte';
  import EditionHeader from '$lib/components/EditionHeader.svelte';
  import DetailsPanel from '$lib/components/DetailsPanel.svelte';
  import WorkCommentsPanel from '$lib/components/WorkCommentsPanel.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import { KIND } from '$lib/constants';
  import {
    emptyWorkResponses,
    fetchWorkResponses,
    type WorkResponses
  } from '$lib/comments';
  import { cropRenderedUrlsInText } from '$lib/crop-url';
  import { resolveReactionEmoji } from '$lib/emoji-content';
  import { filterMuted, muteState } from '$lib/mute';
  import { eventPreview } from '$lib/event-preview';
  import { kindDescription } from '$lib/kind-label';
  import { libraryDocumentPath } from '$lib/metadata';
  import { fetchById } from '$lib/nostr/fetch';
  import {
    DEFAULT_LIKE_REACTION_CONTENT,
    DEFAULT_LIKE_REACTION_DISPLAY_EMOJI,
    isPositiveLikeContent
  } from '$lib/reactions';
  import { isRepostKind, peekRepostExcerpt, repostTargetId } from '$lib/repost';
  import {
    decodeFeedPointer,
    feedFollowAuthors,
    feedRelayGroups,
    feedThreadPath,
    fetchFeedEvent,
    keepFeedPosts,
    loadFeed,
    loadFeedWithReplies,
    loadNotifications,
    parseFeedTab,
    recallFeedPosts,
    recallFeedWithReplies,
    recallNotifications,
    type FeedTab
  } from '$lib/feed';
  import { takePendingNavEvent, warmNavEvent } from '$lib/nav-warm';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { getSelectorContext, onSelectorContext } from '$lib/nostr/selector';
  import { textHighlightsFromEvents } from '$lib/text-highlights';

  let { params = {} }: { params?: { id?: string } } = $props();

  const pointer = $derived(params.id ? decodeFeedPointer(params.id) : null);
  const signedIn = $derived(!!$session.pubkey);
  const feedTab = $derived(
    parseFeedTab(new URLSearchParams($querystring ?? '').get('tab'))
  );
  let metadataEvents = $state<Event[]>([]);
  const lede = $derived.by(() => {
    void $session.pubkey;
    void feedTab;
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
        ? `Original posts and replies from your favorites and inboxes${follows}.`
        : `Original posts and replies from your inboxes${follows}.`;
    }
    if (!signedIn) return 'Original posts from theforest.';
    const follows = feedFollowAuthors(metadataEvents, $muteState).length
      ? ', plus notes from people you follow'
      : '';
    const { favorites, inbox } = getSelectorContext();
    if (!favorites.length && !inbox.length) return `Original posts from theforest${follows}.`;
    return favorites.length
      ? `Original posts from your favorites and inboxes${follows}.`
      : `Original posts from your inboxes${follows}.`;
  });

  function setFeedTab(next: FeedTab): void {
    if (next === feedTab) return;
    const path = next === 'original' ? '/feed' : `/feed?tab=${next}`;
    void replace(path);
  }

  let items = $state<Event[]>([]);
  const visibleItems = $derived(filterMuted(items, $muteState));
  let listLoading = $state(true);
  /** True only after a load finishes once the viewer's relay lists are in place. */
  let listSettled = $state(false);
  let listError = $state('');
  let feedRelays = $state(0);
  /** Last tab whose list is currently shown — wipe rows when the tab changes. */
  let loadedTab = $state<FeedTab | null>(null);
  /** Rows in view. Each one renders its body and embedded cards; the rest stay a preview. */
  let shown = $state<Record<string, true>>({});
  /** Excerpt of the boosted note for kind 6/16 rows (imwald BoostedByCard). */
  let boostExcerpts = $state<Record<string, string>>({});

  function watchRow(node: HTMLElement, id: string) {
    if (shown[id]) return { destroy() {} };
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        shown = { ...shown, [id]: true };
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
    if (isRepostKind(item.kind)) {
      const excerpt = boostExcerpts[item.id] ?? peekRepostExcerpt(item);
      return excerpt ? cropRenderedUrlsInText(excerpt) : '';
    }
    const preview = eventPreview(item);
    const text =
      item.kind === KIND.TEXT_NOTE
        ? preview.body || preview.summary || 'Note'
        : preview.body
          ? `${preview.headline} — ${preview.body}`
          : preview.headline;
    return cropRenderedUrlsInText(text);
  }

  $effect(() => {
    const pending: Event[] = [];
    for (const item of visibleItems) {
      if (!isRepostKind(item.kind) || !shown[item.id]) continue;
      if (boostExcerpts[item.id] !== undefined) continue;
      const peek = peekRepostExcerpt(item);
      if (peek) {
        boostExcerpts = { ...boostExcerpts, [item.id]: peek };
        continue;
      }
      if (repostTargetId(item)) pending.push(item);
      else boostExcerpts = { ...boostExcerpts, [item.id]: '' };
    }
    if (!pending.length) return;
    let cancelled = false;
    void (async () => {
      for (const item of pending) {
        const id = repostTargetId(item);
        if (!id || cancelled) continue;
        const target = await fetchById(id);
        if (cancelled) return;
        boostExcerpts = {
          ...boostExcerpts,
          [item.id]: peekRepostExcerpt(item) || target?.content?.trim() || ''
        };
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
  const focusComment = $derived(
    (new URLSearchParams($querystring ?? '').get('comment') ?? '').trim().toLowerCase()
  );

  function openThread(item: Event, e: MouseEvent): void {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        'a, button, input, textarea, video, audio, .generic-card, .note-card, .pub-card, .picture-card, .video-card, .result-card-wrap'
      )
    ) {
      return;
    }
    const boostTargetId = isRepostKind(item.kind) ? repostTargetId(item) : null;
    if (boostTargetId) {
      window.location.hash = `#/feed/${boostTargetId}`;
      return;
    }
    warmNavEvent(item);
    window.location.hash = `#${feedThreadPath(item)}`;
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
    if (params.id) return;
    void feedRelays;
    const tab = feedTab;
    const pubkey = $session.pubkey;
    const sessionLoading = $session.loading;
    const meta = metadataEvents;
    const muted = $muteState;
    let cancelled = false;
    listError = '';
    if (loadedTab !== tab) {
      items = [];
      shown = {};
      boostExcerpts = {};
      loadedTab = tab;
      listLoading = true;
      listSettled = false;
    } else if (!untrack(() => items.length)) {
      listLoading = true;
      listSettled = false;
    }

    if (tab === 'notifications' && !pubkey) {
      items = [];
      listLoading = false;
      listSettled = true;
      return;
    }

    if (pubkey && sessionLoading && !feedRelayGroups().personal.length && tab !== 'notifications') {
      // Lists are still loading. Show anything already cached, but do not
      // settle: theforest long-form is not this account's kind 1 feed.
      const recall =
        tab === 'replies' ? recallFeedWithReplies() : recallFeedPosts();
      void recall.then((cached) => {
        if (cancelled) return;
        const posts = filterMuted(cached, muted);
        if (!posts.length) return;
        items = keepFeedPosts(untrack(() => items), posts);
        listLoading = false;
      });
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
      if (tab === 'replies') {
        return loadFeedWithReplies(meta, muted, onCache);
      }
      return loadFeed(meta, muted, onCache);
    };

    const recallForTab = (): Promise<Event[]> => {
      if (tab === 'notifications' && pubkey) return recallNotifications(pubkey);
      if (tab === 'replies') return recallFeedWithReplies();
      return recallFeedPosts();
    };

    void recallForTab().then((cached) => {
      if (cancelled || !cached.length) return;
      items = keepFeedPosts(untrack(() => items), filterMuted(cached, muted));
      listLoading = false;
    });

    void (async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
        try {
          const events = await loadForTab((cached) => {
            if (cancelled || !cached.length) return;
            items = keepFeedPosts(items, cached);
            listLoading = false;
          });
          if (cancelled) return;
          items = keepFeedPosts(items, events);
          const listsMissing =
            tab !== 'notifications' && !!pubkey && !feedRelayGroups().personal.length;
          if (items.length && !listsMissing) {
            listLoading = false;
            listSettled = true;
            return;
          }
          if (items.length) listLoading = false;
          if (tab === 'notifications' && items.length) {
            listLoading = false;
            listSettled = true;
            return;
          }
        } catch (err: unknown) {
          if (cancelled) return;
          if (items.length) {
            listLoading = false;
            listSettled = true;
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

  $effect(() => {
    const id = pointer;
    if (!params.id) return;
    void $session.pubkey;
    let cancelled = false;
    responses = emptyWorkResponses();
    socialLoading = false;
    if (!id) {
      event = null;
      threadLoading = false;
      return;
    }
    const warm = takePendingNavEvent();
    const seeded = warm && warm.id.toLowerCase() === id ? warm : null;
    event = seeded;
    threadLoading = !seeded;
    void (async () => {
      const found = seeded ?? (await fetchFeedEvent(id));
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
</script>

<TopBar />
<main class="shell reading-body feed-page">
  {#if params.id}
    <p class="feed-back"><a href="#/feed" use:link>Feed</a></p>
    {#if threadLoading}
      <LoadingHint message="Opening this thread…" />
    {:else if event}
      <article class="card reading-body">
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
            <span class="feed-kind muted">{kindDescription(event.kind)}</span>
          </header>
        {/if}
        <EventBody {event} quotes={bodyHighlights} />
        <DetailsPanel {event} />
      </article>
      {#if fullPage}
        <p class="feed-full-page"><a href={`#${fullPage}`} use:link>Open the full page</a></p>
      {/if}
      <div class="card reading-width feed-comments">
        <WorkCommentsPanel
          target={event}
          {responses}
          focusId={focusComment}
          loading={socialLoading}
        />
      </div>
    {:else}
      <p class="muted">This note was not on your relays.</p>
    {/if}
  {:else}
    <header class="page-header">
      <h1>Feed</h1>
      <p class="page-lede muted">{lede}</p>
    </header>
    <div class="feed-tabs" role="tablist" aria-label="Feed view">
      <button
        type="button"
        role="tab"
        class="feed-tab"
        class:active={feedTab === 'original'}
        aria-selected={feedTab === 'original'}
        onclick={() => setFeedTab('original')}>Original Posts</button
      >
      <button
        type="button"
        role="tab"
        class="feed-tab"
        class:active={feedTab === 'replies'}
        aria-selected={feedTab === 'replies'}
        onclick={() => setFeedTab('replies')}>Replies</button
      >
      <button
        type="button"
        role="tab"
        class="feed-tab"
        class:active={feedTab === 'notifications'}
        aria-selected={feedTab === 'notifications'}
        onclick={() => setFeedTab('notifications')}>Notifications</button
      >
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
    {:else}
      <ul class="feed-list">
        {#each visibleItems as item (item.id)}
          {@const reactionRow = item.kind === KIND.REACTION || item.kind === 17}
          {@const boostRow = isRepostKind(item.kind)}
          {@const boostTarget = boostRow ? repostTargetId(item) : null}
          {@const boostExcerpt = boostRow
            ? boostExcerpts[item.id] ?? peekRepostExcerpt(item)
            : ''}
          {@const threadHref = `#${boostTarget ? `/feed/${boostTarget}` : feedThreadPath(item)}`}
          <li
            class="card feed-row"
            class:feed-row-oneline={reactionRow}
            class:feed-row-boost={boostRow}
            use:watchRow={item.id}
          >
            <div
              class="feed-hit"
              class:feed-hit-oneline={reactionRow}
              role="link"
              tabindex="0"
              onclick={(e) => openThread(item, e)}
              onkeydown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                openThread(item, e as unknown as MouseEvent);
              }}
            >
              <div class="thread-head">
                {#if boostRow}
                  <span class="feed-boost-label">Boosted by</span>
                {/if}
                <UserBadge pubkey={item.pubkey} />
                <a
                  class="thread-time muted"
                  href={threadHref}
                  use:link
                  title={formatAbsoluteTime(item.created_at)}
                  onclick={() => warmNavEvent(item)}
                >{formatRelativeTime(item.created_at)}</a>
                {#if !reactionRow && !boostRow}
                  <span class="feed-kind muted">{kindDescription(item.kind)}</span>
                {/if}
              </div>
              {#if boostRow}
                {#if boostExcerpt}
                  <p class="feed-preview feed-boost-excerpt">{cropRenderedUrlsInText(boostExcerpt)}</p>
                {/if}
              {:else}
                <div class="feed-body">
                  {#if shown[item.id]}
                    <EventBody event={item} />
                  {:else}
                    <p class="feed-preview">{rowText(item)}</p>
                  {/if}
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</main>

<style>
  .feed-back {
    margin: 0 0 0.75rem;
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
  }
  .feed-row {
    display: flex;
    flex-direction: column;
    max-height: 500px;
    padding: 0.55rem 0.75rem;
  }
  .feed-row-oneline {
    max-height: none;
    padding: 0.4rem 0.75rem;
  }
  .feed-row-boost {
    max-height: none;
    padding: 0.45rem 0.75rem;
    background: color-mix(in srgb, var(--paper-light) 82%, var(--accent));
    border-color: color-mix(in srgb, var(--accent) 28%, var(--rule));
  }
  .feed-boost-label {
    flex: 0 0 auto;
    font-size: 0.78rem;
    font-weight: 650;
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--accent) 70%, var(--ink));
  }
  .feed-boost-excerpt {
    margin-top: 0.2rem;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    opacity: 0.88;
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
