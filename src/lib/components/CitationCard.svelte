<script lang="ts">
  import type { Event } from 'nostr-tools';
  import {
    citationKindLabel,
    formatCitationFull,
    isCitationKind,
    parseCitationMeta
  } from '$lib/citations';
  import { feedThreadPath } from '$lib/feed';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  const meta = $derived(parseCitationMeta(event));
  const full = $derived(formatCitationFull(meta));
  const href = $derived(`#${feedThreadPath(event)}`);
  const kindLabel = $derived(
    isCitationKind(event.kind) ? citationKindLabel(event.kind) : `Kind ${event.kind}`
  );
</script>

<article class="citation-card">
  <header class="citation-card-head">
    <span class="citation-card-kind">{kindLabel}</span>
    {#if meta.title}
      <h3 class="citation-card-title">{meta.title}</h3>
    {:else if meta.llm}
      <h3 class="citation-card-title">{meta.llm}</h3>
    {/if}
  </header>
  <p class="citation-card-bib">{full}</p>
  {#if meta.content}
    <blockquote class="citation-card-quote">{meta.content}</blockquote>
  {/if}
  {#if meta.url}
    <p class="citation-card-link">
      <a href={meta.url} target="_blank" rel="noopener noreferrer">{meta.url}</a>
    </p>
  {/if}
  <p class="citation-card-open muted">
    <a href={href}>Open citation event</a>
  </p>
</article>

<style>
  .citation-card {
    margin: 0.65rem 0;
    padding: 0.65rem 0.75rem;
    border-left: 3px solid color-mix(in srgb, var(--accent, #8b6914) 70%, transparent);
    background: color-mix(in srgb, var(--surface, #fff) 88%, var(--paper-dark, #eee));
  }
  .citation-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem 0.65rem;
    margin-bottom: 0.25rem;
  }
  .citation-card-kind {
    font-size: var(--text-meta, 0.75rem);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .citation-card-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 650;
  }
  .citation-card-bib,
  .citation-card-link,
  .citation-card-open {
    margin: 0.2rem 0 0;
    font-size: var(--text-meta, 0.85rem);
    line-height: 1.45;
  }
  .citation-card-quote {
    margin: 0.45rem 0 0;
    padding: 0 0 0 0.65rem;
    border-left: 2px solid var(--rule, #ccc);
    font-style: italic;
    color: color-mix(in srgb, var(--ink, #222) 85%, transparent);
  }
</style>
