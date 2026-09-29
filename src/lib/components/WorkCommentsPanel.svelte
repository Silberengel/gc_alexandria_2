<script lang="ts">
  import type { Event } from 'nostr-tools';
  import CommentThread from './CommentThread.svelte';
  import WorkResponseItem from './WorkResponseItem.svelte';
  import {
    nestComments,
    threadNodeKey,
    type WorkResponses
  } from '$lib/comments';
  import { muteState, filterMuted } from '$lib/mute';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { signAndPublish } from '$lib/sign';
  import { commentDraft } from '$lib/drafts';

  interface Props {
    target: Event;
    responses: WorkResponses;
    /** Deep-link focus for ?comment= */
    focusId?: string;
    /** Show the leave-a-comment compose controls. */
    allowCompose?: boolean;
    /** Optional heading override (default Comments). */
    title?: string;
  }

  let {
    target,
    responses,
    focusId = '',
    allowCompose = true,
    title = 'Comments'
  }: Props = $props();

  let replyOpenId = $state<string | null>(null);
  let commentText = $state('');
  let commentComposeOpen = $state(false);
  let localThread = $state<Event[]>([]);

  const threadEvents = $derived(
    filterMuted([...responses.thread, ...localThread], $muteState)
  );
  const quotes = $derived(filterMuted(responses.quotes, $muteState));
  const thread = $derived(nestComments(threadEvents, $muteState, [target.id]));

  async function postComment(): Promise<void> {
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    if (!commentText.trim()) return;
    const signed = await signAndPublish(commentDraft(target, commentText.trim()));
    if (signed) {
      localThread = [...localThread, signed];
      commentText = '';
      commentComposeOpen = false;
    }
  }
</script>

<section class="work-comments-panel">
  <h2 class="section-title">{title}</h2>

  {#if thread.length}
    <ul class="thread-list">
      {#each thread as node (threadNodeKey(node))}
        <CommentThread {node} {target} bind:replyOpenId focusId={focusId} />
      {/each}
    </ul>
  {:else}
    <p class="muted">No comments yet.</p>
  {/if}

  {#if allowCompose}
    {#if $session.pubkey && !replyOpenId && commentComposeOpen}
      <form class="compose" onsubmit={(e) => { e.preventDefault(); void postComment(); }}>
        <textarea bind:value={commentText} rows="3" placeholder="Write a comment"></textarea>
        <div class="compose-actions">
          <button class="btn btn-primary" type="submit" disabled={!commentText.trim()}>Post</button>
          <button
            class="btn"
            type="button"
            onclick={() => {
              commentComposeOpen = false;
              commentText = '';
            }}>Cancel</button
          >
        </div>
      </form>
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
</section>
