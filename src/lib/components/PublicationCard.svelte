<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link, replace } from 'svelte-spa-router';
  import { KIND } from '$lib/constants';
  import { warmNavEvent } from '$lib/nav-warm';
  import { cardMeta, displayTitle, libraryDocumentPath, publicationPath } from '$lib/metadata';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import { eventAddress } from '$lib/nostr/verify';
  import { fetchContainingPublication } from '$lib/landing';
  import { readerShareLocation, readerShareUrl } from '$lib/reader-share-url';
  import { warmWikiDeferTarget } from '$lib/wiki-defer';
  import Cover from './Cover.svelte';
  import CardMeta from './CardMeta.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import Stars from './Stars.svelte';
  import { muteState } from '$lib/mute';
  import { fetchPublicationRatingAggregate } from '$lib/ratings';

  interface Props {
    event: Event;
    showMeta?: boolean;
    /** `card` = detailed result card; `row` = compact list line. */
    variant?: 'card' | 'row';
    /** Optional precomputed average (1–5). When omitted, full publication cards fetch it. */
    ratingAverage?: number;
    ratingCount?: number;
  }

  let {
    event,
    showMeta = true,
    variant = 'card',
    ratingAverage: ratingAverageProp,
    ratingCount: ratingCountProp
  }: Props = $props();

  /** Resolved top edition when [event] is a 30041 section. */
  let sectionEdition = $state<Event | null>(null);
  let sectionResolveBusy = $state(false);
  let fetchedAvg = $state<number | undefined>(undefined);
  let fetchedCount = $state(0);

  $effect(() => {
    rememberEvents([event]);
  });

  $effect(() => {
    if (
      variant !== 'card' ||
      event.kind !== KIND.PUBLICATION ||
      typeof ratingAverageProp === 'number'
    ) {
      fetchedAvg = undefined;
      fetchedCount = 0;
      return;
    }
    const target = event;
    let cancelled = false;
    fetchedAvg = undefined;
    fetchedCount = 0;
    void fetchPublicationRatingAggregate(target, $muteState).then((agg) => {
      if (cancelled) return;
      if (agg.count > 0) {
        fetchedAvg = agg.averageStars;
        fetchedCount = agg.count;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (event.kind !== KIND.SECTION) {
      sectionEdition = null;
      sectionResolveBusy = false;
      return;
    }
    const addr = eventAddress(event);
    let cancelled = false;
    sectionEdition = null;
    sectionResolveBusy = true;
    void fetchContainingPublication(addr).then((edition) => {
      if (cancelled) return;
      sectionResolveBusy = false;
      if (!edition) return;
      rememberEvents([edition, event]);
      sectionEdition = edition;
      warmNavEvent(edition);
    });
    return () => {
      cancelled = true;
    };
  });

  const meta = $derived(cardMeta(event));
  const title = $derived(displayTitle(event));
  const isArticle = $derived(event.kind === KIND.WIKI || event.kind === KIND.SPEC);
  const isSection = $derived(event.kind === KIND.SECTION);
  /** Fallback: section d-path — Publication route promotes it to the parent reader. */
  const href = $derived(
    isSection && sectionEdition
      ? readerShareLocation(sectionEdition, event)
      : libraryDocumentPath(event)
  );
  const shareUrl = $derived(
    isSection && sectionEdition ? readerShareUrl(sectionEdition, event) : ''
  );
  const summary = $derived(meta.summary?.trim() ?? '');
  const kindLabel = $derived(
    event.kind === KIND.SPEC
      ? 'Spec'
      : event.kind === KIND.WIKI
        ? 'Wiki'
        : event.kind === KIND.SECTION
          ? 'Section'
          : 'Publication'
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
  const cardAvg = $derived(
    typeof ratingAverageProp === 'number' && Number.isFinite(ratingAverageProp)
      ? ratingAverageProp
      : fetchedAvg
  );
  const cardCount = $derived(
    typeof ratingCountProp === 'number' && ratingCountProp > 0 ? ratingCountProp : fetchedCount
  );
  const showCardRating = $derived(
    !isRow && typeof cardAvg === 'number' && Number.isFinite(cardAvg) && cardCount > 0
  );

  function warmSelf(): void {
    if (sectionEdition) warmNavEvent(sectionEdition);
    else warmNavEvent(event);
  }

  function warmDefer(): void {
    warmWikiDeferTarget(event);
  }

  /** Ensure section clicks always land in the reader once the parent is known. */
  function onSectionNavigate(e: MouseEvent): void {
    if (!isSection || !sectionEdition) return;
    e.preventDefault();
    warmSelf();
    replace(readerShareLocation(sectionEdition, event));
  }
</script>

{#if isRow}
  <div class="listing-row-wrap">
    <div class="listing-row listing-row-split">
      <span class="listing-row-cover">
        <Cover {event} enlargeOnClick />
      </span>
      <a
        class="listing-row-body"
        href={`#${href}`}
        use:link
        onpointerdown={warmSelf}
        onclick={onSectionNavigate}
      >
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
      </a>
    </div>
    <CopyPointerButton {event} class="listing-row-copy" shareUrl={shareUrl} />
  </div>
{:else}
  <div class="card pub-card" class:pub-card-wiki={isArticle} class:pub-card-section={isSection}>
    <CopyPointerButton {event} class="generic-card-copy" shareUrl={shareUrl} />
    <div class="pub-card-top">
      <div class="pub-card-cover">
        <Cover {event} enlargeOnClick />
      </div>
      <div class="pub-card-body">
        <p class="pub-card-kind muted">{kindLabel}</p>
        <h3>
          {#if meta.titles.length}
            <a href={`#${href}`} use:link onpointerdown={warmSelf} onclick={onSectionNavigate}>
              {#each meta.titles as name, i}
                {#if i > 0}<span> · </span>{/if}{name}
              {/each}
            </a>
          {:else}
            <a href={`#${href}`} use:link onpointerdown={warmSelf} onclick={onSectionNavigate}
              >{title}</a
            >
          {/if}
        </h3>
        {#if showMeta}
          <div class="pub-card-meta">
            <CardMeta {event} showTitles={false} showSubjects={false} />
          </div>
        {/if}
        {#if showCardRating}
          <a
            class="pub-card-rating"
            href={`#${publicationPath(event)}`}
            use:link
            onpointerdown={warmSelf}
            title={`${cardAvg!.toFixed(1)} out of 5 from ${cardCount} ${cardCount === 1 ? 'rating' : 'ratings'}`}
          >
            <Stars
              value={cardAvg!}
              size={13}
              label={`${cardAvg!.toFixed(1)} out of 5 from ${cardCount} ${cardCount === 1 ? 'rating' : 'ratings'}`}
            />
            <span class="pub-card-rating-count">({cardCount})</span>
          </a>
        {/if}
        {#if isSection && sectionResolveBusy && !sectionEdition}
          <p class="muted pub-card-section-hint">Finding edition…</p>
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
  </div>
{/if}
