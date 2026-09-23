<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { KIND } from '$lib/constants';
  import { warmNavEvent } from '$lib/nav-warm';
  import { cardMeta, displayTitle, publicationPath, wikiPath } from '$lib/metadata';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import { warmWikiDeferTarget } from '$lib/wiki-defer';
  import Cover from './Cover.svelte';
  import CardMeta from './CardMeta.svelte';

  interface Props {
    event: Event;
    showMeta?: boolean;
    /** `card` = detailed result card; `row` = compact list line. */
    variant?: 'card' | 'row';
  }

  let { event, showMeta = true, variant = 'card' }: Props = $props();

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
  const authorByline = $derived(
    meta.authors.length
      ? meta.authors
          .map((author) => author.trim())
          .filter(Boolean)
          .join(' · ')
      : ''
  );
  const isRow = $derived(variant === 'row');

  function warmSelf(): void {
    warmNavEvent(event);
  }

  function warmDefer(): void {
    warmWikiDeferTarget(event);
  }
</script>

{#if isRow}
  <a class="listing-row" href={`#${href}`} use:link onpointerdown={warmSelf}>
    <span class="listing-row-cover">
      <Cover {event} />
    </span>
    <span class="listing-row-body">
      <span class="listing-row-title">
        {#if meta.titles.length}
          {#each meta.titles as name, i}
            {#if i > 0}<span> · </span>{/if}{name}
          {/each}
        {:else}
          {title}
        {/if}
      </span>
      {#if authorByline}
        <span class="listing-row-meta muted">{authorByline}</span>
      {:else}
        <span class="listing-row-meta muted">{kindLabel}</span>
      {/if}
    </span>
  </a>
{:else}
  <div class="card pub-card" class:pub-card-wiki={isWiki}>
    <div class="pub-card-top">
      <a class="pub-card-cover" href={`#${href}`} use:link onpointerdown={warmSelf}>
        <Cover {event} />
      </a>
      <div class="pub-card-body">
        <p class="pub-card-kind muted">{kindLabel}</p>
        <h3>
          {#if meta.titles.length}
            <a href={`#${href}`} use:link onpointerdown={warmSelf}>
              {#each meta.titles as name, i}
                {#if i > 0}<span> · </span>{/if}{name}
              {/each}
            </a>
          {:else}
            <a href={`#${href}`} use:link onpointerdown={warmSelf}>{title}</a>
          {/if}
        </h3>
        {#if showMeta}
          <CardMeta {event} showTitles={false} showSubjects={false} />
        {/if}
      </div>
    </div>
    {#if showMeta && meta.defers}
      <div class="pub-card-defer">
        <p class="pub-card-defer-label">The author defers to another version</p>
        {#if meta.deferHref}
          <a
            class="pub-card-defer-link"
            href={`#${meta.deferHref}`}
            use:link
            onpointerdown={warmDefer}>Open preferred version</a
          >
        {:else}
          <a class="pub-card-defer-link" href={`#${href}`} use:link onpointerdown={warmSelf}
            >Open this version</a
          >
        {/if}
      </div>
    {:else if showMeta && summary}
      <p class="muted pub-card-summary">{summary}</p>
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
{/if}
