<script lang="ts">
  import type { Event } from 'nostr-tools';
  import {
    listIncludesEvent,
    membershipListKind,
    readMembershipMode,
    setEventBookmark,
    toggleEventPin,
    viewerMembershipList,
    type BookmarkVisibility
  } from '$lib/bookmark-actions';
  import { KIND } from '$lib/constants';
  import { placeMenuPanel, type MenuPlacement } from '$lib/menu-placement';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { session } from '$lib/stores/session';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  let pending = $state(false);
  let choosing = $state(false);
  /** Optimistic override until metadata / decrypt catches up. */
  let optimisticOn = $state<boolean | null>(null);
  let metaEvents = $state<Event[]>([]);
  /** Private-bucket membership (async). */
  let privateOn = $state(false);
  let root: HTMLDivElement | null = $state(null);
  let panel: HTMLDivElement | null = $state(null);
  let place: MenuPlacement = $state({
    side: 'start',
    up: true,
    top: 0,
    left: 0,
    maxHeight: 220
  });

  $effect(() => {
    const unsub = session.metadata.subscribe((events) => {
      metaEvents = events;
    });
    return unsub;
  });

  $effect(() => {
    const id = event.id;
    const pk = $session.pubkey;
    let cancelled = false;
    privateOn = false;
    if (!pk || membershipListKind(event, pk) === KIND.PIN) return;
    void readMembershipMode(event).then((mode) => {
      if (cancelled || event.id !== id) return;
      privateOn = mode === 'private';
    });
    return () => {
      cancelled = true;
    };
  });

  const signedIn = $derived(!!$session.pubkey);
  const listKind = $derived(
    $session.pubkey ? membershipListKind(event, $session.pubkey) : KIND.BOOKMARK
  );
  const isPin = $derived(listKind === KIND.PIN);
  const publicOn = $derived.by(() => {
    const pk = $session.pubkey;
    if (!pk) return false;
    return listIncludesEvent(viewerMembershipList(event, pk, metaEvents), event);
  });
  const fromMeta = $derived(publicOn || privateOn);
  const active = $derived(optimisticOn ?? fromMeta);

  $effect(() => {
    void event.id;
    void metaEvents;
    void privateOn;
    if (optimisticOn == null) return;
    if (optimisticOn === fromMeta) optimisticOn = null;
  });

  $effect(() => {
    if (!choosing) return;
    const onDoc = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) choosing = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') choosing = false;
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

  const label = $derived.by(() => {
    if (pending) return 'Waiting for the signer';
    if (!signedIn) return isPin ? 'Sign in to pin' : 'Sign in to bookmark';
    if (choosing) return 'Choose bookmark visibility';
    if (isPin) return active ? 'Unpin' : 'Pin';
    if (active) return privateOn && !publicOn ? 'Remove private bookmark' : 'Remove bookmark';
    return 'Bookmark';
  });

  function refreshPlace(measured?: { width: number; height: number }): void {
    if (!root) return;
    place = placeMenuPanel(root, {
      width: measured?.width ?? 220,
      height: measured?.height ?? 140
    });
  }

  function refinePlace(): void {
    if (!root || !panel) return;
    const rect = panel.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    refreshPlace({ width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
  }

  function openChoose(): void {
    refreshPlace();
    choosing = true;
    queueMicrotask(() => refinePlace());
  }

  async function applyPinToggle(): Promise<void> {
    pending = true;
    const next = !active;
    optimisticOn = next;
    try {
      const signed = await toggleEventPin(event);
      if (!signed) optimisticOn = null;
    } finally {
      pending = false;
    }
  }

  async function applyBookmark(mode: BookmarkVisibility | 'remove'): Promise<void> {
    pending = true;
    choosing = false;
    const next = mode !== 'remove';
    optimisticOn = next;
    privateOn = mode === 'private';
    try {
      const signed = await setEventBookmark(event, mode);
      if (!signed) {
        optimisticOn = null;
        privateOn = false;
      }
    } finally {
      pending = false;
    }
  }

  function onClick(): void {
    if (pending) return;
    if (!signedIn) {
      openLoginDialog();
      return;
    }
    if (isPin) {
      void applyPinToggle();
      return;
    }
    if (active) {
      void applyBookmark('remove');
      return;
    }
    if (choosing) {
      choosing = false;
      return;
    }
    openChoose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="bookmark-wrap" class:bookmark-choose-open={choosing} bind:this={root}>
  <button
    class="btn btn-icon bookmark-btn"
    class:bookmark-on={active}
    class:bookmark-pending={pending}
    type="button"
    aria-pressed={active}
    aria-busy={pending}
    aria-expanded={choosing}
    aria-haspopup={isPin ? undefined : 'dialog'}
    aria-label={label}
    title={label}
    onclick={onClick}
  >
    <svg class="bookmark-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M6 3.75A1.75 1.75 0 0 1 7.75 2h8.5A1.75 1.75 0 0 1 18 3.75v17.1a.75.75 0 0 1-1.2.6L12 17.35l-4.8 4.1a.75.75 0 0 1-1.2-.6V3.75z"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linejoin="round"
      />
    </svg>
  </button>
  {#if choosing}
    <div
      class="bookmark-choose"
      bind:this={panel}
      style={`top:${place.top}px;left:${place.left}px;max-height:${place.maxHeight}px`}
      role="dialog"
      tabindex="-1"
      aria-label="Bookmark visibility"
    >
      <p class="bookmark-choose-prompt">
        Bookmark publicly, or keep it private in your encrypted bookmark list?
      </p>
      <div class="bookmark-choose-actions">
        <button class="btn" type="button" disabled={pending} onclick={() => void applyBookmark('public')}>
          Bookmark publicly
        </button>
        <button class="btn" type="button" disabled={pending} onclick={() => void applyBookmark('private')}>
          Bookmark privately
        </button>
        <button
          class="bookmark-choose-cancel"
          type="button"
          disabled={pending}
          onclick={() => (choosing = false)}
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .bookmark-wrap {
    position: relative;
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
  }
  .bookmark-choose {
    position: fixed;
    z-index: 200;
    right: auto;
    bottom: auto;
    min-width: 14rem;
    max-width: min(20rem, 88vw);
    overflow: auto;
    padding: 0.65rem 0.75rem;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: 0.45rem;
    background: var(--surface, #fff);
    color: var(--ink, inherit);
    box-shadow: 0 0.35rem 1rem color-mix(in srgb, #000 18%, transparent);
  }
  :global(:root.dark) .bookmark-choose {
    background: var(--surface, #1c1c1c);
    box-shadow: 0 0.35rem 1rem color-mix(in srgb, #000 45%, transparent);
  }
  .bookmark-choose-prompt {
    margin: 0 0 0.55rem;
    font-size: 0.86rem;
    line-height: 1.35;
  }
  .bookmark-choose-actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
  }
  .bookmark-choose-cancel {
    appearance: none;
    margin: 0.15rem 0 0;
    padding: 0.2rem 0.35rem;
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }
  .bookmark-choose-cancel:hover:not(:disabled) {
    color: var(--text);
  }
</style>
