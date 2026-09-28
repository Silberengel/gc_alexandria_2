<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { coverFullImageUrl, coverImageUrl } from '$lib/cover';
  import { coverAuthor, coverPlaceholderUrl, coverTitle } from '$lib/cover-fallback';
  import { hasPublicationSection, preferRicherEvent, publicationPath } from '$lib/metadata';
  import { cachedImageSrc, peekCachedImageSrc } from '$lib/image-cache';
  import { memoryGetEvent } from '$lib/nostr/event-memory';
  import { openMediaViewer } from '$lib/stores/media-viewer';

  interface Props {
    event: Event;
    alt?: string;
    loading?: 'lazy' | 'eager';
    /** Show title + author over the cover on hover / focus (shelf tiles). */
    captionOnHover?: boolean;
    /**
     * Open the media viewer on click. Off by default — shelf/card covers are
     * nested in links to the publication page.
     */
    enlargeOnClick?: boolean;
    /** When set, Open in the media viewer goes here (defaults to the publication path). */
    viewerHref?: string | null;
  }

  let {
    event,
    alt,
    loading = 'lazy',
    captionOnHover = false,
    enlargeOnClick = false,
    viewerHref
  }: Props = $props();

  let failedFor = $state<string | null>(null);
  let displaySrc = $state('');

  /** Prefer a richer in-memory copy when search returned a thin tag set. */
  const resolved = $derived.by(() => {
    const mem = memoryGetEvent(event.id);
    return mem ? preferRicherEvent(event, mem) : event;
  });
  const remote = $derived(coverImageUrl(resolved));
  const fullRemote = $derived(coverFullImageUrl(resolved));
  const placeholder = $derived(coverPlaceholderUrl(resolved));
  const broken = $derived(failedFor === event.id);
  const titleText = $derived(coverTitle(resolved));
  const authorText = $derived(coverAuthor(resolved));
  const label = $derived(alt ?? titleText);
  const readable = $derived(hasPublicationSection(resolved));
  const canEnlarge = $derived(Boolean(enlargeOnClick && fullRemote && !broken));
  const openHref = $derived(
    viewerHref === null ? undefined : (viewerHref ?? publicationPath(resolved))
  );

  $effect(() => {
    const id = event.id;
    const remoteUrl = remote;
    const ph = placeholder;
    let cancelled = false;

    if (!remoteUrl || broken) {
      displaySrc = ph;
      return;
    }

    const peek = peekCachedImageSrc(remoteUrl);
    displaySrc = peek ?? remoteUrl;

    void cachedImageSrc(remoteUrl).then((src) => {
      if (!cancelled && failedFor !== id) displaySrc = src;
    });

    return () => {
      cancelled = true;
    };
  });

  function stopNav(e: globalThis.Event): void {
    e.preventDefault();
    e.stopPropagation();
  }

  function enlarge(e: MouseEvent): void {
    if (!canEnlarge || !fullRemote) return;
    stopNav(e);
    openMediaViewer({
      url: fullRemote,
      title: titleText,
      href: openHref
    });
  }
</script>

{#if canEnlarge}
  <span
    class="cover-frame cover-frame-zoomable"
    class:cover-frame-caption={captionOnHover}
    role="button"
    tabindex="0"
    title="View cover"
    aria-label={`View cover: ${label}`}
    onpointerdown={stopNav}
    onclick={enlarge}
    onkeydown={(e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      enlarge(e as unknown as MouseEvent);
    }}
  >
    <img
      src={displaySrc || placeholder}
      alt={label}
      {loading}
      onerror={() => {
        if (remote) failedFor = event.id;
      }}
    />
    {#if readable}
      <span class="book-badge" title="This edition can be read" aria-label="Readable edition">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </span>
    {/if}
    {#if captionOnHover}
      <span class="cover-hover-label" aria-hidden="true">
        <span class="cover-hover-title">{titleText}</span>
        {#if authorText}
          <span class="cover-hover-author">{authorText}</span>
        {/if}
      </span>
    {/if}
  </span>
{:else}
  <span class="cover-frame" class:cover-frame-caption={captionOnHover}>
    <img
      src={displaySrc || placeholder}
      alt={label}
      {loading}
      onerror={() => {
        if (remote) failedFor = event.id;
      }}
    />
    {#if readable}
      <span class="book-badge" title="This edition can be read" aria-label="Readable edition">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </span>
    {/if}
    {#if captionOnHover}
      <span class="cover-hover-label" aria-hidden="true">
        <span class="cover-hover-title">{titleText}</span>
        {#if authorText}
          <span class="cover-hover-author">{authorText}</span>
        {/if}
      </span>
    {/if}
  </span>
{/if}
