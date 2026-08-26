<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import { uniqueMedia } from '$lib/media';
  import { displayTitle } from '$lib/metadata';
  import { isAllowedMediaUrl } from '$lib/markup';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();
  const images = $derived(uniqueMedia(event).filter((m) => m.type === 'image' && isAllowedMediaUrl(m.url)));
  const title = $derived(displayTitle(event));
</script>

<article class="card picture-card">
  <p class="muted">Published by <UserBadge pubkey={event.pubkey} /></p>
  {#if title !== 'Untitled'}<h3>{title}</h3>{/if}
  <div class="picture-gallery">
    {#each images as img}
      <img src={img.url} alt="" />
    {/each}
  </div>
</article>
