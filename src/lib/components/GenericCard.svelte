<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { eventPreview } from '$lib/event-preview';
  import { uniqueMedia } from '$lib/media';
  import { isAllowedMediaUrl } from '$lib/markup';

  interface Props {
    event: Event;
    embedDepth?: number;
    /** Compact search-list row. */
    density?: 'full' | 'list';
  }

  let { event, density = 'full' }: Props = $props();

  const preview = $derived(eventPreview(event));
  const media = $derived(uniqueMedia(event));
  const isList = $derived(density === 'list');
</script>

<article class="card generic-card" class:generic-card-list={isList}>
  <CopyPointerButton {event} class="generic-card-copy" />
  <p class="generic-card-kind muted">{preview.kindLine}</p>
  <h3 class="generic-card-title">{preview.headline}</h3>
  <p class="generic-card-by muted">
    by <UserBadge pubkey={event.pubkey} />
  </p>
  {#if preview.topics.length}
    <div class="chip-row">
      {#each preview.topics as subject}
        <a class="chip chip-quiet" href={`#/search?subject=${encodeURIComponent(subject)}`} use:link
          >{subject}</a
        >
      {/each}
    </div>
  {/if}
  {#if !isList}
    {#each [...preview.imageUrls, ...media.filter((m) => m.type === 'image').map((m) => m.url)]
      .filter((u, i, arr) => arr.indexOf(u) === i)
      .slice(0, 4) as url}
      {#if isAllowedMediaUrl(url)}
        <img class="generic-media" src={url} alt="" loading="lazy" />
      {/if}
    {/each}
    {#each media.filter((m) => m.type === 'video' || m.type === 'audio') as item}
      {#if item.type === 'video' && isAllowedMediaUrl(item.url)}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="generic-media" src={item.url} controls></video>
      {:else if item.type === 'audio' && isAllowedMediaUrl(item.url)}
        <audio src={item.url} controls></audio>
      {/if}
    {/each}
  {/if}
  {#if preview.summary && preview.summary !== preview.body}
    <p class="generic-card-summary muted">{preview.summary}</p>
  {/if}
  {#if preview.body}
    <p class="generic-card-body muted">{preview.body}</p>
  {:else if !preview.summary && !media.length && !preview.imageUrls.length}
    <p class="muted generic-card-empty">No text in this event.</p>
  {/if}
</article>
