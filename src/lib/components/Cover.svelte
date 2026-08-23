<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { coverImageUrl } from '$lib/cover';
  import { coverPlaceholderUrl, coverTitle } from '$lib/cover-fallback';
  import { hasPublicationSection } from '$lib/metadata';

  interface Props {
    event: Event;
    alt?: string;
    loading?: 'lazy' | 'eager';
  }

  let { event, alt, loading = 'lazy' }: Props = $props();

  let failedFor = $state<string | null>(null);
  const remote = $derived(coverImageUrl(event));
  const broken = $derived(failedFor === event.id);
  const src = $derived(remote && !broken ? remote : coverPlaceholderUrl(event));
  const label = $derived(alt ?? coverTitle(event));
  const readable = $derived(hasPublicationSection(event));
</script>

<span class="cover-frame">
  <img {src} alt={label} {loading} onerror={() => { if (remote) failedFor = event.id; }} />
  {#if readable}
    <span class="book-badge" title="This edition can be read" aria-label="Readable edition">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    </span>
  {/if}
</span>
