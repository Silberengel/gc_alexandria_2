<script lang="ts">
  import type { Snippet } from 'svelte';
  import { untrack } from 'svelte';
  import type { Event } from 'nostr-tools';
  import HeartButton from './HeartButton.svelte';
  import TipButton from './TipButton.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import CommentThread from './CommentThread.svelte';
  import EventCard from './EventCard.svelte';
  import ThreadRefBadges from './ThreadRefBadges.svelte';
  import ThreadCompose from './ThreadCompose.svelte';
  import { session } from '$lib/stores/session';
  import { publishComment } from '$lib/sign';
  import { commentDraft } from '$lib/drafts';
  import {
    canOfferKind1Reply,
    fetchWorkResponses,
    nestComments,
    stableThreadNode,
    threadNodeKey,
    threadRootKeys,
    type ThreadNode,
    type WorkResponses
  } from '$lib/comments';
  import { muteState, filterMuted } from '$lib/mute';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import LoadingHint from './LoadingHint.svelte';

  interface Props {
    event: Event;
    /** When true, show reply control (kind 1111 onto this event). */
    allowReply?: boolean;
    /** Extra controls in the heart/reply row (e.g. jump-to-rating). */
    actions?: Snippet;
  }

  let { event, allowReply = false, actions }: Props = $props();

  let replyOpen = $state(false);
  let replyText = $state('');
  let replyImeta = $state<string[][]>([]);
  let posting = $state(false);
  let asKind1Reply = $state(false);
  let thread = $state<ThreadNode[]>([]);
  /** Flat thread events, including ones just written to cache. */
  let threadSource = $state<Event[]>([]);
  let quotes = $state<Event[]>([]);
  let other = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let zaps = $state<Event[]>([]);
  let boosts = $state<Event[]>([]);
  let replyOpenId = $state<string | null>(null);
  const quoteNodes = new Map<string, ThreadNode>();
  let threadLoaded = $state(false);
  /** Bumps when the target event changes; drops stale thread paints. */
  let threadGen = 0;

  const signedIn = $derived(!!$session.pubkey);
  const canReply = $derived(signedIn);
  const offerKind1 = $derived(canOfferKind1Reply(event));

  // Only re-fetch when the target event / allowReply changes — never when the
  // thread finishes loading. Reading threadLoaded inside ensureThread used to
  // register it as an $effect dependency, so cache hits after a like turned
  // into a tight remount storm (Firefox "Script terminated by timeout").
  $effect(() => {
    if (!allowReply) return;
    const targetId = event.id;
    const gen = ++threadGen;
    untrack(() => {
      threadLoaded = false;
      thread = [];
      threadSource = [];
      quotes = [];
      other = [];
      highlights = [];
      zaps = [];
      boosts = [];
      replyOpen = false;
      replyOpenId = null;
      asKind1Reply = false;
    });
    void ensureThread(targetId, gen);
  });

  async function ensureThread(targetId: string, gen: number): Promise<void> {
    // gen (not threadLoaded) is the stale-paint gate — avoid tracking threadLoaded.
    if (untrack(() => threadLoaded) && gen === threadGen) return;
    const target = untrack(() => event);
    if (target.id !== targetId) return;
    const hit: WorkResponses = await fetchWorkResponses(target, 40, (cached) => {
      if (gen !== threadGen || untrack(() => event.id) !== targetId) return;
      applyHit(cached, target);
    });
    if (gen !== threadGen || untrack(() => event.id) !== targetId) return;
    const localOnly = untrack(() =>
      threadSource.filter((existing) => !hit.thread.some((remote) => remote.id === existing.id))
    );
    applyHit(
      {
        ...hit,
        thread: [...hit.thread, ...localOnly]
      },
      target
    );
  }

  function applyHit(hit: WorkResponses, target: Event): void {
    threadSource = hit.thread;
    thread = nestComments(threadSource, $muteState, threadRootKeys(target));
    quotes = filterMuted(hit.quotes, $muteState);
    other = filterMuted(hit.other, $muteState);
    highlights = filterMuted(hit.highlights, $muteState);
    zaps = hit.zaps;
    boosts = hit.boosts;
    threadLoaded = true;
  }

  function showPublished(published: Event): void {
    threadSource = [...threadSource.filter((existing) => existing.id !== published.id), published];
    thread = nestComments(threadSource, $muteState, threadRootKeys(event));
    threadLoaded = true;
  }

  function onReplyClick(): void {
    if (!canReply) {
      openLoginDialog();
      return;
    }
    replyOpen = !replyOpen;
    if (replyOpen) void ensureThread(event.id, threadGen);
  }

  async function sendRootReply(): Promise<boolean> {
    if (!canReply || posting || !replyText.trim()) return false;
    posting = true;
    try {
      const partial = commentDraft(event, replyText.trim(), undefined, {
        asKind1Reply: offerKind1 && asKind1Reply
      });
      const published = await publishComment({
        ...partial,
        tags: [...partial.tags, ...replyImeta.map((row) => [...row])]
      });
      if (!published) return false;
      showPublished(published);
      replyText = '';
      replyImeta = [];
      replyOpen = false;
      asKind1Reply = false;
      return true;
    } finally {
      posting = false;
    }
  }

  const rootReplyDraftScope = $derived(`comment:${event.id.toLowerCase()}`);
