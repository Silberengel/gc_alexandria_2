<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import { cardMeta, displayTitle } from '$lib/metadata';
  import { uniqueMedia, contentWithoutMediaUrls } from '$lib/media';
  import { isAllowedMediaUrl } from '$lib/markup';

  interface Props {
    event: Event;
    embedDepth?: number;
  }

  let { event, embedDepth = 0 }: Props = $props();

  const meta = $derived(cardMeta(event));
  const title = $derived(displayTitle(event));
  const media = $derived(uniqueMedia(event));
  const leftover = $derived(contentWithoutMediaUrls(event.content, media));
</script>

<article class="card generic-card">
  <p class="muted">Published by <UserBadge pubkey={event.pubkey} /></p>
  {#if title && title !== 'Untitled'}
    <h3>{title}</h3>
  {/if}
  {#if meta.summary && meta.summary !== leftover}
    <p class="muted">{meta.summary}</p>
  {/if}
  {#if meta.subjects.length}
    <div class="chip-row">
      {#each meta.subjects.slice(0, 8) as subject}
        <span class="chip">{subject}</span>
      {/each}
    </div>
  {/if}
  {#if meta.source}
    <p class="muted">Source: {meta.source}</p>
  {/if}
  {#each media as item}
    {#if item.type === 'image' && isAllowedMediaUrl(item.url)}
      <img class="generic-media" src={item.url} alt="" />
    {:else if item.type === 'video' && isAllowedMediaUrl(item.url)}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video class="generic-media" src={item.url} controls></video>
    {:else if item.type === 'audio' && isAllowedMediaUrl(item.url)}
      <audio src={item.url} controls></audio>
    {/if}
  {/each}
  {#if leftover}
    <EventBody event={{ ...event, content: leftover }} {embedDepth} />
  {:else if !media.length && title === 'Untitled' && !meta.summary}
    <p class="muted">No preview</p>
  {/if}
</article>
