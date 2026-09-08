<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { eventAddress } from '$lib/nostr/verify';
  import { eventSources } from '$lib/nostr/event-sources';

  interface Props {
    event: Event;
    /** Extra sources known at the call site (merged with tracked provenance). */
    found?: string | string[];
  }

  let { event, found }: Props = $props();
  const coord = $derived(eventAddress(event));
  const sources = $derived.by(() => {
    const tracked = eventSources(event.id);
    const extra = !found ? [] : Array.isArray(found) ? found : found.split(/[\n,]+/).map((s) => s.trim());
    const set = new Set([...tracked, ...extra].filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  });
</script>

<details class="accordion details-panel">
  <summary>Details</summary>
  <dl class="details-list">
    <dt>Event id</dt>
    <dd><code>{event.id}</code></dd>
    <dt>Coordinate</dt>
    <dd><code>{coord}</code></dd>
    <dt>Where it was found</dt>
    <dd>
      {#if sources.length}
        <ul class="found-list">
          {#each sources as source}
            <li><code>{source}</code></li>
          {/each}
        </ul>
      {:else}
        <span class="muted">Not yet observed on a relay</span>
      {/if}
    </dd>
  </dl>
</details>
