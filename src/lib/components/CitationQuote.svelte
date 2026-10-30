<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { formatCitationFull, parseCitationMeta } from '$lib/citations';
  import { feedThreadPath } from '$lib/feed';

  interface Props {
    event: Event;
    /** Optional endnote number shown after the quote. */
    noteNumber?: number;
  }

  let { event, noteNumber }: Props = $props();

  const meta = $derived(parseCitationMeta(event));
  const attribution = $derived(
    [meta.author || meta.llm, meta.title].filter(Boolean).join(' — ') || formatCitationFull(meta)
  );
  const href = $derived(`#${feedThreadPath(event)}`);
</script>

<figure class="citation-quote">
  <blockquote class="citation-quote-body">
    {meta.content || '…'}
  </blockquote>
  <figcaption class="citation-quote-cap">
    {#if href}
      <a href={href}>{attribution}</a>
    {:else}
      {attribution}
    {/if}
    {#if noteNumber != null}
      <sup class="citation-quote-note"
        ><a href={`#citation-ref-${noteNumber}`}>{noteNumber}</a></sup
      >
    {/if}
  </figcaption>
</figure>

<style>
  .citation-quote {
    margin: 0.85rem 0;
    padding: 0;
  }
  .citation-quote-body {
    margin: 0;
    padding: 0.15rem 0 0.15rem 0.85rem;
    border-left: 3px solid color-mix(in srgb, var(--accent, #8b6914) 65%, transparent);
    font-style: italic;
    line-height: 1.5;
  }
  .citation-quote-cap {
    margin: 0.35rem 0 0;
    font-size: var(--text-meta, 0.85rem);
    color: var(--text-muted);
  }
  .citation-quote-note {
    margin-left: 0.15em;
  }
</style>
