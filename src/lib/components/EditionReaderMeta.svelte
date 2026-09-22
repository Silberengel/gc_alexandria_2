<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import UserBadge from './UserBadge.svelte';
  import {
    editionMetadata,
    formatAuthorLabel,
    formatPublicationType
  } from '$lib/publication-metadata';
  import { isLibraryCopyPubkey } from '$lib/hex';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();
  const meta = $derived(editionMetadata(event));

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
</script>

<div class="edition-reader-meta">
  {#if meta.authors.length}
    <p class="edition-reader-authors">
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

  <p class="muted edition-reader-publisher">
    Published by <UserBadge pubkey={event.pubkey} />
    {#if isLibraryCopyPubkey(event.pubkey)}
      <span> · Library copy</span>
    {/if}
  </p>

  {#if facts.length}
    <dl class="edition-reader-facts">
      {#each facts as fact}
        <div class="edition-reader-fact">
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
    </dl>
  {/if}

  {#if meta.summary}
    <p class="edition-reader-summary">{meta.summary}</p>
  {/if}
</div>
