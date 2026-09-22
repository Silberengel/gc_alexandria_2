<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import CommentThread from './CommentThread.svelte';
  import { session } from '$lib/stores/session';
  import { signAndPublish } from '$lib/sign';
  import { commentDraft } from '$lib/drafts';
  import type { ThreadNode } from '$lib/comments';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';

  interface Props {
    node: ThreadNode;
    target: Event;
    /** Shared across the thread — only one reply composer open at a time. */
    replyOpenId?: string | null;
  }

  let { node, target, replyOpenId = $bindable(null) }: Props = $props();
  let reply = $state('');
  let posting = $state(false);

  const open = $derived(!!node.event && replyOpenId === node.event.id);
  const relative = $derived(node.event ? formatRelativeTime(node.event.created_at) : '');
  const absolute = $derived(node.event ? formatAbsoluteTime(node.event.created_at) : '');

  async function sendReply(): Promise<void> {
    if (!node.event) return;
    if (!$session.pubkey) {
      await session.signIn();
      return;
    }
    if (!reply.trim()) return;
    posting = true;
    const signed = await signAndPublish(commentDraft(target, reply.trim(), node.event));
    posting = false;
    if (signed) {
      node.children = [...node.children, { event: signed, placeholder: null, children: [] }];
      reply = '';
      replyOpenId = null;
    }
  }

  async function onReplyClick(): Promise<void> {
    if (!$session.pubkey) {
      await session.signIn();
      return;
    }
    if (!node.event) return;
    replyOpenId = replyOpenId === node.event.id ? null : node.event.id;
  }
</script>

<li class="thread-node">
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
      <button
        class="btn btn-icon thread-reply"
        type="button"
        aria-label={$session.pubkey ? (open ? 'Cancel reply' : 'Reply') : 'Sign in to reply'}
        title={$session.pubkey ? (open ? 'Cancel reply' : 'Reply') : 'Sign in to reply'}
        aria-expanded={open}
        onclick={() => void onReplyClick()}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
          />
        </svg>
      </button>
    </div>
    {#if open}
      <form class="compose" onsubmit={(e) => { e.preventDefault(); void sendReply(); }}>
        <textarea bind:value={reply} rows="3" placeholder="Write a reply"></textarea>
        <button class="btn btn-primary" type="submit" disabled={posting || !reply.trim()}>Post</button>
      </form>
    {/if}
  {/if}
  {#if node.children.length}
    <ul class="thread-children">
      {#each node.children as child (child.event?.id ?? child.placeholder)}
        <CommentThread node={child} {target} bind:replyOpenId />
      {/each}
    </ul>
  {/if}
</li>
