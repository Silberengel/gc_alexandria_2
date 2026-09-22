<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { KIND } from '$lib/constants';
  import { cardMeta, displayTitle, publicationPath, wikiPath } from '$lib/metadata';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import Cover from './Cover.svelte';
  import CardMeta from './CardMeta.svelte';

  interface Props {
    event: Event;
    showMeta?: boolean;
  }

  let { event, showMeta = true }: Props = $props();

  $effect(() => {
    rememberEvents([event]);
  });

  const meta = $derived(cardMeta(event));
  const title = $derived(displayTitle(event));
  const isWiki = $derived(event.kind === KIND.WIKI || event.kind === KIND.SPEC);
  const href = $derived(isWiki ? wikiPath(event) : publicationPath(event));
  const summary = $derived(meta.summary?.trim() ?? '');
  const kindLabel = $derived(
    event.kind === KIND.SPEC ? 'Spec' : event.kind === KIND.WIKI ? 'Wiki' : 'Publication'
  );
</script>

<div class="card pub-card" class:pub-card-wiki={isWiki}>
  <a class="pub-card-cover" href={`#${href}`} use:link>
    <Cover {event} />
  </a>
  <div class="pub-card-body">
    <p class="pub-card-kind muted">{kindLabel}</p>
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
