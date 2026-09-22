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
  const subjects = $derived(meta.subjects.slice(0, 5));
  const kindLabel = $derived(
    event.kind === KIND.SPEC ? 'Spec' : event.kind === KIND.WIKI ? 'Wiki' : 'Publication'
  );
</script>

<div class="card pub-card" class:pub-card-wiki={isWiki}>
  <div class="pub-card-top">
    <a class="pub-card-cover" href={`#${href}`} use:link>
      <Cover {event} />
    </a>
    <div class="pub-card-body">
      <p class="pub-card-kind muted">{kindLabel}</p>
      <h3>
        {#if meta.titles.length}
          <a href={`#${href}`} use:link>
            {#each meta.titles as name, i}
              {#if i > 0}<span> · </span>{/if}{name}
            {/each}
          </a>
        {:else}
          <a href={`#${href}`} use:link>{title}</a>
        {/if}
      </h3>
      {#if showMeta}
        <CardMeta {event} showTitles={false} showSubjects={false} />
      {/if}
    </div>
  </div>
  {#if showMeta && summary}
    <p class="muted pub-card-summary">
      <a href={`#${href}`} use:link>{summary}</a>
    </p>
  {/if}
  {#if showMeta && subjects.length}
    <div class="pub-card-tags chip-row">
      {#each subjects as subject}
        <a class="chip chip-quiet" href={`#/search?subject=${encodeURIComponent(subject)}`} use:link
          >{subject}</a
        >
      {/each}
    </div>
  {/if}
</div>
