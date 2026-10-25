<script lang="ts">
  import YouTubeEmbed from './YouTubeEmbed.svelte';
  import OgLinkPreviewCard from './OgLinkPreviewCard.svelte';
  import { parseYouTubeUrl } from '$lib/youtube';
  import { shouldOgPreview } from '$lib/og-preview';

  interface Props {
    url: string;
  }

  let { url }: Props = $props();

  const href = $derived(url.trim());
  const youtube = $derived(parseYouTubeUrl(href));
  const useOg = $derived(!youtube && shouldOgPreview(href));
</script>

{#if youtube}
  <YouTubeEmbed url={href} />
{:else if useOg}
  <OgLinkPreviewCard url={href} />
{:else if href}
  <p class="web-bookmark-link">
    <a href={href} rel="noopener noreferrer" target="_blank">{href}</a>
  </p>
{/if}

<style>
  .web-bookmark-link {
    margin: 0.55rem 0 0;
    word-break: break-word;
  }
  .web-bookmark-link a {
    color: var(--accent);
  }
</style>
