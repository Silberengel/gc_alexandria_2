<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { eventsPointingAtId, isXmrZap } from '$lib/comments';

  interface Props {
    event: Event;
    zaps?: Event[];
    boosts?: Event[];
  }

  let { event, zaps = [], boosts = [] }: Props = $props();

  const onEventZaps = $derived(eventsPointingAtId(zaps, event.id));
  const btc = $derived(onEventZaps.filter((z) => !isXmrZap(z)).length);
  const xmr = $derived(onEventZaps.filter((z) => isXmrZap(z)).length);
  const boostCount = $derived(eventsPointingAtId(boosts, event.id).length);
</script>

{#if btc > 0}
  <span class="thread-ref-badge" title={`${btc} BTC zap${btc === 1 ? '' : 's'}`}>⚡ {btc}</span>
{/if}
{#if xmr > 0}
  <span class="thread-ref-badge" title={`${xmr} XMR zap${xmr === 1 ? '' : 's'}`}>XMR {xmr}</span>
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
