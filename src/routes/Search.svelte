<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import { runLabelSearch, runSearch, runSubjectSearch, npubFromInput } from '$lib/search';
  import type { Event } from 'nostr-tools';

  let events = $state<Event[]>([]);
  let loading = $state(false);
  let pageFilter = $state('');

  onMount(() => {
    const hash = window.location.hash;
    const qs = hash.includes('?') ? hash.split('?')[1] : '';
    const params = new URLSearchParams(qs);
    const q = params.get('q') ?? '';
    const subject = params.get('subject') ?? '';
    const label = params.get('label') ?? '';
    const term = q || subject || label;
    if (!term) return;
    const npub = npubFromInput(term);
    if (npub) {
      window.location.hash = `#/p/${npub}`;
      return;
    }
    const onUpdate = (r: { events: Event[]; loading: boolean }) => {
      events = r.events;
      loading = r.loading;
    };
    if (subject) void runSubjectSearch(subject, onUpdate);
    else if (label) void runLabelSearch(label, onUpdate);
    else void runSearch(q, onUpdate);
  });

  const visible = $derived(
    events.filter((e) => !pageFilter || JSON.stringify(e).toLowerCase().includes(pageFilter.toLowerCase()))
  );
</script>

<TopBar />
<main class="shell">
  <h1>Search</h1>
  <input type="search" placeholder="Filter this page…" bind:value={pageFilter} style="max-width:20rem;margin-bottom:1rem" />
  {#if loading}<p class="muted">{events.length ? 'Updating…' : 'Searching…'}</p>{/if}
  {#if !loading && visible.length === 0}
    <p class="muted">Nothing matched.</p>
  {/if}
  <div class="card-grid card-grid-results">
    {#each visible.slice(0, 25) as event}
      <PublicationCard {event} />
    {/each}
  </div>
</main>
