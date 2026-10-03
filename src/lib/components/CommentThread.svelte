<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import CommentThread from './CommentThread.svelte';
  import ThreadCompose from './ThreadCompose.svelte';
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
    replyOpenId?: string | null;
    focusId?: string;
    onPublished?: (event: Event) => void;
    highlights?: Event[];
    zaps?: Event[];
    boosts?: Event[];
  }

  let {
    node,
    target,
    replyOpenId = $bindable(null),
    focusId = '',
    onPublished,
    highlights = [],
    zaps = [],
    boosts = []
  }: Props = $props();

  let reply = $state('');
  let posting = $state(false);
  let asKind1Reply = $state(false);

  const event = $derived(node.event);
  const focused = $derived(
    !!event && !!focusId && event.id.toLowerCase() === focusId.toLowerCase()
  );
  const open = $derived(!!event && !!replyOpenId && replyOpenId.toLowerCase() === event.id.toLowerCase());
  const relative = $derived(event ? formatRelativeTime(event.created_at) : '');
  const absolute = $derived(event ? formatAbsoluteTime(event.created_at) : '');
  const canReply = $derived(!!$session.pubkey);
  const offerKind1 = $derived(!!event && canOfferKind1Reply(event));
  const highlightQuotes = $derived(
    event ? textHighlightsFromEvents(highlightsForEvent(highlights, event)) : []
  );

  async function sendReply(): Promise<void> {
    if (!event || !canReply || !reply.trim() || posting) return;
    posting = true;
    try {
      const published = await publishComment(
        commentDraft(target, reply.trim(), event, { asKind1Reply: offerKind1 && asKind1Reply })
      );
      if (!published) return;
      if (onPublished) onPublished(published);
      else node.children = [...node.children, { event: published, placeholder: null, children: [] }];
      reply = '';
      asKind1Reply = false;
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
    if (!event) return;
    const id = event.id.toLowerCase();
    replyOpenId = replyOpenId?.toLowerCase() === id ? null : id;
  }
</script>

<li
  class="thread-node"
  class:thread-node-focus={focused}
  id={event ? `comment-${event.id.toLowerCase()}` : undefined}
>
  {#if node.placeholder}
    <p class="muted">{node.placeholder}</p>
  {:else if event}
    <div class="thread-head">
      <UserBadge pubkey={event.pubkey} />
      {#if relative}
        <time
          class="thread-time muted"
          datetime={new Date(event.created_at * 1000).toISOString()}
          title={absolute}>{relative}</time
        >
      {/if}
    </div>
    <div class="thread-body">
      <EventBody {event} quotes={highlightQuotes} />
    </div>
    <div class="thread-actions">
      <HeartButton {event} />
      <ThreadRefBadges {event} {zaps} {boosts} />
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
      <CopyPointerButton {event} class="thread-more" />
    </div>
    {#if open && canReply}
      <ThreadCompose
        bind:value={reply}
        bind:asKind1Reply
        placeholder="Write a reply"
        {posting}
        {offerKind1}
        onSubmit={() => void sendReply()}
      />
    {/if}
  {/if}
  {#if node.children.length}
    <ul class="thread-children">
      {#each node.children as child (threadNodeKey(child))}
        <CommentThread
          node={child}
          {target}
          bind:replyOpenId
          {focusId}
          {onPublished}
          {highlights}
          {zaps}
          {boosts}
        />
      {/each}
    </ul>
  {/if}
</li>
