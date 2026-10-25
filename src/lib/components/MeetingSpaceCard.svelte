<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { isAllowedMediaUrl } from '$lib/markup';
  import { parseMeetingSpace } from '$lib/nip53';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const info = $derived(parseMeetingSpace(event));
  const coverOk = $derived(!!info.imageUrl && isAllowedMediaUrl(info.imageUrl));
  const serviceOk = $derived(!!info.serviceUrl && isAllowedMediaUrl(info.serviceUrl));
</script>

<article class="card meeting-space-card" data-space-status={info.status}>
  <CopyPointerButton {event} class="generic-card-copy" />
  <div class="meeting-space-clip">
    <div class="meeting-space-chips">
      <span class="space-status-chip" data-status={info.status}>{info.statusLabel}</span>
      {#each info.tags.slice(0, 4) as topic}
        <a
          class="chip chip-quiet"
          href={`#/search?subject=${encodeURIComponent(topic)}`}
          use:link>#{topic}</a
        >
      {/each}
    </div>

    <h3 class="meeting-space-title">{info.room}</h3>
    {#if info.summary}
      <p class="meeting-space-summary muted">{info.summary}</p>
    {/if}

    {#if coverOk}
      <img class="meeting-space-cover" src={info.imageUrl!} alt="" loading="lazy" />
    {/if}

    {#each info.providers.slice(0, 3) as provider}
      <p class="meeting-space-host muted">
        <UserBadge pubkey={provider.pubkey} />
        {#if provider.role}
          <span class="meeting-role">{provider.role}{provider.agreed ? '' : ' (invited)'}</span>
        {:else if !provider.agreed}
          <span class="meeting-role">invited</span>
        {/if}
      </p>
    {/each}

    {#if serviceOk && info.serviceUrl}
      <p class="meeting-space-open">
        <a href={info.serviceUrl} rel="noopener noreferrer" target="_blank">Join room</a>
      </p>
    {/if}
  </div>
</article>

<style>
  .meeting-space-card {
    position: relative;
    display: flex;
    flex-direction: column;
    padding-right: 2.5rem;
    padding-bottom: 1.1rem;
    max-height: none;
    overflow: visible;
  }
  .meeting-space-clip {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-width: 0;
  }
  .meeting-space-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .space-status-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.55rem;
    border-radius: 0.25rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: color-mix(in srgb, var(--ink) 12%, var(--paper));
    color: var(--ink);
  }
  .space-status-chip[data-status='open'] {
    background: color-mix(in srgb, #2a8f2a 85%, black);
    color: #fff;
  }
  .space-status-chip[data-status='private'] {
    background: color-mix(in srgb, var(--accent) 22%, var(--paper));
    color: color-mix(in srgb, var(--accent) 70%, var(--ink));
  }
  .space-status-chip[data-status='closed'] {
    background: color-mix(in srgb, var(--ink) 10%, var(--paper));
    color: color-mix(in srgb, var(--ink) 55%, transparent);
  }
  .meeting-space-title {
    margin: 0;
    font-family: var(--display-font);
    font-size: var(--text-title);
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .meeting-space-summary {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .meeting-space-cover {
    display: block;
    width: 100%;
    max-height: 14rem;
    border-radius: 0.35rem;
    object-fit: cover;
  }
  .meeting-space-host {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.55rem;
    font-size: 0.9rem;
  }
  .meeting-role {
    font-size: 0.78rem;
    text-transform: capitalize;
  }
  .meeting-space-open {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
  }
</style>
