<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { eventAddress } from '$lib/nostr/verify';

  interface Props {
    event: Event;
    found?: string;
  }

  let { event, found = 'the library index and document relays' }: Props = $props();
  const coord = $derived(eventAddress(event));
</script>

<details class="accordion details-panel">
  <summary>Details</summary>
  <dl class="details-list">
    <dt>Event id</dt>
    <dd><code>{event.id}</code></dd>
    <dt>Coordinate</dt>
    <dd><code>{coord}</code></dd>
    <dt>Where it was found</dt>
    <dd>{found}</dd>
  </dl>
</details>
