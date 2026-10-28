<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import Nip51MigrateButton from './Nip51MigrateButton.svelte';
  import WebBookmarkEmbed from './WebBookmarkEmbed.svelte';
  import { eventPreview } from '$lib/event-preview';
  import { isDeprecatedNip51List } from '$lib/nip51-deprecated-lists';
  import { dedupeMediaUrls, mediaAltForUrl, uniqueMedia } from '$lib/media';
  import { isAllowedMediaUrl } from '$lib/markup';
  import { openMediaViewer } from '$lib/stores/media-viewer';
  import { webBookmarkUrl } from '$lib/web-bookmark';

  interface Props {
    event: Event;
    embedDepth?: number;
    /** When false, hide the ⋯ menu (embedded citations). */
    showMenu?: boolean;
  }

  let { event, showMenu = true }: Props = $props();

  const preview = $derived(eventPreview(event));
  const media = $derived(uniqueMedia(event));
  const bookmarkUrl = $derived(webBookmarkUrl(event));
  const galleryUrls = $derived(
    dedupeMediaUrls([
      ...preview.imageUrls,
      ...media.filter((m) => m.type === 'image').map((m) => m.url)
    ]).filter((url) => isAllowedMediaUrl(url))
  );
  const galleryAlts = $derived(galleryUrls.map((url) => mediaAltForUrl(media, url)));
  const showNip51Migrate = $derived(isDeprecatedNip51List(event));
  let brokenUrls = $state<Record<string, true>>({});

  function openGallery(url: string, e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    openMediaViewer({
      url,
      urls: galleryUrls,
      alts: galleryAlts,
      title: preview.headline || undefined
    });
  }

  function markBroken(url: string): void {
    if (brokenUrls[url]) return;
    brokenUrls = { ...brokenUrls, [url]: true };
  }
</script>

<article class="card generic-card" class:generic-card-migrate={showNip51Migrate}>
  {#if showMenu}
    <CopyPointerButton {event} class="generic-card-copy" />
  {/if}
  <div class="card-clip">
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
  {#each galleryUrls.slice(0, 4) as url}
    {@const alt = mediaAltForUrl(media, url)}
    {@const broken = !!brokenUrls[url]}
    <button
      class="event-imeta-btn"
      class:is-broken={broken}
      type="button"
      title={alt || (galleryUrls.length > 1 ? 'View gallery' : 'View image')}
      aria-label={alt || (galleryUrls.length > 1 ? 'View gallery' : 'View image')}
      onclick={(e) => openGallery(url, e)}
    >
      <img
        class="generic-media"
        src={url}
        alt={broken ? '' : alt}
        loading="lazy"
        decoding="async"
        onerror={() => markBroken(url)}
      />
      {#if broken}
        <span class="event-imeta-fallback">{alt || 'Image unavailable'}</span>
      {/if}
    </button>
  {/each}
  {#each media.filter((m) => m.type === 'video' || m.type === 'audio') as item}
    {#if item.type === 'video' && isAllowedMediaUrl(item.url)}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video class="generic-media" src={item.url} controls></video>
    {:else if item.type === 'audio' && isAllowedMediaUrl(item.url)}
      <audio src={item.url} controls></audio>
    {/if}
  {/each}
  {#if bookmarkUrl}
    <WebBookmarkEmbed url={bookmarkUrl} />
  {/if}
  {#if preview.summary && preview.summary !== preview.body}
    <p class="generic-card-summary muted">{preview.summary}</p>
  {/if}
  {#if preview.body}
    <p class="generic-card-body muted">{preview.body}</p>
  {:else if !preview.summary && !media.length && !preview.imageUrls.length && !bookmarkUrl}
    <p class="muted generic-card-empty">No text in this event.</p>
  {/if}
  </div>
  {#if showNip51Migrate}
    <Nip51MigrateButton {event} />
  {/if}
</article>
