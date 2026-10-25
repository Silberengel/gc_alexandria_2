<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { isAllowedMediaUrl } from '$lib/markup';
  import { parseMeetingRoom } from '$lib/nip53';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const info = $derived(parseMeetingRoom(event));
  const coverOk = $derived(!!info.imageUrl && isAllowedMediaUrl(info.imageUrl));
  const metaLine = $derived(
    [info.whenLabel, info.viewersLabel].filter(Boolean).join(' · ')
  );
</script>

<article class="card meeting-room-card" data-meeting-status={info.status}>
  <CopyPointerButton {event} class="generic-card-copy" />
  <div class="meeting-room-clip">
    <div class="meeting-room-chips">
      <span class="meeting-status-chip" data-status={info.status}>{info.statusLabel}</span>
      {#if info.stale}
        <span class="muted meeting-stale">No recent update</span>
      {/if}
      {#each info.tags.slice(0, 4) as topic}
        <a
          class="chip chip-quiet"
          href={`#/search?subject=${encodeURIComponent(topic)}`}
          use:link>#{topic}</a
        >
      {/each}
    </div>

    <h3 class="meeting-room-title">{info.title}</h3>
    {#if metaLine}
      <p class="meeting-room-meta">{metaLine}</p>
    {/if}
    {#if info.summary}
      <p class="meeting-room-summary muted">{info.summary}</p>
    {/if}

    {#if coverOk}
      <img class="meeting-room-cover" src={info.imageUrl!} alt="" loading="lazy" />
    {/if}

    {#each info.hosts.slice(0, 2) as host}
      <p class="meeting-room-host muted">
        <UserBadge pubkey={host.pubkey} />
        {#if host.role}
          <span class="meeting-role">{host.role}{host.agreed ? '' : ' (invited)'}</span>
        {/if}
      </p>
    {/each}

    {#if info.spaceAddress}
      <p class="meeting-room-space muted">
        Space <code>{info.spaceAddress}</code>
      </p>
    {/if}
  </div>
</article>

<style>
  .meeting-room-card {
    position: relative;
    display: flex;
    flex-direction: column;
    padding-right: 2.5rem;
    padding-bottom: 1.1rem;
    max-height: none;
    overflow: visible;
  }
  .meeting-room-clip {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-width: 0;
  }
  .meeting-room-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .meeting-status-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.55rem;
    border-radius: 0.25rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: color-mix(in srgb, var(--ink) 12%, var(--paper));
  }
  .meeting-status-chip[data-status='live'] {
    background: #b3261e;
    color: #fff;
  }
  .meeting-status-chip[data-status='planned'] {
    background: color-mix(in srgb, var(--accent) 22%, var(--paper));
  }
  .meeting-status-chip[data-status='ended'] {
    color: color-mix(in srgb, var(--ink) 55%, transparent);
  }
  .meeting-stale {
    font-size: 0.75rem;
  }
  .meeting-room-title {
    margin: 0;
    font-family: var(--display-font);
    font-size: var(--text-title);
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .meeting-room-meta {
    margin: 0;
    font-size: 0.9rem;
    color: var(--accent);
  }
  .meeting-room-summary {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.45;
  }
  .meeting-room-cover {
    display: block;
    width: 100%;
    max-height: 14rem;
    border-radius: 0.35rem;
    object-fit: cover;
  }
  .meeting-room-host {
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
  .meeting-room-space {
    margin: 0;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
</style>
