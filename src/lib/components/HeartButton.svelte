<script lang="ts">
  import { onMount } from 'svelte';
  import type { Event } from 'nostr-tools';
  import { session } from '$lib/stores/session';
  import { signAndPublish } from '$lib/sign';
  import { deletionDraft } from '$lib/drafts';
  import {
    fetchReactionsForIds,
    likeCount,
    myLikeReaction,
    reactionDraft,
    reactionTargetsId
  } from '$lib/reactions';

  interface Props {
    event: Event;
    /** Optional preloaded reactions; when omitted, fetches for this event. */
    reactions?: Event[];
  }

  let { event, reactions: reactionsProp }: Props = $props();

  let local = $state<Event[]>([]);
  let busy = $state(false);
  let loaded = $state(false);

  const reactions = $derived(
    (reactionsProp ?? local).filter((r) => reactionTargetsId(r, event.id))
  );
  const count = $derived(likeCount(reactions));
  const mine = $derived(myLikeReaction(reactions, $session.pubkey));
  const liked = $derived(!!mine);
  const signedIn = $derived(!!$session.pubkey);
  const ownEvent = $derived(
    !!$session.pubkey && $session.pubkey.toLowerCase() === event.pubkey.toLowerCase()
  );
  const canToggle = $derived(signedIn && !ownEvent);
  const disabled = $derived(busy || !canToggle);

  onMount(() => {
    if (reactionsProp) {
      loaded = true;
      return;
    }
    let cancelled = false;
    void fetchReactionsForIds([event.id]).then((hits) => {
      if (cancelled) return;
      local = hits;
      loaded = true;
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (reactionsProp) local = reactionsProp;
  });

  async function toggle(): Promise<void> {
    if (busy || !canToggle) return;
    busy = true;
    try {
      if (mine) {
        const signed = await signAndPublish(deletionDraft(mine));
        if (signed) {
          local = local.filter((r) => r.id !== mine.id);
        }
      } else {
        const signed = await signAndPublish(reactionDraft(event));
        if (signed) {
          local = [signed, ...local.filter((r) => r.pubkey !== signed.pubkey)];
        }
      }
    } finally {
      busy = false;
    }
  }

  const label = $derived.by(() => {
    if (!signedIn) return `Likes (${count}). Sign in to like`;
    if (ownEvent) return `Likes (${count}). You cannot like your own event`;
    return liked ? `Unlike (${count})` : `Like (${count})`;
  });
  const tip = $derived.by(() => {
    if (!signedIn) return 'Sign in to like';
    if (ownEvent) return 'You cannot like your own event';
    return liked ? 'Unlike' : 'Like';
  });
</script>

<button
  class="btn btn-icon heart-btn"
  class:heart-on={liked}
  type="button"
  {disabled}
  aria-pressed={liked}
  aria-label={label}
  title={tip}
  onclick={() => void toggle()}
>
  <svg class="heart-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M12.1 21.35 10.6 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.6 11.54l-1.3 1.31z"
      fill={liked ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linejoin="round"
    />
  </svg>
  {#if loaded || count > 0 || reactionsProp}
    <span class="heart-count">{count}</span>
  {/if}
</button>
