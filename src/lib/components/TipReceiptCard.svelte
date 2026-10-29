<script lang="ts">
  import type { Event } from 'nostr-tools';
  import {
    formatCompactSats,
    formatCompactXmr,
    parseMoneroTip,
    parseZap
  } from '$lib/zaps';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const zap = $derived(parseZap(event));
  const tip = $derived(zap ? null : parseMoneroTip(event));
  const amountLabel = $derived(
    zap?.amountSats != null && zap.amountSats > 0
      ? formatCompactSats(zap.amountSats)
      : tip?.amountXmr != null && tip.amountXmr > 0
        ? formatCompactXmr(tip.amountXmr)
        : null
  );
  const title = $derived(zap ? 'Zap' : tip ? 'Monero tip' : 'Tip');
  const comment = $derived(zap?.comment ?? tip?.comment ?? null);
  const txid = $derived(tip?.txid ?? null);
  const client = $derived(
    event.tags.find((t) => t[0]?.toLowerCase() === 'client' && t[1]?.trim())?.[1]?.trim() ?? null
  );
  const isXmr = $derived(!!tip && !zap);
</script>

{#if zap || tip}
  <article class="tip-receipt" class:tip-receipt-xmr={isXmr} class:tip-receipt-zap={!isXmr}>
    <div class="tip-receipt-head">
      <span class="tip-receipt-title">{title}</span>
      {#if amountLabel}
        <span class="tip-receipt-amount">{amountLabel}</span>
      {/if}
    </div>
    {#if comment}
      <p class="tip-receipt-comment">{comment}</p>
    {/if}
    {#if client}
      <p class="tip-receipt-meta muted">via {client}</p>
    {/if}
    {#if txid}
      <p class="tip-receipt-meta tip-receipt-txid">
        <span class="muted">txid</span>
        <a
          href={`https://xmrchain.net/tx/${encodeURIComponent(txid)}`}
          rel="noopener noreferrer"
          target="_blank"
          onclick={(e) => e.stopPropagation()}>{txid}</a
        >
      </p>
    {/if}
  </article>
{/if}

<style>
  .tip-receipt {
    display: grid;
    gap: 0.35rem;
    box-sizing: border-box;
    margin: 0.15rem 0 0.25rem;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 0.55rem 0.65rem;
    border-radius: 0.4rem;
    border: 1px solid color-mix(in srgb, var(--rule) 55%, transparent);
    background: color-mix(in srgb, var(--ink-soft) 6%, transparent);
    overflow: hidden;
  }
  .tip-receipt-zap {
    border-color: color-mix(in srgb, #f59e0b 35%, var(--rule));
    background: color-mix(in srgb, #f59e0b 8%, transparent);
  }
  .tip-receipt-xmr {
    border-color: color-mix(in srgb, #f97316 35%, var(--rule));
    background: color-mix(in srgb, #f97316 8%, transparent);
  }
  .tip-receipt-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.45rem;
  }
  .tip-receipt-title {
    font-size: 0.78rem;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .tip-receipt-amount {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, #ea580c 70%, var(--ink));
  }
  .tip-receipt-comment {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tip-receipt-meta {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.35;
  }
  .tip-receipt-txid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: baseline;
  }
  .tip-receipt-txid a {
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 0.72rem;
    word-break: break-all;
  }
</style>
