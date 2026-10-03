<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import CommentThread from './CommentThread.svelte';
  import { session } from '$lib/stores/session';
  import { publishComment } from '$lib/sign';
  import { commentDraft } from '$lib/drafts';
  import type { ThreadNode } from '$lib/comments';
  import { canOfferKind1Reply, highlightsForEvent, threadNodeKey } from '$lib/comments';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import HeartButton from './HeartButton.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import ThreadRefBadges from './ThreadRefBadges.svelte';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { textHighlightsFromEvents } from '$lib/text-highlights';

  interface Props {
    node: ThreadNode;
    target: Event;
    /** Shared across the thread — only one reply composer open at a time. */
    replyOpenId?: string | null;
    /** When set, highlight/scroll target for deep links (?comment=). */
    focusId?: string;
    /** Insert a relay-accepted comment into the parent thread (from cache). */
    onPublished?: (event: Event) => void;
    highlights?: Event[];
    zaps?: Event[];
    boosts?: Event[];
  }

  let { node, target, replyOpenId = $bindable(null), focusId = '', onPublished, highlights = [], zaps = [], boosts = [] }: Props = $props();
  let reply = $state('');
  let posting = $state(false);
  let asKind1Reply = $state(false);

  const open = $derived(
    !!node.event && !!replyOpenId && replyOpenId.toLowerCase() === node.event.id.toLowerCase()
  );
  const relative = $derived(node.event ? formatRelativeTime(node.event.created_at) : '');
  const absolute = $derived(node.event ? formatAbsoluteTime(node.event.created_at) : '');
  const signedIn = $derived(!!$session.pubkey);
  const canReply = $derived(signedIn);

  const offerKind1 = $derived(!!node.event && canOfferKind1Reply(node.event));
  const highlightQuotes = $derived(
    node.event ? textHighlightsFromEvents(highlightsForEvent(highlights, node.event)) : []
  );

  async function sendReply(): Promise<void> {
    if (!node.event || !canReply) return;
    if (!reply.trim() || posting) return;
    posting = true;
    try {
      const published = await publishComment(
        commentDraft(target, reply.trim(), node.event, { asKind1Reply: offerKind1 && asKind1Reply })
      );
      if (!published) return;
      if (onPublished) onPublished(published);
      else node.children = [...node.children, { event: published, placeholder: null, children: [] }];
      reply = '';
      replyOpenId = null;
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
      <EventBody event={node.event} quotes={highlightQuotes} />
    </div>
    <div class="thread-actions">
      <HeartButton event={node.event} />
      <ThreadRefBadges event={node.event} {zaps} {boosts} />
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
      <CopyPointerButton event={node.event} class="thread-more" />
    </div>
    {#if open && canReply}
      <form class="compose" onsubmit={(e) => { e.preventDefault(); void sendReply(); }}>
        <textarea bind:value={reply} rows="3" placeholder="Write a reply"></textarea>
        {#if offerKind1}
          <label class="compose-kind1">
            <input type="checkbox" bind:checked={asKind1Reply} />
            Also post as a kind 1 reply
          </label>
        {/if}
        <button class="btn btn-primary" type="submit" disabled={posting || !reply.trim()}
          >{posting ? 'Posting…' : 'Post'}</button
        >
      </form>
    {/if}
  {/if}
  {#if node.children.length}
    <ul class="thread-children">
      {#each node.children as child (threadNodeKey(child))}
        <CommentThread node={child} {target} bind:replyOpenId {focusId} {onPublished} {highlights} {zaps} {boosts} />
      {/each}
    </ul>
  {/if}
</li>
