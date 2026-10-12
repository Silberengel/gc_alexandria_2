<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { untrack } from 'svelte';
  import { link, querystring } from 'svelte-spa-router';
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
  import { filterMuted, muteState } from '$lib/mute';
  import { eventPreview } from '$lib/event-preview';
  import { kindDescription } from '$lib/kind-label';
  import { libraryDocumentPath } from '$lib/metadata';
  import {
  decodeFeedPointer,
  feedFollowAuthors,
  feedRelayGroups,
  feedThreadPath,
  fetchFeedEvent,
  keepFeedPosts,
  loadFeed
} from '$lib/feed';
  import { takePendingNavEvent, warmNavEvent } from '$lib/nav-warm';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import { session } from '$lib/stores/session';
  import { getSelectorContext, onSelectorContext } from '$lib/nostr/selector';
  import { textHighlightsFromEvents } from '$lib/text-highlights';

  let { params = {} }: { params?: { id?: string } } = $props();

  const pointer = $derived(params.id ? decodeFeedPointer(params.id) : null);
  const signedIn = $derived(!!$session.pubkey);
  let metadataEvents = $state<Event[]>([]);
  const lede = $derived.by(() => {
    void $session.pubkey;
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

  let items = $state<Event[]>([]);
  const visibleItems = $derived(filterMuted(items, $muteState));
  let listLoading = $state(true);
  /** True only after a load finishes once the viewer's relay lists are in place. */
  let listSettled = $state(false);
  let listError = $state('');
  let feedRelays = $state(0);
  /** Rows in view. Each one renders its body and embedded cards; the rest stay a preview. */
  let shown = $state<Record<string, true>>({});

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
    const preview = eventPreview(item);
    const text =
      item.kind === KIND.TEXT_NOTE
        ? preview.body || preview.summary || 'Note'
        : preview.body
          ? `${preview.headline} — ${preview.body}`
          : preview.headline;
    return cropRenderedUrlsInText(text);
  }

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
    const pubkey = $session.pubkey;
    const sessionLoading = $session.loading;
    const meta = metadataEvents;
    const muted = $muteState;
    let cancelled = false;
    listError = '';
    // An empty reply must not become "no posts" while lists are still loading,
    // and must not wipe posts that are already on screen.
    if (!untrack(() => items.length)) {
      listLoading = true;
      listSettled = false;
    }
    if (pubkey && sessionLoading && !feedRelayGroups().personal.length) {
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
    void (async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt += 1) {
        try {
          const events = await loadFeed(meta, muted, (cached) => {
            if (cancelled || !cached.length) return;
            items = keepFeedPosts(items, cached);
            listLoading = false;
          });
          if (cancelled) return;
          items = keepFeedPosts(items, events);
          if (items.length) {
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
      if (cancelled || items.length) return;
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
    {#if !visibleItems.length && listError}
      <p class="muted">{listError}</p>
    {:else if !visibleItems.length && !listSettled}
      <LoadingHint message="Loading original posts…" />
    {:else if !visibleItems.length}
      <p class="muted">No original posts here yet.</p>
    {:else}
      <ul class="feed-list">
        {#each visibleItems as item (item.id)}
          <li class="card feed-row" use:watchRow={item.id}>
            <div
              class="feed-hit"
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
                <UserBadge pubkey={item.pubkey} />
                <a
                  class="thread-time muted"
                  href={`#${feedThreadPath(item)}`}
                  use:link
                  title={formatAbsoluteTime(item.created_at)}
                  onclick={() => warmNavEvent(item)}
                >{formatRelativeTime(item.created_at)}</a>
                <span class="feed-kind muted">{kindDescription(item.kind)}</span>
              </div>
              <div class="feed-body">
                {#if shown[item.id]}
                  <EventBody event={item} />
                {:else}
                  <p class="feed-preview">{rowText(item)}</p>
                {/if}
              </div>
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
  .feed-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 40rem;
  }
  .feed-row {
    display: flex;
    flex-direction: column;
    max-height: 500px;
    /* Same inset the note already has above the author. Clipping stays inside it. */
    padding: 1.85rem 2.05rem;
  }
  .feed-hit {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 4.5rem;
    min-width: 0;
    overflow: hidden;
    cursor: pointer;
  }
  .feed-kind {
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .feed-body {
    flex: 1;
    margin-top: 0.45rem;
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
