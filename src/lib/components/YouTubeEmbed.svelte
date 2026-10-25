<script lang="ts">
  import { parseYouTubeUrl, youtubeEmbedSrc, type YouTubeRef } from '$lib/youtube';

  interface Props {
    url: string;
    /** Pre-parsed ref when the caller already has one. */
    ref?: YouTubeRef | null;
  }

  let { url, ref = null }: Props = $props();

  const parsed = $derived(ref ?? parseYouTubeUrl(url));
  const src = $derived(parsed ? youtubeEmbedSrc(parsed) : '');
  const href = $derived(parsed?.sourceUrl || url);
</script>

{#if parsed && src}
  <div class="youtube-embed">
    <iframe
      class="youtube-embed-frame"
      src={src}
      title="YouTube video"
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>
    <a class="youtube-embed-open muted" href={href} rel="noopener noreferrer" target="_blank"
      >Open on YouTube</a
    >
  </div>
{/if}

<style>
  .youtube-embed {
    display: grid;
    gap: 0.3rem;
    margin: 0.35rem 0 0.5rem;
    max-width: 36rem;
  }
  .youtube-embed-frame {
    display: block;
    width: 100% !important;
    max-width: 100% !important;
    max-height: none !important;
    aspect-ratio: 16 / 9;
    height: auto !important;
    margin: 0 !important;
    border: 0;
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--surface-2) 80%, #000);
  }
  .youtube-embed-open {
    font-size: 0.82rem;
  }
</style>
