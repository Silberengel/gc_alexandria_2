<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import VerseStylingToggle from './VerseStylingToggle.svelte';
  import { editionMetadata, formatAuthorLabel } from '$lib/publication-metadata';
  import { isLibraryCopyPubkey } from '$lib/hex';
  import { offersVerseStyling } from '$lib/bible-verse';

  interface Props {
    event: Event;
    sections?: Event[];
  }

  let { event, sections = [] }: Props = $props();
  const meta = $derived(editionMetadata(event));
  const showVerseStyling = $derived(offersVerseStyling(event, sections));
</script>

<div class="edition-reader-meta">
  {#if meta.authors.length}
    <p class="edition-reader-authors">
      {#each meta.authors as author, i}
        {#if i > 0}<span> · </span>{/if}
        <a
          class="edition-inline-link"
          href={`#/search?author=${encodeURIComponent(author.slug || author.name)}`}
          use:link
        >{formatAuthorLabel(author)}</a>
      {/each}
    </p>
  {/if}

  <p class="muted edition-reader-publisher">
    Published by <UserBadge pubkey={event.pubkey} />
    {#if isLibraryCopyPubkey(event.pubkey)}
      <span> · Library copy</span>
    {/if}
  </p>

  {#if showVerseStyling}
    <div class="edition-reader-verse-styling">
      <VerseStylingToggle />
    </div>
  {/if}

  {#if meta.summary}
    <p class="edition-reader-summary">{meta.summary}</p>
  {/if}
</div>
