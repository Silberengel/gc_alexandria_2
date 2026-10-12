<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { session } from '$lib/stores/session';
  import { consumeSignFailure, publishSigned, signUnsigned } from '$lib/sign';
  import { showNotice } from '$lib/stores/toast';
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
  let extras = $state<Event[]>([]);
  let hiddenIds = $state<string[]>([]);
  let pending = $state(false);
  let loaded = $state(false);

  const reactions = $derived.by(() => {
    const hidden = new Set(hiddenIds);
    const base = (reactionsProp ?? local).filter(
      (item) => reactionTargetsId(item, event.id) && !hidden.has(item.id)
    );
    const seen = new Set(base.map((item) => item.id));
    const extra = extras.filter(
      (item) => reactionTargetsId(item, event.id) && !hidden.has(item.id) && !seen.has(item.id)
    );
    return [...extra, ...base];
  });
  const count = $derived(likeCount(reactions));
  const mine = $derived(myLikeReaction(reactions, $session.pubkey));
  const liked = $derived(!!mine);
  const signedIn = $derived(!!$session.pubkey);
  const ownEvent = $derived(
    !!$session.pubkey && $session.pubkey.toLowerCase() === event.pubkey.toLowerCase()
  );
  const canToggle = $derived(signedIn && !ownEvent);

  $effect(() => {
    const id = event.id;
    if (reactionsProp) {
      loaded = true;
      return;
    }
    let cancelled = false;
    void fetchReactionsForIds([id], 100, (cached) => {
      if (cancelled || !cached.length) return;
      local = cached;
      loaded = true;
    }).then((hits) => {
      if (cancelled) return;
      local = hits;
      loaded = true;
    });
    return () => {
      cancelled = true;
    };
  });

  function revert(previousExtras: Event[], previousHidden: string[]): void {
    extras = previousExtras;
    hiddenIds = previousHidden;
  }

  function explainSignFailure(action: 'like' | 'unlike'): void {
    showNotice(consumeSignFailure() ?? `The ${action} could not be signed.`);
  }

  async function toggle(): Promise<void> {
    if (pending || !canToggle) return;
    pending = true;
    const previousExtras = extras.slice();
    const previousHidden = hiddenIds.slice();
    const pubkey = $session.pubkey ?? '';
    try {
      if (mine) {
        const target = mine;
        const signed = await signUnsigned(deletionDraft(target));
        if (!signed) {
          explainSignFailure('unlike');
          return;
        }
        hiddenIds = [...hiddenIds, target.id];
        extras = extras.filter((item) => item.id !== target.id);
        const wrote = await publishSigned(signed);
        if (!wrote) {
          revert(previousExtras, previousHidden);
          showNotice('The unlike was signed, but no relay accepted it.');
        }
        return;
      }

      const signed = await signUnsigned(reactionDraft(event));
      if (!signed) {
        explainSignFailure('like');
        return;
      }
      extras = [signed, ...extras.filter((item) => item.pubkey !== pubkey || item.id === signed.id)];
      const wrote = await publishSigned(signed);
      if (!wrote) {
        revert(previousExtras, previousHidden);
        showNotice('The like was signed, but no relay accepted it.');
      }
    } finally {
      pending = false;
    }
  }

  const label = $derived.by(() => {
    if (pending) return 'Waiting for the signer';
    if (!signedIn) return `Likes (${count}). Sign in to like`;
    if (ownEvent) return `Likes (${count}). You cannot like your own event`;
    return liked ? `Unlike (${count})` : `Like (${count})`;
  });
  const tip = $derived.by(() => {
    if (pending) return 'Waiting for the signer';
    if (!signedIn) return 'Sign in to like';
    if (ownEvent) return 'You cannot like your own event';
    return liked ? 'Unlike' : 'Like';
  });
</script>

<button
  class="btn btn-icon heart-btn"
  class:heart-on={liked}
  class:heart-pending={pending}
  type="button"
  disabled={!canToggle}
  aria-pressed={liked}
  aria-busy={pending}
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
