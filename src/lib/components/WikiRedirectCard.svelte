<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { parseWikiRedirect, wikiRedirectTargetHref } from '$lib/wiki-redirect';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const parsed = $derived(parseWikiRedirect(event));
  const href = $derived(wikiRedirectTargetHref(event));
</script>

{#if parsed}
  <div class="wiki-redirect-card">
    <p class="wiki-redirect-kind muted">KIND: 30819 · Wiki redirect</p>
    <p class="wiki-redirect-alias">
      <span class="muted">Alias</span>
      <strong>{parsed.alias || '(empty)'}</strong>
    </p>
    {#if href}
      <p>
        Redirects to
        <a href={`#${href}`}>{parsed.targetCoordinate}</a>
      </p>
    {:else if parsed.targetCoordinate}
      <p class="muted">Target: {parsed.targetCoordinate}</p>
    {/if}
  </div>
{/if}

<style>
  .wiki-redirect-card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .wiki-redirect-kind {
    margin: 0;
    font-size: 0.75rem;
  }
  .wiki-redirect-alias {
    margin: 0;
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
</style>
