<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Event } from 'nostr-tools';
  import HeartButton from './HeartButton.svelte';
  import CommentThread from './CommentThread.svelte';
  import { session } from '$lib/stores/session';
  import { signAndPublish } from '$lib/sign';
  import { commentDraft } from '$lib/drafts';
  import { fetchThreadEvents, nestComments, threadNodeKey, type ThreadNode } from '$lib/comments';
  import { muteState } from '$lib/mute';

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
  let posting = $state(false);
  let thread = $state<ThreadNode[]>([]);
  let replyOpenId = $state<string | null>(null);
  let threadLoaded = $state(false);

  const signedIn = $derived(!!$session.pubkey);
  const canReply = $derived(signedIn);

  async function ensureThread(): Promise<void> {
    if (threadLoaded) return;
    const events = await fetchThreadEvents(event, 30);
    thread = nestComments(events, $muteState, [event.id]);
    threadLoaded = true;
  }

  function onReplyClick(): void {
    if (!canReply) return;
    replyOpen = !replyOpen;
    if (replyOpen) void ensureThread();
  }

  async function sendRootReply(): Promise<void> {
    if (!canReply || posting || !replyText.trim()) return;
    posting = true;
    try {
      const signed = await signAndPublish(commentDraft(event, replyText.trim()));
      if (signed) {
        thread = [
          ...thread,
          { event: signed, placeholder: null, children: [] }
        ];
        replyText = '';
        replyOpen = false;
        threadLoaded = true;
      }
    } finally {
      posting = false;
    }
  }
</script>

<div class="event-social">
  <div class="event-social-actions">
    <HeartButton {event} />
    {#if allowReply}
      <button
        class="btn btn-icon thread-reply"
        type="button"
        disabled={!canReply}
        aria-label={canReply ? (replyOpen ? 'Cancel reply' : 'Reply') : 'Sign in to reply'}
        title={canReply ? (replyOpen ? 'Cancel reply' : 'Reply') : 'Sign in to reply'}
        aria-expanded={replyOpen}
        onclick={onReplyClick}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
          />
        </svg>
      </button>
    {/if}
    {@render actions?.()}
  </div>
  {#if allowReply && canReply && replyOpen}
    <form class="compose" onsubmit={(e) => { e.preventDefault(); void sendRootReply(); }}>
      <textarea bind:value={replyText} rows="2" placeholder="Write a reply"></textarea>
      <button class="btn btn-primary" type="submit" disabled={posting || !replyText.trim()}>Post</button>
    </form>
  {/if}
  {#if allowReply && thread.length}
    <ul class="thread-list event-social-thread">
      {#each thread as node (threadNodeKey(node))}
        <CommentThread {node} target={event} bind:replyOpenId />
      {/each}
    </ul>
  {/if}
</div>
