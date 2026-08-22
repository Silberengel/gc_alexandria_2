<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import { runSearch, npubFromInput } from '$lib/search';
  import type { Event } from 'nostr-tools';

  let events = $state<Event[]>([]);
  let loading = $state(false);
  let pageFilter = $state('');

  onMount(() => {
    const hash = window.location.hash;
    const qs = hash.includes('?') ? hash.split('?')[1] : '';
    const params = new URLSearchParams(qs);
    const q = params.get('q') ?? params.get('subject') ?? params.get('label') ?? '';
    if (!q) return;
    const npub = npubFromInput(q);
    if (npub) {
      window.location.hash = `#/p/${npub}`;
      return;
    }
    loading = true;
    void runSearch(q, (r) => {
      events = r.events;
      loading = r.loading;
    });
  });

  const visible = $derived(
    events.filter((e) => !pageFilter || JSON.stringify(e).toLowerCase().includes(pageFilter.toLowerCase()))
  );
</script>

<TopBar />
<main class="shell">
  <h1>Search</h1>
  <input type="search" placeholder="Filter this page…" bind:value={pageFilter} style="max-width:20rem;margin-bottom:1rem" />
  {#if loading}<p class="muted">Searching…</p>{/if}
  {#if !loading && visible.length === 0}
    <p class="muted">Nothing matched.</p>
  {/if}
  <div class="card-grid">
    {#each visible.slice(0, 25) as event}
      <PublicationCard {event} />
    {/each}
  </div>
</main>