</script>

<div class="event-social">
  <div class="event-social-actions">
    <TipButton {event} />
    <HeartButton {event} />
    <ThreadRefBadges {event} {zaps} {boosts} />
    {#if allowReply}
      <button
        class="btn btn-icon icon-action-btn thread-reply"
        type="button"
        aria-label={canReply ? (replyOpen ? 'Cancel reply' : 'Reply') : 'Sign in to reply'}
        title={canReply ? (replyOpen ? 'Cancel reply' : 'Reply') : 'Sign in to reply'}
        aria-expanded={replyOpen}
        onclick={onReplyClick}
      >
        {#if replyOpen}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            />
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
            />
          </svg>
        {/if}
      </button>
    {/if}
    {@render actions?.()}
    {#if allowReply}
      <CopyPointerButton {event} class="thread-more" />
    {/if}
  </div>
  <div class="event-social-rest">
  {#if allowReply && canReply && replyOpen}
    <ThreadCompose
      bind:value={replyText}
      bind:imetaTags={replyImeta}
      bind:asKind1Reply
      draftScope={rootReplyDraftScope}
      placeholder="Write a reply"
      {posting}
      {offerKind1}
      onSubmit={() => sendRootReply()}
      onCancel={() => (replyOpen = false)}
    />
  {/if}
  {#if allowReply && replyOpen && !threadLoaded}
    <LoadingHint message="Loading replies…" compact />
  {/if}
  {#if allowReply && thread.length}
    <ul class="thread-list event-social-thread">
      {#each thread as node (threadNodeKey(node))}
        <CommentThread
          {node}
          target={event}
          bind:replyOpenId
          onPublished={showPublished}
          {highlights}
          {zaps}
          {boosts}
        />
      {/each}
    </ul>
  {/if}
  {#if allowReply && quotes.length}
    <h3 class="work-comments-subhead">Quotes</h3>
    <ul class="thread-list">
      {#each quotes as q (q.id)}
        <CommentThread
          node={stableThreadNode(quoteNodes, q)}
          target={event}
          bind:replyOpenId
          onPublished={showPublished}
          {highlights}
          {zaps}
          {boosts}
          lineEmbeds
        />
      {/each}
    </ul>
  {/if}
  {#if allowReply && other.length}
    <h3 class="work-comments-subhead">Other responses</h3>
    <ul class="thread-list work-response-list">
      {#each other as item (item.id)}
        <li class="work-response-item">
          <EventCard event={item} />
        </li>
      {/each}
    </ul>
  {/if}
  </div>
</div>
