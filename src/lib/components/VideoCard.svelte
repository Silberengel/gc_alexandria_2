<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import { uniqueMedia, posterUrl, contentWithoutMediaUrls } from '$lib/media';
  import { displayTitle } from '$lib/metadata';
  import { isAllowedMediaUrl } from '$lib/markup';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();
  const video = $derived(uniqueMedia(event).find((m) => m.type === 'video' && isAllowedMediaUrl(m.url)));
  const poster = $derived(posterUrl(event));
  const title = $derived(displayTitle(event));
  const caption = $derived(contentWithoutMediaUrls(event.content, uniqueMedia(event)));
</script>

<article class="card video-card">
  <p class="muted">Published by <UserBadge pubkey={event.pubkey} /></p>
  {#if title !== 'Untitled'}<h3>{title}</h3>{/if}
  {#if video}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video class="generic-media" src={video.url} controls poster={poster && isAllowedMediaUrl(poster) ? poster : undefined}></video>
  {/if}
  {#if caption}
    <p class="muted">{caption}</p>
  {/if}
</article>
