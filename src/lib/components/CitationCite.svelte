<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { formatCitationInline, parseCitationMeta } from '$lib/citations';
  import { feedThreadPath } from '$lib/feed';
  import type { RefSegment } from '$lib/nostr-refs';
  import { inlineNostrRefHtml } from '$lib/nostr-refs';

  interface Props {
    event?: Event | null;
    seg: RefSegment;
  }

  let { event = null, seg }: Props = $props();

  const label = $derived.by(() => {
    if (event) return formatCitationInline(parseCitationMeta(event));
    return seg.displayLabel || '(citation)';
  });
  const href = $derived(event ? `#${feedThreadPath(event)}` : null);
</script>

{#if href}
  <a class="citation-cite nostrdown-ref" href={href}>{label}</a>
{:else}
  {@html inlineNostrRefHtml({ ...seg, displayLabel: label, presentation: 'inline' })}
{/if}

<style>
  .citation-cite {
    white-space: nowrap;
  }
</style>
