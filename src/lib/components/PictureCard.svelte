<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import { uniqueMedia } from '$lib/media';
  import { displayTitle } from '$lib/metadata';
  import { isAllowedMediaUrl } from '$lib/markup';
  import { openMediaViewer } from '$lib/stores/media-viewer';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();
  const images = $derived(
    uniqueMedia(event).filter((m) => m.type === 'image' && isAllowedMediaUrl(m.url))
  );
  const imageUrls = $derived(images.map((img) => img.url));
  const imageAlts = $derived(images.map((img) => img.alt?.trim() || ''));
  const title = $derived(displayTitle(event));

  function openGallery(url: string): void {
    openMediaViewer({
      url,
      urls: imageUrls,
      alts: imageAlts,
      title: title !== 'Untitled' ? title : undefined
    });
  }
</script>

<article class="card picture-card">
  <p class="muted">Published by <UserBadge pubkey={event.pubkey} /></p>
  {#if title !== 'Untitled'}<h3>{title}</h3>{/if}
  <div class="picture-gallery">
    {#each images as img}
      {@const alt = img.alt?.trim() || ''}
      <button
        class="picture-gallery-btn"
        type="button"
        title={alt || (imageUrls.length > 1 ? 'View gallery' : 'View image')}
        aria-label={alt || (imageUrls.length > 1 ? 'View gallery' : 'View image')}
        onclick={() => openGallery(img.url)}
      >
        <img src={img.url} {alt} loading="lazy" />
      </button>
    {/each}
  </div>
</article>
