<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import Cover from './Cover.svelte';
  import UserBadge from './UserBadge.svelte';
  import {
    editionMetadata,
    formatAuthorLabel,
    formatPublicationType,
    type ProvenanceChip
  } from '$lib/publication-metadata';
  import { isLibraryCopyPubkey } from '$lib/hex';
  import { isAllowedHref } from '$lib/markup';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();
  const meta = $derived(editionMetadata(event));

  async function onProvenanceClick(chip: ProvenanceChip): Promise<void> {
    if (!chip.copyText) return;
    try {
      await navigator.clipboard.writeText(chip.copyText);
    } catch {
      /* ignore */
    }
  }
</script>

<div class="edition-header">
  <div class="edition-hero">
    <div class="edition-cover">
      <Cover {event} />
    </div>
    <div class="edition-meta">
      <h1>
        {#if meta.titles.length}
          {#each meta.titles as name, i}
            {#if i > 0}<span> · </span>{/if}
            <a href={`#/search?title=${encodeURIComponent(name)}`} use:link>{name}</a>
          {/each}
        {:else}
          Untitled
        {/if}
      </h1>

      {#if meta.authors.length}
        <p class="edition-authors">
          {#each meta.authors as author, i}
            {#if i > 0}<span> · </span>{/if}
            <a href={`#/search?author=${encodeURIComponent(author.slug || author.name)}`} use:link
              >{formatAuthorLabel(author)}</a
            >
          {/each}
        </p>
      {/if}

      <p class="muted edition-publisher">
        Published by <UserBadge pubkey={event.pubkey} />
        {#if isLibraryCopyPubkey(event.pubkey)}
          <span class="muted"> · Library copy</span>
        {/if}
      </p>

      {#if meta.type || meta.language || meta.publishedBy || meta.version || meta.sectionCount > 0}
        <div class="chip-row edition-chips">
          {#if meta.type}
            <span class="chip chip-static">{formatPublicationType(meta.type)}</span>
          {/if}
          {#if meta.language}
            <a class="chip" href={`#/search?language=${encodeURIComponent(meta.language)}`} use:link
              >{meta.language.toUpperCase()}</a
            >
          {/if}
          {#if meta.publishedBy}
            <span class="chip chip-static">{meta.publishedBy}</span>
          {/if}
          {#if meta.version}
            <span class="chip chip-static">v{meta.version}</span>
          {/if}
          {#if meta.sectionCount > 0}
            <span class="chip chip-static"
              >{meta.sectionCount} {meta.sectionCount === 1 ? 'section' : 'sections'}</span
            >
          {/if}
        </div>
      {/if}

      {#if meta.releaseDate}
        <p class="muted edition-released">Released {meta.releaseDate}</p>
      {/if}

      {#if meta.provenance.length}
        <div class="chip-row edition-provenance">
          {#each meta.provenance as chip}
            {#if chip.search}
              <a
                class="chip"
                href={`#/search?identifier=${encodeURIComponent(chip.search)}`}
                use:link
                title={chip.copyText ? `Search · also copies ${chip.copyText}` : undefined}
                onclick={() => void onProvenanceClick(chip)}
              >
                {chip.label}
              </a>
            {:else if chip.href && isAllowedHref(chip.href)}
              <a class="chip" href={chip.href} rel="noopener noreferrer" target="_blank">{chip.label}</a>
            {:else}
              <span class="chip chip-static">{chip.label}</span>
            {/if}
          {/each}
        </div>
      {/if}

      {#if meta.subjects.length}
        <div class="chip-row">
          {#each meta.subjects.slice(0, 12) as subject}
            <a class="chip" href={`#/search?subject=${encodeURIComponent(subject)}`} use:link>#{subject}</a>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if meta.summary}
    <p class="edition-summary">{meta.summary}</p>
  {/if}
</div>
