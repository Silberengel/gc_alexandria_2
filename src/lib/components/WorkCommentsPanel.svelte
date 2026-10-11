<script lang="ts">
  import type { Event } from 'nostr-tools';
  import CommentThread from './CommentThread.svelte';
  import ThreadCompose from './ThreadCompose.svelte';
  import EmbedEventLine from './EmbedEventLine.svelte';
  import EventCard from './EventCard.svelte';
  import {
    canOfferKind1Reply,
    nestComments,
    threadNodeKey,
    threadRootKeys,
    type WorkResponses
  } from '$lib/comments';
  import { muteState, filterMuted } from '$lib/mute';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { closeOpCompose, opComposeId, opReplyToolbar, toggleOpCompose } from '$lib/stores/op-reply';
  import { publishComment } from '$lib/sign';
  import { commentDraft } from '$lib/drafts';
  import LoadingHint from './LoadingHint.svelte';

  interface Props {
    target: Event;
    responses: WorkResponses;
    /** Deep-link focus for ?comment= */
    focusId?: string;
    /** Show the leave-a-comment compose controls. */
    allowCompose?: boolean;
    /** Optional heading override (default Comments). */
    title?: string;
    /** True while the parent is still fetching this thread. */
    loading?: boolean;
  }

  let {
    target,
    responses,
    focusId = '',
    allowCompose = true,
    title = 'Comments',
    loading = false
  }: Props = $props();

  let replyOpenId = $state<string | null>(null);
  let commentText = $state('');
  let composeEl = $state<HTMLDivElement | null>(null);
  let localThread = $state<Event[]>([]);
  let posting = $state(false);
  let asKind1Reply = $state(false);

  const threadEvents = $derived(
    filterMuted([...responses.thread, ...localThread], $muteState)
  );
  const quotes = $derived(filterMuted(responses.quotes ?? [], $muteState));
  const other = $derived(filterMuted(responses.other ?? [], $muteState));
  const highlights = $derived(filterMuted(responses.highlights ?? [], $muteState));
  const zaps = $derived(responses.zaps ?? []);
  const boosts = $derived(responses.boosts ?? []);
  const thread = $derived(nestComments(threadEvents, $muteState, threadRootKeys(target)));
  const offerKind1 = $derived(canOfferKind1Reply(target));
  const commentComposeOpen = $derived($opComposeId === target.id.toLowerCase());
  const replyOnToolbar = $derived($opReplyToolbar.has(target.id.toLowerCase()));

  $effect(() => {
    if (replyOpenId) closeOpCompose(target.id);
  });

  $effect(() => {
    if (!commentComposeOpen) return;
    replyOpenId = null;
    composeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  function showPublished(event: Event): void {
    localThread = [...localThread.filter((e) => e.id !== event.id), event];
  }

  async function postComment(): Promise<void> {
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    if (!commentText.trim() || posting) return;
    posting = true;
    try {
      const published = await publishComment(
        commentDraft(target, commentText.trim(), undefined, { asKind1Reply: offerKind1 && asKind1Reply })
      );
      if (!published) return;
      showPublished(published);
      commentText = '';
      closeOpCompose(target.id);
      asKind1Reply = false;
    } finally {
      posting = false;
    }
  }
</script>

<section class="work-comments-panel">
  <h2 class="section-title">{title}</h2>

  {#if allowCompose}
    {#if $session.pubkey && commentComposeOpen}
      <div class="op-reply-compose" bind:this={composeEl}>
        <ThreadCompose
          bind:value={commentText}
          bind:asKind1Reply
          {posting}
          {offerKind1}
          onSubmit={() => void postComment()}
          onCancel={() => closeOpCompose(target.id)}
        />
      </div>
    {:else if !replyOnToolbar && !replyOpenId}
      <button
        class="btn btn-icon icon-action-btn thread-reply"
        type="button"
        aria-label={$session.pubkey ? 'Reply' : 'Sign in to reply'}
        title={$session.pubkey ? 'Reply' : 'Sign in to reply'}
        onclick={() => ($session.pubkey ? toggleOpCompose(target.id) : openLoginDialog())}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
          />
        </svg>
      </button>
    {/if}
  {/if}

  {#if thread.length}
    <ul class="thread-list">
      {#each thread as node (threadNodeKey(node))}
        <CommentThread
          {node}
          {target}
          bind:replyOpenId
          focusId={focusId}
          onPublished={showPublished}
          {highlights}
          {zaps}
          {boosts}
        />
      {/each}
    </ul>
  {:else if loading}
    <LoadingHint message="Loading comments…" compact />
  {:else}
    <p class="muted">No comments yet.</p>
  {/if}

  {#if quotes.length}
    <h3 class="work-comments-subhead">Quotes</h3>
    <p class="muted work-comments-lede">Notes that quote this work.</p>
    <ul class="thread-list work-response-list">
      {#each quotes as event (event.id)}
        <li class="work-response-item">
          <EmbedEventLine {event} />
        </li>
      {/each}
    </ul>
  {/if}

  {#if other.length}
    <h3 class="work-comments-subhead">Other responses</h3>
    <ul class="thread-list work-response-list">
      {#each other as event (event.id)}
        <li class="work-response-item">
          <EventCard {event} />
        </li>
      {/each}
    </ul>
  {/if}
</section>
