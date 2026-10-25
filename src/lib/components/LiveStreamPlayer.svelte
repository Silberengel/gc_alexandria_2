<script lang="ts">
  import { onDestroy } from 'svelte';
  import type Hls from 'hls.js';
  import { isAllowedMediaUrl } from '$lib/markup';
  import { isDirectPlayableMediaUrl, isHlsMediaUrl, isVideoMediaUrl } from '$lib/live-stream';

  interface Props {
    url: string;
    poster?: string | null;
    /** Start behind a tap-to-play overlay (imwald TapToLoadMedia). */
    tapToLoad?: boolean;
  }

  let { url, poster = null, tapToLoad = true }: Props = $props();

  let videoEl = $state<HTMLVideoElement | null>(null);
  let audioEl = $state<HTMLAudioElement | null>(null);
  let started = $state(false);
  let error = $state('');
  let hls: Hls | null = null;

  const posterOk = $derived(!!poster && isAllowedMediaUrl(poster));
  const playOk = $derived(isAllowedMediaUrl(url));
  const hlsPlay = $derived(playOk && isHlsMediaUrl(url));
  const directPlay = $derived(playOk && isDirectPlayableMediaUrl(url));
  const useVideo = $derived(hlsPlay || (directPlay && isVideoMediaUrl(url)));

  $effect(() => {
    started = !tapToLoad;
  });

  function tearDown(): void {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    if (videoEl) {
      videoEl.removeAttribute('src');
      videoEl.load();
    }
    if (audioEl) {
      audioEl.removeAttribute('src');
      audioEl.load();
    }
  }

  async function attachStream(media: HTMLVideoElement | HTMLAudioElement): Promise<void> {
    error = '';
    if (!playOk) {
      error = 'This stream URL is blocked.';
      return;
    }
    if (hlsPlay && media instanceof HTMLVideoElement) {
      const canNative =
        media.canPlayType('application/vnd.apple.mpegurl') ||
        media.canPlayType('application/x-mpegURL');
      if (canNative) {
        media.src = url;
        try {
          await media.play();
        } catch {
          /* user gesture / autoplay policy */
        }
        return;
      }
      const { default: HlsCtor } = await import('hls.js');
      if (!HlsCtor.isSupported()) {
        error = 'Live HLS is not supported in this browser.';
        return;
      }
      if (hls) {
        hls.destroy();
        hls = null;
      }
      hls = new HlsCtor({
        enableWorker: true,
        lowLatencyMode: true
      });
      hls.loadSource(url);
      hls.attachMedia(media);
      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
        void media.play().catch(() => {});
      });
      hls.on(HlsCtor.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        error = 'Could not play this live stream.';
        tearDown();
      });
      return;
    }
    if (directPlay) {
      media.src = url;
      try {
        await media.play();
      } catch {
        /* ignore */
      }
      return;
    }
    error = 'No playable stream found.';
  }

  function start(): void {
    started = true;
  }

  /** Wait until the media element is bound — attach before that always fails. */
  $effect(() => {
    if (!started) return;
    void url;
    const media = useVideo ? videoEl : audioEl;
    if (!media) return;
    void attachStream(media);
    return () => tearDown();
  });

  onDestroy(() => tearDown());
</script>

{#if !playOk}
  <p class="live-player-error muted">Stream URL is not allowed.</p>
{:else if !started}
  <button type="button" class="live-player-tap" onclick={start}>
    {#if posterOk}
      <img class="live-player-poster" src={poster!} alt="" loading="lazy" />
    {:else}
      <span class="live-player-poster live-player-poster-empty" aria-hidden="true"></span>
    {/if}
    <span class="live-player-play" aria-hidden="true">▶</span>
    <span class="live-player-tap-label">Tap to play live</span>
  </button>
{:else}
  <div class="live-player-stage">
    {#if useVideo}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        class="live-player-media"
        bind:this={videoEl}
        poster={posterOk ? poster! : undefined}
        controls
        playsinline
        preload="metadata"
      ></video>
    {:else}
      {#if posterOk}
        <img class="live-player-poster" src={poster!} alt="" loading="lazy" />
      {/if}
      <!-- svelte-ignore a11y_media_has_caption -->
      <audio class="live-player-audio" bind:this={audioEl} controls></audio>
    {/if}
    {#if error}
      <p class="live-player-error muted">{error}</p>
      <p class="live-player-open">
        <a href={url} rel="noopener noreferrer" target="_blank">Open stream</a>
      </p>
    {/if}
  </div>
{/if}

<style>
  .live-player-tap {
    position: relative;
    display: block;
    width: 100%;
    margin: 0.25rem 0 0;
    padding: 0;
    border: none;
    border-radius: 0.35rem;
    overflow: hidden;
    cursor: pointer;
    background: color-mix(in srgb, var(--ink) 8%, var(--paper));
    color: inherit;
    text-align: left;
  }
  .live-player-poster {
    display: block;
    width: 100%;
    max-height: 16rem;
    object-fit: cover;
    background: color-mix(in srgb, var(--ink) 6%, var(--paper));
  }
  .live-player-poster-empty {
    min-height: 10rem;
  }
  .live-player-play {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -55%);
    width: 3rem;
    height: 3rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, #b3261e 92%, black);
    color: #fff;
    font-size: 1rem;
    box-shadow: 0 0.35rem 1rem color-mix(in srgb, black 35%, transparent);
  }
  .live-player-tap-label {
    position: absolute;
    left: 0.75rem;
    bottom: 0.65rem;
    padding: 0.2rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.78rem;
    font-weight: 650;
    letter-spacing: 0.02em;
    background: color-mix(in srgb, black 55%, transparent);
    color: #fff;
  }
  .live-player-stage {
    margin-top: 0.25rem;
  }
  .live-player-media {
    display: block;
    width: 100%;
    max-height: 18rem;
    border-radius: 0.35rem;
    background: #000;
  }
  .live-player-audio {
    width: 100%;
    margin-top: 0.35rem;
  }
  .live-player-error {
    margin: 0.4rem 0 0;
    font-size: 0.9rem;
  }
  .live-player-open {
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }
</style>
