<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { feedThreadPath } from '$lib/feed';
  import { toNostrBuildThumbUrl } from '$lib/nostr-build';
  import { warmNavEvent } from '$lib/nav-warm';
  import {
    pinboardFirstEventRef,
    pinboardFirstOgUrl,
    pinboardHandText,
    pinboardResolveEmbeddedExcerpt,
    pinboardResolveFaceImage,
    pinboardSlipPreview,
    pinboardSlipVideo,
    pinboardSyncFaceImage
  } from '$lib/profile-pins';
  import { fetchOgPreview, ogHostname, type OgPreview } from '$lib/og-preview';

  interface Props {
    event: Event;
    hero?: boolean;
  }

  let { event, hero = false }: Props = $props();

  const localPreview = $derived(pinboardSlipPreview(event, hero ? 220 : 110));
  const syncFace = $derived(pinboardSyncFaceImage(event));
  const syncVideo = $derived(pinboardSlipVideo(event));
  const ogUrl = $derived(pinboardFirstOgUrl(event));
  const handText = $derived(pinboardHandText(event));
  const hasEventEmbed = $derived(!!pinboardFirstEventRef(event));
  const href = $derived(`#${feedThreadPath(event)}`);

  let faceImage = $state<string | null>(null);
  let embedExcerpt = $state('');
  let og = $state<OgPreview | null | undefined>(undefined);
  let faceGen = 0;
  let embedGen = 0;
  let ogGen = 0;

  $effect(() => {
    const note = event;
    const immediate = pinboardSyncFaceImage(note);
    faceImage = immediate;
    const gen = ++faceGen;
    let cancelled = false;
    const abort = new AbortController();
    void (async () => {
      const hit = await pinboardResolveFaceImage(note, { signal: abort.signal });
      if (cancelled || gen !== faceGen) return;
      faceImage = hit ?? immediate;
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
  });

  $effect(() => {
    const note = event;
    const local = pinboardSlipPreview(note, hero ? 220 : 110);
    embedExcerpt = '';
    // Own text wins; only fetch an embedded note when the slip would otherwise be empty.
    if (local || !pinboardFirstEventRef(note)) return;
    const gen = ++embedGen;
    let cancelled = false;
    const abort = new AbortController();
    void (async () => {
      const hit = await pinboardResolveEmbeddedExcerpt(note, {
        signal: abort.signal,
        maxChars: hero ? 220 : 110
      });
      if (cancelled || gen !== embedGen) return;
      embedExcerpt = hit;
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
  });

  $effect(() => {
    const target = ogUrl;
    if (!target) {
      og = undefined;
      return;
    }
    const gen = ++ogGen;
    let cancelled = false;
    const abort = new AbortController();
    og = undefined;
    void (async () => {
      const hit = await fetchOgPreview(target, { signal: abort.signal });
      if (cancelled || gen !== ogGen) return;
      og = hit;
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
  });

  const preview = $derived(localPreview || embedExcerpt || og?.title?.trim() || '');
  const label = $derived(preview || handText || 'Open note');
  const displayFace = $derived(faceImage || syncFace);
  const faceThumb = $derived(
    displayFace ? toNostrBuildThumbUrl(displayFace) || displayFace : ''
  );
  const showOgPhoto = $derived(!!og?.image);
  const showOgMeta = $derived(!!og && !showOgPhoto && (!!og.title || !!og.description));
  const showVideoFace = $derived(!!syncVideo && !displayFace);
  const waitingOg = $derived(
    !!ogUrl && og === undefined && !displayFace && !showVideoFace && !localPreview
  );
  const waitingEmbed = $derived(
    hasEventEmbed &&
      !localPreview &&
      !embedExcerpt &&
      !displayFace &&
      !showVideoFace &&
      !showOgPhoto &&
      !showOgMeta
  );
</script>

<a
  class="pin-slip"
  class:pin-slip-hero={hero}
  class:pin-slip-og-photo={showOgPhoto}
  {href}
  use:link
  title={label}
  aria-label={label}
  onpointerdown={() => warmNavEvent(event)}
  onclick={() => warmNavEvent(event)}
>
  <span class="pin-slip-pin" aria-hidden="true"></span>

  {#if showOgPhoto && og?.image}
    <span class="pin-slip-photo">
      <img src={og.image} alt="" loading="lazy" decoding="async" />
      {#if handText}
        <span class="pin-slip-hand" aria-hidden="true">{handText}</span>
      {/if}
    </span>
    <span class="pin-slip-og-caption">
      <span class="pin-slip-og-host">{ogHostname(og.url || ogUrl || '')}</span>
      {#if og.title}
        <span class="pin-slip-og-title">{og.title}</span>
      {/if}
    </span>
  {:else if showOgMeta && og}
    <span class="pin-slip-og-plain">
      {#if handText}
        <span class="pin-slip-hand-plain">{handText}</span>
      {/if}
      <span class="pin-slip-og-host">{ogHostname(og.url || ogUrl || '')}</span>
      {#if og.title}
        <span class="pin-slip-og-title">{og.title}</span>
      {/if}
      {#if og.description}
        <span class="pin-slip-og-desc">{og.description}</span>
      {/if}
    </span>
  {:else if waitingOg || waitingEmbed}
    <span class="pin-slip-text muted">Loading preview…</span>
  {:else}
    {#if displayFace && faceThumb}
      <span class="pin-slip-media">
        <img src={faceThumb} alt="" loading="lazy" decoding="async" />
      </span>
    {:else if syncVideo}
      <span class="pin-slip-media pin-slip-media-video">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src={syncVideo.url}
          poster={syncVideo.poster}
          muted
          playsinline
          preload="metadata"
        ></video>
      </span>
    {/if}
    {#if preview}
      <span class="pin-slip-text">{preview}</span>
    {:else if !displayFace && !syncVideo}
      <span class="pin-slip-text muted">Untitled note</span>
    {/if}
  {/if}
</a>
