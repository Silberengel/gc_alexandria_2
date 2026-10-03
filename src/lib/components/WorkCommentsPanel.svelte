<script lang="ts">
  import type { Event } from 'nostr-tools';
  import CommentThread from './CommentThread.svelte';
  import ThreadCompose from './ThreadCompose.svelte';
  import WorkResponseItem from './WorkResponseItem.svelte';
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
  let commentComposeOpen = $state(false);
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
      commentComposeOpen = false;
      asKind1Reply = false;
    } finally {
      posting = false;
    }
  }
</script>

<section class="work-comments-panel">
  <h2 class="section-title">{title}</h2>

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

  {#if allowCompose}
    {#if $session.pubkey && !replyOpenId && commentComposeOpen}
      <ThreadCompose
        bind:value={commentText}
        bind:asKind1Reply
        {posting}
        {offerKind1}
        showCancel
        onSubmit={() => void postComment()}
        onCancel={() => {
          commentComposeOpen = false;
          commentText = '';
          asKind1Reply = false;
        }}
      />
    {:else if $session.pubkey && !replyOpenId}
      <button class="btn" type="button" onclick={() => (commentComposeOpen = true)}
        >Leave a comment</button
      >
    {:else if !$session.pubkey}
      <button class="btn" type="button" onclick={() => openLoginDialog()}>Sign in to comment</button>
    {/if}
  {/if}

  {#if quotes.length}
    <h3 class="work-comments-subhead">Quotes</h3>
    <p class="muted work-comments-lede">Notes that quote this work.</p>
    <ul class="thread-list work-response-list">
      {#each quotes as event (event.id)}
        <WorkResponseItem {event} />
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
