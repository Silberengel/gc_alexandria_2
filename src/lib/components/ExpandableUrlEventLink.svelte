<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { decodeNostrBech32 } from '$lib/nostr-refs';
  import { eventBech32FromDestination, visibleEventLinkLabel } from '$lib/nostr-entity';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { tidyLinkUrl } from '$lib/og-preview';

  interface Props {
    url: string;
    /** Optional visible label; defaults to a cropped host/path. */
    label?: string;
  }

  let { url, label }: Props = $props();

  const href = $derived(tidyLinkUrl(url));
  const bech32 = $derived(eventBech32FromDestination(href) ?? '');
  const display = $derived(label?.trim() || visibleEventLinkLabel(href));

  let expanded = $state(false);
  let loading = $state(false);
  let event = $state<Event | null>(null);
  let missed = $state(false);
  let generation = 0;

  async function resolve(): Promise<void> {
    if (!bech32 || event || missed) return;
    const ref = decodeNostrBech32(bech32);
    if (!ref || ref.type !== 'ref') {
      missed = true;
      return;
    }
    const gen = ++generation;
    loading = true;
    try {
      let hit: Event | null = null;
      if (ref.kind === 'naddr' && ref.naddr) {
        hit = await fetchByAddress(
          `${ref.naddr.kind}:${ref.naddr.pubkey}:${ref.naddr.identifier}`,
          { hintRelays: ref.naddr.relays }
        );
      } else if (ref.id) {
        hit = await fetchById(ref.id, {
          hintRelays: ref.relays,
          authorPubkey: ref.pubkey
        });
      }
      if (gen !== generation) return;
      event = hit;
      if (!hit) missed = true;
    } finally {
      if (gen === generation) loading = false;
    }
  }

  function toggle(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    expanded = !expanded;
    if (expanded) void resolve();
  }
</script>

{#if bech32}
  <div class="url-event-link">
    <div class="url-event-row">
      <a class="url-event-anchor" href={href} rel="noopener noreferrer" target="_blank">{display}</a>
      <button
        class="url-event-chevron"
        type="button"
        title={expanded ? 'Hide preview' : 'Show preview'}
        aria-label={expanded ? 'Hide preview' : 'Show preview'}
        aria-expanded={expanded}
        onclick={toggle}
      >
        <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
      </button>
    </div>
    {#if expanded}
      <div class="url-event-embed">
        {#if loading}
          <p class="muted">Opening…</p>
        {:else if event}
          {#await import('./EventCard.svelte') then mod}
            <mod.default {event} embedDepth={1} asCard />
          {/await}
        {:else}
          <p class="muted">This item could not be found.</p>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <a href={href} rel="noopener noreferrer" target="_blank">{display}</a>
{/if}

<style>
  .url-event-link {
    display: grid;
    gap: 0.35rem;
    margin: 0.25rem 0 0.4rem;
    max-width: 100%;
  }
  .url-event-row {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    min-width: 0;
  }
  .url-event-anchor {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .url-event-chevron {
    appearance: none;
    flex: 0 0 auto;
    display: inline-grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0.3rem;
    background: transparent;
    color: inherit;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0.75;
  }
  .url-event-chevron:hover,
  .url-event-chevron:focus-visible {
    opacity: 1;
    background: color-mix(in srgb, currentColor 10%, transparent);
    outline: none;
  }
  .url-event-embed {
    min-width: 0;
  }
  .muted {
    opacity: 0.7;
    margin: 0.25rem 0;
  }
</style>
