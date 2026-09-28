<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { KIND } from '$lib/constants';
  import { cardMeta, hasPublicationSection, preferRicherEvent } from '$lib/metadata';
  import { memoryGetEvent } from '$lib/nostr/event-memory';
  import UserBadge from './UserBadge.svelte';
  import { isAllowedHref } from '$lib/markup';

  interface Props {
    event: Event;
    showIdentifier?: boolean;
    showTitles?: boolean;
    showSubjects?: boolean;
  }

  let { event, showIdentifier = false, showTitles = true, showSubjects = true }: Props = $props();

  const resolved = $derived.by(() => {
    const mem = memoryGetEvent(event.id);
    return mem ? preferRicherEvent(event, mem) : event;
  });
  const meta = $derived(cardMeta(resolved));
  const isPublication = $derived(resolved.kind === KIND.PUBLICATION);
  const readable = $derived(isPublication && hasPublicationSection(resolved));
</script>

{#if isPublication}
  <p
    class="pub-card-line pub-card-readable"
    class:pub-card-readable-yes={readable}
    class:pub-card-readable-no={!readable}
  >
    {#if readable}
      Readable on Alexandria
    {:else}
      Not readable on Alexandria
    {/if}
  </p>
{/if}
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
{#if meta.source}
  <p class="muted pub-card-line pub-card-source">
    {#if isAllowedHref(meta.source)}
      Source: <a href={meta.source} rel="noopener noreferrer">{meta.source}</a>
    {:else}
      Source: {meta.source}
    {/if}
  </p>
{/if}
{#if showSubjects && meta.subjects.length}
  <div class="chip-row">
    {#each meta.subjects.slice(0, showIdentifier ? 12 : 5) as subject}
      <a class="chip" href={`#/search?subject=${encodeURIComponent(subject)}`} use:link>{subject}</a>
    {/each}
  </div>
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
