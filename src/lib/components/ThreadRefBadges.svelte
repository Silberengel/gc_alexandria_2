<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { eventsPointingAtId, isXmrZap } from '$lib/comments';
  import { placeMenuPanel, type MenuPlacement } from '$lib/menu-placement';
  import {
    formatCompactSats,
    formatCompactXmr,
    parseMoneroTip,
    parseZap,
    tipActorPubkey
  } from '$lib/zaps';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    event: Event;
    zaps?: Event[];
    boosts?: Event[];
  }

  let { event, zaps = [], boosts = [] }: Props = $props();

  const onEventZaps = $derived(eventsPointingAtId(zaps, event.id));
  const btcZaps = $derived(
    onEventZaps
      .filter((z) => !isXmrZap(z))
      .sort((a, b) => b.created_at - a.created_at)
  );
  const xmrZaps = $derived(
    onEventZaps.filter((z) => isXmrZap(z)).sort((a, b) => b.created_at - a.created_at)
  );
  const boostCount = $derived(eventsPointingAtId(boosts, event.id).length);

  type TipKind = 'btc' | 'xmr';

  let open: TipKind | null = $state(null);
  let btcAnchor: HTMLElement | null = $state(null);
  let xmrAnchor: HTMLElement | null = $state(null);
  let panel: HTMLElement | null = $state(null);
  let place: MenuPlacement = $state({
    side: 'start',
    up: true,
    top: 0,
    left: 0,
    maxHeight: 280
  });

  const HOVER_OPEN_MS = 280;
  const HOVER_CLOSE_MS = 200;
  const PANEL_W = 240;
  let hoverOpenTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last open came from click/tap — ignore synthetic mouseleave that follows. */
  let stickyOpen = false;

  function rowsFor(kind: TipKind): Event[] {
    return kind === 'btc' ? btcZaps : xmrZaps;
  }

  function anchorFor(kind: TipKind): HTMLElement | null {
    return kind === 'btc' ? btcAnchor : xmrAnchor;
  }

  function amountLabel(receipt: Event): string | null {
    const zap = parseZap(receipt);
    if (zap?.amountSats != null && zap.amountSats > 0) return formatCompactSats(zap.amountSats);
    const tip = parseMoneroTip(receipt);
    if (tip?.amountXmr != null && tip.amountXmr > 0) return formatCompactXmr(tip.amountXmr);
    return null;
  }

  function panelTitle(kind: TipKind, count: number): string {
    if (kind === 'xmr') return count === 1 ? 'Monero tip' : 'Monero tips';
    return count === 1 ? 'Zap' : 'Zaps';
  }

  function hoverEnabled(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  function clearHoverTimers(): void {
    if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
    if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
    hoverOpenTimer = null;
    hoverCloseTimer = null;
  }

  function refreshPlace(kind: TipKind, measured?: { width: number; height: number }): void {
    const anchor = anchorFor(kind);
    if (!anchor) return;
    const n = rowsFor(kind).length;
    place = placeMenuPanel(anchor, {
      width: measured?.width ?? PANEL_W,
      height: measured?.height ?? Math.min(36 + n * 36, 280)
    });
  }

  function openPanel(kind: TipKind, sticky = false): void {
    if (!rowsFor(kind).length) return;
    clearHoverTimers();
    stickyOpen = sticky;
    refreshPlace(kind);
    open = kind;
    queueMicrotask(() => {
      if (!panel || open !== kind) return;
      const rect = panel.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      refreshPlace(kind, { width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
    });
  }

  function closePanel(): void {
    clearHoverTimers();
    stickyOpen = false;
    open = null;
  }

  function togglePanel(kind: TipKind, e?: MouseEvent): void {
    e?.stopPropagation();
    e?.preventDefault();
    if (open === kind) {
      closePanel();
      return;
    }
    openPanel(kind, true);
  }

  function scheduleOpen(kind: TipKind): void {
    if (!hoverEnabled()) return;
    clearHoverTimers();
    hoverOpenTimer = setTimeout(() => {
      hoverOpenTimer = null;
      openPanel(kind, false);
    }, HOVER_OPEN_MS);
  }

  function scheduleClose(): void {
    if (stickyOpen) return;
    clearHoverTimers();
    hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = null;
      if (stickyOpen) return;
      open = null;
    }, HOVER_CLOSE_MS);
  }

  function onFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget;
    const current = e.currentTarget;
    if (next instanceof Node && current instanceof Node && current.contains(next)) return;
    // Sticky panels stay until outside tap / Escape / second click.
    if (stickyOpen) return;
    scheduleClose();
  }

  $effect(() => {
    if (!open) return;
    const kind = open;
    const root = anchorFor(kind);
    const onDoc = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) closePanel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    const onReposition = () => refreshPlace(kind);
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

  $effect(() => () => clearHoverTimers());
</script>

{#snippet receiptList(kind: TipKind, receipts: Event[])}
  <div
    class="thread-ref-receipts"
    bind:this={panel}
    style={`top:${place.top}px;left:${place.left}px;max-height:${place.maxHeight}px`}
    role="dialog"
    aria-label={panelTitle(kind, receipts.length)}
  >
    <p class="thread-ref-receipts-heading">{panelTitle(kind, receipts.length)}</p>
    <ul class="thread-ref-receipts-list">
      {#each receipts as receipt (receipt.id)}
        {@const amount = amountLabel(receipt)}
        <li>
          <UserBadge pubkey={tipActorPubkey(receipt)} />
          {#if amount}
            <span class="thread-ref-amount">{amount}</span>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/snippet}

{#if btcZaps.length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    class="thread-ref-badge-wrap"
    bind:this={btcAnchor}
    onmouseenter={() => scheduleOpen('btc')}
    onmouseleave={scheduleClose}
    onfocusin={() => {
      if (hoverEnabled()) openPanel('btc', false);
    }}
    onfocusout={onFocusOut}
  >
    <button
      type="button"
      class="thread-ref-badge"
      aria-expanded={open === 'btc'}
      aria-haspopup="dialog"
      aria-label={`${btcZaps.length} Lightning zap${btcZaps.length === 1 ? '' : 's'}`}
      title="Show zaps"
      onclick={(e) => togglePanel('btc', e)}
    >
      ⚡ {btcZaps.length}
    </button>
    {#if open === 'btc'}
      {@render receiptList('btc', btcZaps)}
    {/if}
  </span>
{/if}
{#if xmrZaps.length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    class="thread-ref-badge-wrap"
    bind:this={xmrAnchor}
    onmouseenter={() => scheduleOpen('xmr')}
    onmouseleave={scheduleClose}
    onfocusin={() => {
      if (hoverEnabled()) openPanel('xmr', false);
    }}
    onfocusout={onFocusOut}
  >
    <button
      type="button"
      class="thread-ref-badge"
      aria-expanded={open === 'xmr'}
      aria-haspopup="dialog"
      aria-label={`${xmrZaps.length} Monero tip${xmrZaps.length === 1 ? '' : 's'}`}
      title="Show Monero tips"
      onclick={(e) => togglePanel('xmr', e)}
    >
      XMR {xmrZaps.length}
    </button>
    {#if open === 'xmr'}
      {@render receiptList('xmr', xmrZaps)}
    {/if}
  </span>
{/if}
{#if boostCount > 0}
  <span class="thread-ref-badge" title={`${boostCount} boost${boostCount === 1 ? '' : 's'}`}>
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17 7h-3l4-5 4 5h-3c0 3.31-2.69 6-6 6h-1v2.13c2.89.44 5 2.93 5 5.87h-2c0-2.21-1.79-4-4-4s-4 1.79-4 4H5c0-2.94 2.11-5.43 5-5.87V14H9c-4.97 0-9-4.03-9-9h2c0 3.87 3.13 7 7 7h1C12.88 12 17 9.31 17 7z"
      />
    </svg>
    {boostCount}
  </span>
{/if}

<style>
  .thread-ref-badge-wrap {
    display: inline-flex;
    position: relative;
  }
  .thread-ref-badge-wrap .thread-ref-badge {
    appearance: none;
    border: 0;
    font: inherit;
    cursor: pointer;
  }
  .thread-ref-receipts {
    position: fixed;
    z-index: 200;
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
  :global(:root.dark) .thread-ref-receipts {
    background: var(--surface, #1c1c1c);
    box-shadow: 0 0.35rem 1rem color-mix(in srgb, #000 45%, transparent);
  }
  .thread-ref-receipts-heading {
    margin: 0 0 0.35rem;
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    opacity: 0.7;
  }
  .thread-ref-receipts-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.35rem;
  }
  .thread-ref-receipts-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    min-width: 0;
  }
  .thread-ref-receipts-list :global(.userbadge) {
    min-width: 0;
    max-width: 12rem;
  }
  .thread-ref-receipts-list :global(.userbadge span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .thread-ref-amount {
    flex: 0 0 auto;
    font-size: 0.82rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
</style>
