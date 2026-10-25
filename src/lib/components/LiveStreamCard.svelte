<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import LiveStreamPlayer from './LiveStreamPlayer.svelte';
  import { isAllowedMediaUrl } from '$lib/markup';
  import {
    isInPagePlayableMediaUrl,
    liveStreamPlaybackUrl,
    parseLiveStream
  } from '$lib/live-stream';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const info = $derived(parseLiveStream(event));
  const playUrl = $derived(liveStreamPlaybackUrl(info));
  const coverOk = $derived(!!info.imageUrl && isAllowedMediaUrl(info.imageUrl));
  const playOk = $derived(!!playUrl && isAllowedMediaUrl(playUrl));
  const inPagePlay = $derived(playOk && isInPagePlayableMediaUrl(playUrl!));
  const metaLine = $derived(
    [info.whenLabel, info.viewersLabel].filter(Boolean).join(' · ')
  );
</script>

<article class="card live-stream-card" data-live-status={info.status}>
  <CopyPointerButton {event} class="generic-card-copy" />
  <div class="live-stream-clip">
    <div class="live-stream-chips">
      <span class="live-status-chip" data-status={info.status}>{info.statusLabel}</span>
      {#each info.tags.slice(0, 4) as topic}
        <a
          class="chip chip-quiet live-topic-chip"
          href={`#/search?subject=${encodeURIComponent(topic)}`}
          use:link>#{topic}</a
        >
      {/each}
    </div>

    <h3 class="live-stream-title">{info.title}</h3>
    {#if metaLine}
      <p class="live-stream-meta">{metaLine}</p>
    {/if}
    {#if info.summary}
      <p class="live-stream-summary muted">{info.summary}</p>
    {/if}

    {#each info.hosts.slice(0, 2) as host}
      <p class="live-stream-host muted">
        <UserBadge pubkey={host.pubkey} />
        {#if host.role}
          <span class="live-host-role">{host.role}</span>
        {/if}
      </p>
    {/each}

    {#if inPagePlay && playUrl}
      <LiveStreamPlayer url={playUrl} poster={coverOk ? info.imageUrl : null} />
    {:else}
      {#if coverOk}
        <img class="live-stream-cover" src={info.imageUrl!} alt="" loading="lazy" />
      {/if}
      {#if playOk && playUrl}
        <p class="live-stream-open">
          <a href={playUrl} rel="noopener noreferrer" target="_blank"
            >{info.streamingUrl === playUrl ? 'Open stream' : 'Watch recording'}</a
          >
        </p>
      {/if}
    {/if}
  </div>
</article>

<style>
  .live-stream-card {
    position: relative;
    display: flex;
    flex-direction: column;
    padding-right: 2.5rem;
    padding-bottom: 1.1rem;
    max-height: none;
    overflow: visible;
  }
  .live-stream-clip {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-width: 0;
  }
  .live-stream-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .live-status-chip {
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
  .live-status-chip[data-status='live'] {
    background: #b3261e;
    color: #fff;
  }
  .live-status-chip[data-status='planned'] {
    background: color-mix(in srgb, var(--accent) 22%, var(--paper));
    color: color-mix(in srgb, var(--accent) 70%, var(--ink));
  }
  .live-status-chip[data-status='ended'] {
    background: color-mix(in srgb, var(--ink) 10%, var(--paper));
    color: color-mix(in srgb, var(--ink) 55%, transparent);
  }
  .live-topic-chip {
    font-size: 0.75rem;
  }
  .live-stream-title {
    margin: 0;
    font-family: var(--display-font);
    font-size: var(--text-title);
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 1.3;
    overflow-wrap: anywhere;
    color: var(--ink);
  }
  .live-stream-meta {
    margin: 0;
    font-size: 0.9rem;
    color: var(--accent);
  }
  .live-stream-summary {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .live-stream-host {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem 0.55rem;
    font-size: 0.9rem;
  }
  .live-host-role {
    font-size: 0.78rem;
    text-transform: capitalize;
  }
  .live-stream-cover {
    display: block;
    width: 100%;
    max-height: 14rem;
    margin: 0.25rem 0 0;
    border-radius: 0.35rem;
    object-fit: cover;
    background: color-mix(in srgb, var(--ink) 6%, var(--paper));
  }
  .live-stream-open {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
  }
</style>
