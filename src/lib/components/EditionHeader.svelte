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
  import { offersVerseStyling } from '$lib/bible-verse';
  import VerseStylingToggle from './VerseStylingToggle.svelte';

  interface Props {
    event: Event;
    /** Loaded sections — helps detect bible verse styling when the index lacks type tags. */
    sections?: Event[];
  }

  let { event, sections = [] }: Props = $props();
  const meta = $derived(editionMetadata(event));
  const showVerseStyling = $derived(offersVerseStyling(event, sections));

  const facts = $derived.by(() => {
    const rows: { label: string; value: string; href?: string }[] = [];
    if (meta.type) rows.push({ label: 'Type', value: formatPublicationType(meta.type) });
    if (meta.publishedBy) rows.push({ label: 'Imprint', value: meta.publishedBy });
    if (meta.language) {
      rows.push({
        label: 'Language',
        value: meta.language.toUpperCase(),
        href: `#/search?language=${encodeURIComponent(meta.language)}`
      });
    }
    if (meta.version) rows.push({ label: 'Version', value: `v${meta.version}` });
    if (meta.sectionCount > 0) {
      rows.push({
        label: 'Length',
        value: `${meta.sectionCount} ${meta.sectionCount === 1 ? 'section' : 'sections'}`
      });
    }
    if (meta.releaseDate) rows.push({ label: 'Released', value: meta.releaseDate });
    return rows;
  });

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
            {#if i > 0}<span class="edition-title-sep"> · </span>{/if}
            <a class="edition-title-link" href={`#/search?title=${encodeURIComponent(name)}`} use:link>{name}</a>
          {/each}
        {:else}
          Untitled
        {/if}
      </h1>

      {#if meta.authors.length}
        <p class="edition-authors">
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

      <p class="muted edition-publisher">
        Published by <UserBadge pubkey={event.pubkey} />
        {#if isLibraryCopyPubkey(event.pubkey)}
          <span> · Library copy</span>
        {/if}
      </p>

      {#if facts.length}
        <dl class="edition-facts">
          {#each facts as fact}
            <div class="edition-fact">
              <dt>{fact.label}</dt>
              <dd>
                {#if fact.href}
                  <a class="edition-inline-link" href={fact.href} use:link>{fact.value}</a>
                {:else}
                  {fact.value}
                {/if}
              </dd>
            </div>
          {/each}
          {#if showVerseStyling}
            <div class="edition-fact edition-fact-control">
              <dt>verse-styling</dt>
              <dd><VerseStylingToggle /></dd>
            </div>
          {/if}
        </dl>
      {:else if showVerseStyling}
        <div class="edition-verse-styling-row">
          <VerseStylingToggle />
        </div>
      {/if}

      {#if meta.subjects.length}
        <div class="edition-block">
          <p class="edition-block-label">Topics</p>
          <ul class="edition-topic-list">
            {#each meta.subjects.slice(0, 12) as subject}
              <li>
                <a
                  class="edition-topic"
                  href={`#/search?subject=${encodeURIComponent(subject)}`}
                  use:link
                >#{subject}</a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if meta.provenance.length}
        <div class="edition-block">
          <p class="edition-block-label">Sources</p>
          <ul class="edition-source-list">
            {#each meta.provenance as chip}
              <li>
                {#if chip.search}
                  <a
                    class="edition-source-link"
                    href={`#/search?${chip.searchKey ?? 'identifier'}=${encodeURIComponent(chip.search)}`}
                    use:link
                    title={chip.copyText ? `Search · also copies ${chip.copyText}` : 'Search this identifier'}
                    onclick={() => void onProvenanceClick(chip)}
                  >{chip.label}</a>
                {:else if chip.href && isAllowedHref(chip.href)}
                  <a
                    class="edition-source-link"
                    href={chip.href}
                    rel="noopener noreferrer"
                    target="_blank"
                  >{chip.label}</a>
                {:else}
                  <span class="edition-source-label">{chip.label}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>

  {#if meta.summary}
    <p class="edition-summary">{meta.summary}</p>
  {/if}
</div>
