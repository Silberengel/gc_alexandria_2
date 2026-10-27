<script lang="ts">
  import { onMount } from 'svelte';
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import WikiListRow from '$lib/components/WikiListRow.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import { loadWikiRecent } from '$lib/wiki-hub';

  let events = $state<Event[]>([]);
  let loading = $state(true);

  onMount(() => {
    void (async () => {
      try {
        events = await loadWikiRecent(50);
      } finally {
        loading = false;
      }
    })();
  });
</script>

<main class="shell wiki-hub wiki-hub-subpage">
  <header class="page-header">
    <p class="muted"><a href="#/wiki" use:link>← Wiki</a></p>
    <h1>Recent changes</h1>
    <p class="muted">Newest wiki articles and specs from Mercury.</p>
  </header>
  {#if loading}
    <LoadingHint message="Loading recent changes…" />
  {:else if !events.length}
    <p class="muted">No recent wiki pages yet.</p>
  {:else}
    <ul class="wiki-list">
      {#each events as event (event.id)}
        <WikiListRow {event} />
      {/each}
    </ul>
  {/if}
</main>
