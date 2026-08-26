<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { cardMeta } from '$lib/metadata';
  import UserBadge from './UserBadge.svelte';
  import { isAllowedHref } from '$lib/markup';

  interface Props {
    event: Event;
    showIdentifier?: boolean;
    showTitles?: boolean;
  }

  let { event, showIdentifier = false, showTitles = true }: Props = $props();
  const meta = $derived(cardMeta(event));
</script>

<p class="muted pub-card-line">
  Published by <UserBadge pubkey={meta.publishedBy} />
</p>
{#if meta.authors.length}
  <p class="muted pub-card-line">
    Author:
    {#each meta.authors as author, i}
      {#if i > 0}, {/if}
      <a href={`#/search?author=${encodeURIComponent(author)}`} use:link>{author}</a>
    {/each}
  </p>
{/if}
{#if showTitles && meta.titles.length}
  <p class="muted pub-card-line">
    Title:
    {#each meta.titles as title, i}
      {#if i > 0}, {/if}
      <a href={`#/search?title=${encodeURIComponent(title)}`} use:link>{title}</a>
    {/each}
  </p>
{/if}
{#if meta.subjects.length}
  <div class="chip-row">
    {#each meta.subjects.slice(0, showIdentifier ? 12 : 5) as subject}
      <a class="chip" href={`#/search?subject=${encodeURIComponent(subject)}`} use:link>{subject}</a>
    {/each}
  </div>
{/if}
{#if meta.source}
  <p class="muted pub-card-line">
    {#if isAllowedHref(meta.source)}
      Source: <a href={meta.source} rel="noopener noreferrer">{meta.source}</a>
    {:else}
      Source: {meta.source}
    {/if}
  </p>
{/if}
{#if showIdentifier && meta.identifier}
  <p class="muted pub-card-line">
    Identifier:
    <a href={`#/search?identifier=${encodeURIComponent(meta.identifier)}`} use:link>{meta.identifier}</a>
  </p>
{/if}
{#if showIdentifier && meta.language}
  <p class="muted pub-card-line">
    Language:
    <a href={`#/search?language=${encodeURIComponent(meta.language)}`} use:link>{meta.language}</a>
  </p>
{/if}
