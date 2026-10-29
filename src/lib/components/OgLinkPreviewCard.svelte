<script lang="ts">
  import { fetchOgPreview, ogHostname, tidyLinkUrl, type OgPreview } from '$lib/og-preview';

  interface Props {
    url: string;
  }

  let { url }: Props = $props();

  const href = $derived(tidyLinkUrl(url));
  let preview = $state<OgPreview | null | undefined>(undefined);
  let generation = 0;

  $effect(() => {
    const target = href;
    const gen = ++generation;
    let cancelled = false;
    const abort = new AbortController();
    preview = undefined;
    void (async () => {
      const hit = await fetchOgPreview(target, { signal: abort.signal });
      if (cancelled || gen !== generation) return;
      preview = hit;
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
  });
</script>

{#if preview === undefined}
  <div class="og-card og-card-loading" aria-busy="true">
    <div class="og-card-host muted">{ogHostname(href)}</div>
    <div class="og-card-desc muted">Loading preview…</div>
  </div>
{:else if preview}
  <a class="og-card" href={preview.url || href} rel="noopener noreferrer" target="_blank">
    {#if preview.image}
      <div class="og-card-image">
        <img src={preview.image} alt="" loading="lazy" decoding="async" />
      </div>
    {/if}
    <div class="og-card-body">
      <div class="og-card-host muted">{ogHostname(preview.url || href)}</div>
      {#if preview.title}
        <div class="og-card-title">{preview.title}</div>
      {/if}
      {#if preview.description}
        <div class="og-card-desc">{preview.description}</div>
      {/if}
    </div>
  </a>
{:else}
  <a class="og-card og-card-fallback" href={href} rel="noopener noreferrer" target="_blank">
    <div class="og-card-body">
      <div class="og-card-host muted">{ogHostname(href)}</div>
      <div class="og-card-title">{href}</div>
    </div>
  </a>
{/if}

<style>
  .og-card {
    display: grid;
    gap: 0.55rem;
    box-sizing: border-box;
    margin: 0.35rem 0 0.5rem;
    width: 100%;
    min-width: 0;
    max-width: min(36rem, 100%);
    padding: 0.75rem 0.9rem;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, currentColor 4%, transparent);
    color: inherit;
    text-decoration: none;
    overflow: hidden;
  }
  a.og-card:hover {
    border-color: color-mix(in srgb, currentColor 28%, transparent);
    background: color-mix(in srgb, currentColor 7%, transparent);
  }
  a.og-card:focus-visible {
    outline: 2px solid color-mix(in srgb, currentColor 45%, transparent);
    outline-offset: 2px;
  }
  .og-card-loading {
    opacity: 0.75;
  }
  .og-card-image {
    margin: -0.75rem -0.9rem 0;
    overflow: hidden;
    border-radius: 0.45rem 0.45rem 0 0;
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
  .og-card-image img {
    display: block;
    width: 100%;
    max-height: 12rem;
    object-fit: cover;
  }
  .og-card-body {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }
  .og-card-host {
    font-size: 0.78rem;
    letter-spacing: 0.02em;
    text-transform: lowercase;
  }
  .og-card-title {
    font-weight: 650;
    line-height: 1.3;
    word-break: break-word;
  }
  .og-card-desc {
    font-size: 0.9rem;
    line-height: 1.35;
    opacity: 0.82;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    word-break: break-word;
  }
  .og-card-fallback .og-card-title {
    font-weight: 500;
    font-size: 0.9rem;
    word-break: break-all;
  }
  .muted {
    opacity: 0.7;
  }
</style>
