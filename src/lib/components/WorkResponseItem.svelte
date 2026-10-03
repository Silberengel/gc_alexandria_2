<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import HeartButton from './HeartButton.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import { KIND } from '$lib/constants';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const relative = $derived(formatRelativeTime(event.created_at));
  const absolute = $derived(formatAbsoluteTime(event.created_at));
  const isHighlight = $derived(event.kind === KIND.HIGHLIGHT);
  const excerpt = $derived(event.content.trim());
</script>

<li class="work-response-item" class:work-response-highlight={isHighlight}>
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
  {#if isHighlight && excerpt}
    <p class="work-response-quote">“{excerpt}”</p>
  {:else if excerpt}
    <div class="work-response-body">
      <EventBody {event} />
    </div>
  {/if}
  <div class="thread-actions">
    <HeartButton {event} />
    <CopyPointerButton {event} class="thread-more" />
  </div>
</li>
