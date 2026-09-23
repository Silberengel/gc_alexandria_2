<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import CommentThread from './CommentThread.svelte';
  import { session } from '$lib/stores/session';
  import { signAndPublish } from '$lib/sign';
  import { commentDraft } from '$lib/drafts';
  import type { ThreadNode } from '$lib/comments';
  import { threadNodeKey } from '$lib/comments';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import HeartButton from './HeartButton.svelte';
  import { openLoginDialog } from '$lib/stores/login-ui';

  interface Props {
    node: ThreadNode;
    target: Event;
    /** Shared across the thread — only one reply composer open at a time. */
    replyOpenId?: string | null;
    /** When set, highlight/scroll target for deep links (?comment=). */
    focusId?: string;
  }

  let { node, target, replyOpenId = $bindable(null), focusId = '' }: Props = $props();
  let reply = $state('');
  let posting = $state(false);

  const open = $derived(
    !!node.event && !!replyOpenId && replyOpenId.toLowerCase() === node.event.id.toLowerCase()
  );
  const relative = $derived(node.event ? formatRelativeTime(node.event.created_at) : '');
  const absolute = $derived(node.event ? formatAbsoluteTime(node.event.created_at) : '');
  const signedIn = $derived(!!$session.pubkey);
  const canReply = $derived(signedIn);

  async function sendReply(): Promise<void> {
    if (!node.event || !canReply) return;
    if (!reply.trim() || posting) return;
    posting = true;
    try {
      const signed = await signAndPublish(commentDraft(target, reply.trim(), node.event));
      if (signed) {
        node.children = [...node.children, { event: signed, placeholder: null, children: [] }];
        reply = '';
        replyOpenId = null;
      }
    } finally {
      posting = false;
    }
  }

  function onReplyClick(): void {
    if (!canReply) {
      openLoginDialog();
      return;
    }
    if (!node.event) return;
    const id = node.event.id.toLowerCase();
    replyOpenId = replyOpenId?.toLowerCase() === id ? null : id;
  }
</script>

<li
  class="thread-node"
  class:thread-node-focus={!!node.event && !!focusId && node.event.id.toLowerCase() === focusId.toLowerCase()}
  id={node.event ? `comment-${node.event.id.toLowerCase()}` : undefined}
>
  {#if node.placeholder}
    <p class="muted">{node.placeholder}</p>
  {:else if node.event}
    <div class="thread-head">
      <UserBadge pubkey={node.event.pubkey} />
      {#if relative}
        <time
          class="thread-time muted"
          datetime={new Date(node.event.created_at * 1000).toISOString()}
          title={absolute}>{relative}</time
        >
      {/if}
    </div>
    <div class="thread-body">
      <EventBody event={node.event} />
    </div>
    <div class="thread-actions">
      <HeartButton event={node.event} />
      <button
        class="btn btn-icon icon-action-btn thread-reply"
        type="button"
        aria-label={canReply ? (open ? 'Cancel reply' : 'Reply') : 'Sign in to reply'}
        title={canReply ? (open ? 'Cancel reply' : 'Reply') : 'Sign in to reply'}
        aria-expanded={open}
        onclick={onReplyClick}
      >
        {#if open}
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
    </div>
    {#if open && canReply}
      <form class="compose" onsubmit={(e) => { e.preventDefault(); void sendReply(); }}>
        <textarea bind:value={reply} rows="3" placeholder="Write a reply"></textarea>
        <button class="btn btn-primary" type="submit" disabled={posting || !reply.trim()}>Post</button>
      </form>
    {/if}
  {/if}
  {#if node.children.length}
    <ul class="thread-children">
      {#each node.children as child (threadNodeKey(child))}
        <CommentThread node={child} {target} bind:replyOpenId {focusId} />
      {/each}
    </ul>
  {/if}
</li>
