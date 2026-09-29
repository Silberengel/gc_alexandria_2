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
  import { KIND } from '$lib/constants';
  import { coverFullImageUrl, coverImageUrl } from '$lib/cover';
  import { coverPlaceholderUrl, coverTitle } from '$lib/cover-fallback';
  import { isLibraryCopyPubkey } from '$lib/hex';
  import { isAllowedHref } from '$lib/markup';
  import { offersVerseStyling } from '$lib/bible-verse';
  import { openMediaViewer } from '$lib/stores/media-viewer';
  import VerseStylingToggle from './VerseStylingToggle.svelte';
  import type { Snippet } from 'svelte';
  import Stars from './Stars.svelte';

  interface Props {
    event: Event;
    /** Loaded sections — helps detect bible verse styling when the index lacks type tags. */
    sections?: Event[];
    /** Average on a 1–5 scale when the edition has scored ratings. */
    ratingAverage?: number;
    ratingCount?: number;
    /** Extra content in the meta column (e.g. People). */
    children?: Snippet;
  }

  let { event, sections = [], ratingAverage, ratingCount = 0, children }: Props = $props();
  const meta = $derived(editionMetadata(event));
  const isLongForm = $derived(event.kind === KIND.LONG_FORM);
  const showVerseStyling = $derived(offersVerseStyling(event, sections));
  const showCardRating = $derived(
    typeof ratingAverage === 'number' && Number.isFinite(ratingAverage) && ratingCount > 0
  );

  const remoteCover = $derived(coverImageUrl(event));
  const fullCover = $derived(coverFullImageUrl(event) ?? remoteCover);
  const generatedCover = $derived(coverPlaceholderUrl(event));
  const heroSrc = $derived(remoteCover || generatedCover);
  const showGeneratedHero = $derived(!remoteCover);
  const heroTitle = $derived(meta.titles[0] || coverTitle(event));

  function scrollToRatings(): void {
    document.getElementById('edition-ratings')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function openHero(): void {
    const url = fullCover || heroSrc;
    if (!url) return;
    openMediaViewer({ url, title: heroTitle });
  }

  const facts = $derived.by(() => {
    const rows: { label: string; value: string; href?: string }[] = [];
    if (meta.type) rows.push({ label: 'Type', value: formatPublicationType(meta.type) });
    if (meta.publishedBy) rows.push({ label: 'Imprint', value: meta.publishedBy });
    if (meta.version) rows.push({ label: 'Version', value: `v${meta.version}` });
    if (meta.affectedKinds.length) {
      rows.push({
        label: 'Kinds',
        value: meta.affectedKinds.join(', ')
      });
    }
    if (meta.sectionCount > 0) {
      rows.push({
        label: 'Length',
        value: `${meta.sectionCount} ${meta.sectionCount === 1 ? 'section' : 'sections'}`
      });
    }
    if (meta.releaseDate) rows.push({ label: 'Released', value: meta.releaseDate });
    return rows;
  });
  const hasLangTopics = $derived(Boolean(meta.language || meta.subjects.length));

  async function onProvenanceClick(chip: ProvenanceChip): Promise<void> {
    if (!chip.copyText) return;
    try {
      await navigator.clipboard.writeText(chip.copyText);
    } catch {
      /* ignore */
    }
  }
</script>

{#snippet metaTable(includeVerse: boolean)}
  {#if facts.length || hasLangTopics || meta.provenance.length || (includeVerse && showVerseStyling)}
    <dl class="edition-facts">
      {#each facts as fact}
        <div class="edition-fact">
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      {/each}
      {#if meta.provenance.length}
        <div class="edition-fact edition-fact-wide">
          <dt>Sources</dt>
          <dd>
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
          </dd>
        </div>
      {/if}
      {#if hasLangTopics}
        <div class="edition-fact edition-fact-lang-topics">
          {#if meta.language}
            <div class="edition-fact">
              <dt>Language</dt>
              <dd>
                <a
                  class="edition-inline-link"
                  href={`#/search?language=${encodeURIComponent(meta.language)}`}
                  use:link
                >{meta.language.toUpperCase()}</a>
              </dd>
            </div>
          {/if}
          {#if meta.subjects.length}
            <div class="edition-fact">
              <dt>Topics</dt>
              <dd>
                <ul class="edition-topic-list">
                  {#each meta.subjects.slice(0, 12) as subject}
                    <li>
                      <a
                        class="edition-topic"
                        href={`#/search?subject=${encodeURIComponent(subject)}`}
                        use:link
                      >{subject}</a>
                    </li>
                  {/each}
                </ul>
              </dd>
            </div>
          {/if}
        </div>
      {/if}
      {#if includeVerse && showVerseStyling}
        <div class="edition-fact edition-fact-control">
          <dt>verse-styling</dt>
          <dd><VerseStylingToggle /></dd>
        </div>
      {/if}
    </dl>
  {/if}
{/snippet}

{#if isLongForm}
  <div class="edition-header edition-header-article">
    <div class="reader-edition-hero" class:reader-edition-hero-generated={showGeneratedHero}>
      <figure class="section-hero">
        <button class="section-hero-zoom" type="button" title="View cover" onclick={openHero}>
          <img src={heroSrc} alt="" loading="eager" />
        </button>
      </figure>
      <div class="reader-edition-hero-meta">
        <h1 class="section-heading">
          {#if meta.titles.length}
            {#each meta.titles as name, i}
              {#if i > 0}<span class="edition-title-sep"> · </span>{/if}
              <a
                class="edition-title-link"
                href={`#/search?title=${encodeURIComponent(name)}`}
                use:link>{name}</a
              >
            {/each}
          {:else}
            {heroTitle}
          {/if}
        </h1>
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
        </p>
      </div>
    </div>

    {#if showCardRating}
      <button
        class="edition-rating-hero"
        type="button"
        onclick={scrollToRatings}
        title="See ratings and reviews"
      >
        <span class="edition-rating-score">{ratingAverage!.toFixed(1)}</span>
        <Stars
          value={ratingAverage!}
          size={22}
          label={`${ratingAverage!.toFixed(1)} out of 5 from ${ratingCount} ${ratingCount === 1 ? 'rating' : 'ratings'}`}
        />
        <span class="edition-rating-count"
          >{ratingCount} {ratingCount === 1 ? 'rating' : 'ratings'}</span
        >
      </button>
    {/if}

    {@render metaTable(false)}

    {#if meta.summary}
      <p class="edition-summary" class:edition-summary-rule={!children}>{meta.summary}</p>
    {/if}

    {#if children}
      {@render children()}
    {/if}
  </div>
{:else}
  <div class="edition-header">
    <div class="edition-hero">
      <div class="edition-cover">
        <Cover {event} enlargeOnClick />
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

        {#if showCardRating}
          <button
            class="edition-rating-hero"
            type="button"
            onclick={scrollToRatings}
            title="See ratings and reviews"
          >
            <span class="edition-rating-score">{ratingAverage!.toFixed(1)}</span>
            <Stars
              value={ratingAverage!}
              size={22}
              label={`${ratingAverage!.toFixed(1)} out of 5 from ${ratingCount} ${ratingCount === 1 ? 'rating' : 'ratings'}`}
            />
            <span class="edition-rating-count"
              >{ratingCount} {ratingCount === 1 ? 'rating' : 'ratings'}</span
            >
          </button>
        {/if}

        <p class="muted edition-publisher">
          Published by <UserBadge pubkey={event.pubkey} />
          {#if isLibraryCopyPubkey(event.pubkey)}
            <span> · Library copy</span>
          {/if}
        </p>

        {@render metaTable(true)}

        {#if meta.summary}
          <p class="edition-summary" class:edition-summary-rule={!children}>{meta.summary}</p>
        {/if}

        {#if children}
          {@render children()}
        {/if}
      </div>
    </div>
  </div>
{/if}
