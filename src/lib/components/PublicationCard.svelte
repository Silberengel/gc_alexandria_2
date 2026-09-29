<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link, replace } from 'svelte-spa-router';
  import { KIND } from '$lib/constants';
  import { warmNavEvent } from '$lib/nav-warm';
  import { cardMeta, displayTitle, libraryDocumentPath } from '$lib/metadata';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import { eventAddress } from '$lib/nostr/verify';
  import { fetchContainingPublication } from '$lib/landing';
  import { readerShareLocation, readerShareUrl } from '$lib/reader-share-url';
  import { warmWikiDeferTarget } from '$lib/wiki-defer';
  import Cover from './Cover.svelte';
  import CardMeta from './CardMeta.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';

  interface Props {
    event: Event;
    showMeta?: boolean;
    /** `card` = detailed result card; `row` = compact list line. */
    variant?: 'card' | 'row';
  }

  let { event, showMeta = true, variant = 'card' }: Props = $props();

  /** Resolved top edition when [event] is a 30041 section. */
  let sectionEdition = $state<Event | null>(null);
  let sectionResolveBusy = $state(false);

  $effect(() => {
    rememberEvents([event]);
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
  const subjects = $derived(meta.subjects.slice(0, 5));
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
