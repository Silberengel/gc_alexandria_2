<script lang="ts">
  import {
    parseYouTubeUrl,
    youtubeEmbedSrc,
    youtubeOpenUrl,
    youtubeStillUrl,
    type YouTubeRef
  } from '$lib/youtube';

  interface Props {
    url: string;
    /** Pre-parsed ref when the caller already has one. */
    ref?: YouTubeRef | null;
  }

  let { url, ref = null }: Props = $props();

  const parsed = $derived(ref ?? parseYouTubeUrl(url));
  const embedSrc = $derived(parsed ? youtubeEmbedSrc(parsed) : null);
  const href = $derived(parsed ? youtubeOpenUrl(parsed) : url);
  const still = $derived(parsed ? youtubeStillUrl(parsed) : null);
</script>

{#if parsed}
  <div class="youtube-embed" class:is-music={parsed.music}>
    {#if embedSrc}
      <iframe
        class="youtube-embed-frame"
        src={embedSrc}
        title="YouTube video"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    {:else if still}
      <a class="youtube-embed-still" href={href} rel="noopener noreferrer" target="_blank">
        <img src={still} alt="" loading="lazy" decoding="async" />
        <span class="youtube-embed-play" aria-hidden="true"></span>
      </a>
    {/if}
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
  .youtube-embed-still {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--surface-2) 80%, #000);
  }
  .youtube-embed-still img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .youtube-embed-play {
    position: absolute;
    inset: 50% auto auto 50%;
    width: 3.25rem;
    height: 2.25rem;
    translate: -50% -50%;
    border-radius: 0.55rem;
    background: color-mix(in srgb, #f00 88%, #000);
    box-shadow: 0 0.15rem 0.6rem rgb(0 0 0 / 35%);
  }
  .youtube-embed-play::after {
    content: '';
    position: absolute;
    inset: 50% auto auto 52%;
    translate: -40% -50%;
    border-style: solid;
    border-width: 0.45rem 0 0.45rem 0.75rem;
    border-color: transparent transparent transparent #fff;
  }
  .youtube-embed-still:hover .youtube-embed-play,
  .youtube-embed-still:focus-visible .youtube-embed-play {
    background: #f00;
  }
  .youtube-embed-open {
    font-size: 0.82rem;
  }
</style>
