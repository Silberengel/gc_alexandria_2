<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { cardMeta, displayTitle, publicationPath, wikiPath } from '$lib/metadata';
  import Cover from './Cover.svelte';
  import CardMeta from './CardMeta.svelte';

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

<div class="card pub-card">
  <a class="pub-card-cover" href={`#${href}`} use:link>
    <Cover {event} />
  </a>
  <div class="pub-card-body">
    <h3>
      {#if meta.titles.length}
        {#each meta.titles as name, i}
          {#if i > 0}<span> · </span>{/if}
          <a href={`#/search?title=${encodeURIComponent(name)}`} use:link>{name}</a>
        {/each}
      {:else}
        <a href={`#${href}`} use:link>{title}</a>
      {/if}
    </h3>
    {#if showMeta}
      <CardMeta {event} showTitles={false} />
      {#if summary}
        <p class="muted pub-card-summary">
          <a href={`#${href}`} use:link>{summary}</a>
        </p>
      {/if}
    {/if}
  </div>
</div>
