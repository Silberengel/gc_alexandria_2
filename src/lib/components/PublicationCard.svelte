<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { cardMeta, displayTitle, publicationPath, wikiPath } from '$lib/metadata';
  import Cover from './Cover.svelte';
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
  const summary = $derived(meta.summary?.trim() ?? '');
</script>

<article class="card pub-card">
  <a class="pub-card-cover" href={`#${href}`} use:link>
    <Cover {event} />
  </a>
  <div class="pub-card-body">
    <h3><a href={`#${href}`} use:link>{title}</a></h3>
    {#if showMeta}
      <p class="muted pub-card-line">
        Published by <UserBadge pubkey={meta.publishedBy} />
      </p>
      {#if meta.authors.length}
        <p class="muted pub-card-line">Author: {meta.authors.join(', ')}</p>
      {/if}
      {#if summary}
        <p class="muted pub-card-summary">{summary}</p>
      {/if}
      {#if meta.subjects.length}
        <div class="chip-row">
          {#each meta.subjects.slice(0, 5) as subject}
            <span class="chip">{subject}</span>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</article>
