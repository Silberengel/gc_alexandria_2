<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { cardMeta, displayTitle, publicationPath, wikiPath } from '$lib/metadata';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    event: Event;
    showMeta?: boolean;
  }

  let { event, showMeta = true }: Props = $props();

  const meta = $derived(cardMeta(event));
  const title = $derived(displayTitle(event));
  const href = $derived(
    event.kind === 30818 || event.kind === 30817
      ? wikiPath(event)
      : publicationPath(event)
  );
</script>

<article class="card">
  {#if meta.image}
    <a href={`#${href}`} use:link>
      <img src={meta.image} alt="" style="width:100%;max-height:10rem;object-fit:cover;border-radius:0.35rem;margin-bottom:0.75rem" />
    </a>
  {/if}
  <h3 style="margin:0 0 0.5rem"><a href={`#${href}`} use:link>{title}</a></h3>
  {#if showMeta}
    <p class="muted" style="margin:0 0 0.35rem;font-size:0.9rem">
      Published by <UserBadge pubkey={meta.publishedBy} compact />
    </p>
    {#if meta.authors.length}
      <p class="muted" style="margin:0;font-size:0.85rem">Author: {meta.authors.join(', ')}</p>
    {/if}
    {#if meta.subjects.length}
      <div class="chip-row">
        {#each meta.subjects.slice(0, 5) as subject}
          <span class="chip">{subject}</span>
        {/each}
      </div>
    {/if}
  {/if}
</article>
