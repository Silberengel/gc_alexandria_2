<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { session } from '$lib/stores/session';
  import { consumeSignFailure, publishSigned, signUnsigned } from '$lib/sign';
  import { showNotice } from '$lib/stores/toast';
  import { deletionDraft } from '$lib/drafts';
  import { placeMenuPanel, type MenuPlacement } from '$lib/menu-placement';
  import {
    fetchReactionsForIds,
    likeCount,
    likePubkeys,
    myLikeReaction,
    reactionDraft,
    reactionTargetsId
  } from '$lib/reactions';
  import UserBadge from './UserBadge.svelte';

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
  let showLikers = $state(false);
  let root: HTMLDivElement | null = $state(null);
  let panel: HTMLDivElement | null = $state(null);
  let place: MenuPlacement = $state({
    side: 'start',
    up: true,
    top: 0,
    left: 0,
    maxHeight: 280
  });

  const HOVER_OPEN_MS = 280;
  const HOVER_CLOSE_MS = 200;
  const LONG_PRESS_MS = 480;
  const LIKER_CAP = 24;
  const PANEL_W = 220;

  let hoverOpenTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressClick = false;

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
  const likers = $derived(likePubkeys(reactions));
  const mine = $derived(myLikeReaction(reactions, $session.pubkey));
  const liked = $derived(!!mine);
  const signedIn = $derived(!!$session.pubkey);
  const ownEvent = $derived(
    !!$session.pubkey && $session.pubkey.toLowerCase() === event.pubkey.toLowerCase()
  );
  const canToggle = $derived(signedIn && !ownEvent);
  const canShowLikers = $derived(likers.length > 0);

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

  $effect(() => {
    if (!showLikers) return;
    const onDoc = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) closeLikers();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLikers();
    };
    const onReposition = () => {
      if (root) refreshPlace();
    };
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  });

  function clearHoverTimers(): void {
    if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
    if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
    hoverOpenTimer = null;
    hoverCloseTimer = null;
  }

  function clearLongPress(): void {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function refreshPlace(measured?: { width: number; height: number }): void {
    if (!root) return;
    place = placeMenuPanel(root, {
      width: measured?.width ?? PANEL_W,
      height: measured?.height ?? Math.min(48 + likers.length * 36, 280)
    });
  }

  function refinePlace(): void {
    if (!root || !panel) return;
    const rect = panel.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    refreshPlace({ width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
  }

  function openLikers(): void {
    if (!canShowLikers) return;
    clearHoverTimers();
    refreshPlace();
    showLikers = true;
    queueMicrotask(() => refinePlace());
  }

  function closeLikers(): void {
    clearHoverTimers();
    clearLongPress();
    showLikers = false;
  }

  function scheduleOpenLikers(): void {
    if (!canShowLikers) return;
    clearHoverTimers();
    hoverOpenTimer = setTimeout(() => {
      hoverOpenTimer = null;
      openLikers();
    }, HOVER_OPEN_MS);
  }

  function scheduleCloseLikers(): void {
    clearHoverTimers();
    hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = null;
      showLikers = false;
    }, HOVER_CLOSE_MS);
  }

  function onHoverEnter(): void {
    scheduleOpenLikers();
  }

  function onHoverLeave(): void {
    scheduleCloseLikers();
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (!canShowLikers) return;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      suppressClick = true;
      openLikers();
    }, LONG_PRESS_MS);
  }

  function onPointerUp(): void {
    clearLongPress();
  }

  function onPointerCancel(): void {
    clearLongPress();
  }

  function onContextMenu(e: MouseEvent): void {
    if (suppressClick || showLikers) e.preventDefault();
  }

  function revert(previousExtras: Event[], previousHidden: string[]): void {
    extras = previousExtras;
    hiddenIds = previousHidden;
  }

  function explainSignFailure(action: 'like' | 'unlike'): void {
    showNotice(consumeSignFailure() ?? `The ${action} could not be signed.`);
  }

  async function toggle(): Promise<void> {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
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
    if (canShowLikers) return showLikers ? 'Liked by' : 'Hover or long-press to see who liked';
    if (pending) return 'Waiting for the signer';
    if (!signedIn) return 'Sign in to like';
    if (ownEvent) return 'You cannot like your own event';
    return liked ? 'Unlike' : 'Like';
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="heart-wrap"
  class:heart-likers-open={showLikers}
  role="group"
  bind:this={root}
  onpointerdown={onPointerDown}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  oncontextmenu={onContextMenu}
>
  <button
    class="btn btn-icon heart-btn"
    class:heart-on={liked}
    class:heart-pending={pending}
    type="button"
    disabled={!canToggle}
    aria-pressed={liked}
    aria-busy={pending}
    aria-label={label}
    aria-expanded={showLikers && canShowLikers}
    aria-haspopup={canShowLikers ? 'dialog' : undefined}
    title={tip}
    onmouseenter={onHoverEnter}
    onmouseleave={onHoverLeave}
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
  {#if showLikers && canShowLikers}
    <div
      class="heart-likers"
      bind:this={panel}
      style={`top:${place.top}px;left:${place.left}px;max-height:${place.maxHeight}px`}
      role="dialog"
      tabindex="-1"
      aria-label="Liked by"
      onmouseenter={onHoverEnter}
      onmouseleave={onHoverLeave}
    >
      <p class="heart-likers-heading">Liked by</p>
      <ul class="heart-likers-list">
        {#each likers.slice(0, LIKER_CAP) as pk (pk)}
          <li>
            <UserBadge pubkey={pk} compact />
          </li>
        {/each}
      </ul>
      {#if likers.length > LIKER_CAP}
        <p class="heart-likers-more muted">+{likers.length - LIKER_CAP} more</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .heart-wrap {
    position: relative;
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }
  .heart-likers {
    position: fixed;
    z-index: 200;
    right: auto;
    bottom: auto;
    min-width: 11rem;
    max-width: min(18rem, 80vw);
    overflow: auto;
    padding: 0.45rem 0.55rem;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: 0.45rem;
    background: var(--surface, #fff);
    color: var(--ink, inherit);
    box-shadow: 0 0.35rem 1rem color-mix(in srgb, #000 18%, transparent);
  }
  :global(:root.dark) .heart-likers {
    background: var(--surface, #1c1c1c);
    box-shadow: 0 0.35rem 1rem color-mix(in srgb, #000 45%, transparent);
  }
  .heart-likers-heading {
    margin: 0 0 0.35rem;
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    opacity: 0.7;
  }
  .heart-likers-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.3rem;
  }
  .heart-likers-list :global(.userbadge) {
    max-width: 100%;
  }
  .heart-likers-more {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
  }
</style>
