<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import EventCard from '$lib/components/EventCard.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import {
    runLabelSearch,
    runSearch,
    runSubjectSearch,
    runAuthorSearch,
    runTitleSearch,
    runIdentifierSearch,
    runLanguageSearch,
    npubFromInput
  } from '$lib/search';
  import { muteState, filterMuted } from '$lib/mute';
  import { filterPageEvents } from '$lib/page-filter';
  import type { Event } from 'nostr-tools';

  let events = $state<Event[]>([]);
  let loading = $state(false);
  let pageFilter = $state('');
  let page = $state(1);
  const pageSize = 25;
  let lastKey = '';

  function hashParams(): URLSearchParams {
    const hash = window.location.hash;
    const qs = hash.includes('?') ? hash.split('?')[1] : '';
    return new URLSearchParams(qs);
  }

  function searchKey(params: URLSearchParams): string {
    return ['q', 'subject', 'label', 'author', 'title', 'identifier', 'language']
      .map((k) => `${k}=${params.get(k) ?? ''}`)
      .join('&');
  }

  function runFromHash(): void {
    const params = hashParams();
    const key = searchKey(params);
    if (key === lastKey) return;
    lastKey = key;
    const q = params.get('q') ?? '';
    const subject = params.get('subject') ?? '';
    const label = params.get('label') ?? '';
    const author = params.get('author') ?? '';
    const title = params.get('title') ?? '';
    const identifier = params.get('identifier') ?? '';
    const language = params.get('language') ?? '';
    const term = q || subject || label || author || title || identifier || language;
    if (!term) {
      events = [];
      loading = false;
      return;
    }
    const npub = npubFromInput(term);
    if (npub) {
      window.location.hash = `#/p/${npub}`;
      return;
    }
    page = 1;
    const onUpdate = (r: { events: Event[]; loading: boolean }) => {
      events = r.events;
      loading = r.loading;
    };
    if (subject) void runSubjectSearch(subject, onUpdate);
    else if (label) void runLabelSearch(label, onUpdate);
    else if (author) void runAuthorSearch(author, onUpdate);
    else if (title) void runTitleSearch(title, onUpdate);
    else if (identifier) void runIdentifierSearch(identifier, onUpdate);
    else if (language) void runLanguageSearch(language, onUpdate);
    else void runSearch(q, onUpdate);
  }

  onMount(() => {
    runFromHash();
    window.addEventListener('hashchange', runFromHash);
    return () => window.removeEventListener('hashchange', runFromHash);
  });

  $effect(() => {
    pageFilter;
    page = 1;
  });

  const visible = $derived(filterPageEvents(filterMuted(events, $muteState), pageFilter));
  const paged = $derived(visible.slice((page - 1) * pageSize, page * pageSize));
</script>

<TopBar />
<main class="shell">
  <h1>Search</h1>
  <PageFilter bind:value={pageFilter} />
  {#if loading}<p class="muted">{events.length ? 'Updating…' : 'Searching…'}</p>{/if}
  {#if !loading && visible.length === 0}
    <p class="muted">Nothing matched.</p>
  {/if}
  <div class="card-grid card-grid-results">
    {#each paged as event (event.id)}
      <EventCard {event} />
    {/each}
  </div>
  <Pager {page} total={visible.length} {pageSize} onPage={(p) => (page = p)} />
</main>
