<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import EventCard from '$lib/components/EventCard.svelte';
  import EventsTable from '$lib/components/EventsTable.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import ListingViewToggle from '$lib/components/ListingViewToggle.svelte';
  import { listingDensity } from '$lib/stores/listing-density';
  import { listingPageSize } from '$lib/listing-table';
  import {
    runLabelSearch,
    runSearch,
    runSubjectSearch,
    runAuthorSearch,
    runTitleSearch,
    runIdentifierSearch,
    runLanguageSearch,
    runBookshelfSearch,
    runDTagSearch,
    runReadSearch,
    npubFromInput
  } from '$lib/search';
  import { muteState, filterMuted } from '$lib/mute';
  import { filterPageEvents } from '$lib/page-filter';
  import type { Event } from 'nostr-tools';

  let events = $state<Event[]>([]);
  let loading = $state(false);
  let pageFilter = $state('');
  let page = $state(1);
  let lastKey = '';
  /** Active query shown under the Search heading (empty when no params). */
  let searchTerm = $state('');
  let searchKind = $state('');

  function hashParams(): URLSearchParams {
    const hash = window.location.hash;
    const qs = hash.includes('?') ? hash.split('?')[1] : '';
    return new URLSearchParams(qs);
  }

  function searchKey(params: URLSearchParams): string {
    return ['q', 'subject', 'label', 'author', 'title', 'identifier', 'language', 'bookshelf', 'd', 'npub', 'read']
      .map((k) => `${k}=${params.get(k) ?? ''}`)
      .join('&');
  }

  function describeSearch(params: URLSearchParams): { kind: string; term: string } {
    const keyed: [string, string][] = [
      ['read', 'Read by'],
      ['bookshelf', 'Bookshelf'],
      ['d', 'Slug'],
      ['subject', 'Subject'],
      ['label', 'Label'],
      ['author', 'Author'],
      ['title', 'Title'],
      ['identifier', 'Identifier'],
      ['language', 'Language'],
      ['q', '']
    ];
    for (const [key, kind] of keyed) {
      const term = (params.get(key) ?? '').trim();
      if (term) return { kind, term };
    }
    return { kind: '', term: '' };
  }

  function runFromHash(): void {
    const params = hashParams();
    const key = searchKey(params);
    const described = describeSearch(params);
    searchTerm = described.term;
    searchKind = described.kind;
    if (key === lastKey) return;
    lastKey = key;
    const q = params.get('q') ?? '';
    const subject = params.get('subject') ?? '';
    const label = params.get('label') ?? '';
    const author = params.get('author') ?? '';
    const title = params.get('title') ?? '';
    const identifier = params.get('identifier') ?? '';
    const language = params.get('language') ?? '';
    const bookshelf = params.get('bookshelf') ?? '';
    const d = params.get('d') ?? '';
    const shelfNpub = params.get('npub') ?? '';
    const read = params.get('read') ?? '';
    const term = described.term;
    if (!term) {
      events = [];
      loading = false;
      return;
    }
    const npub = npubFromInput(term);
    if (npub && !bookshelf && !read) {
      window.location.hash = `#/p/${npub}`;
      return;
    }
    page = 1;
    const onUpdate = (r: { events: Event[]; loading: boolean }) => {
      events = r.events;
      loading = r.loading;
    };
    if (read) void runReadSearch(read, onUpdate);
    else if (bookshelf) void runBookshelfSearch(bookshelf, onUpdate, shelfNpub || undefined);
    else if (d) void runDTagSearch(d, onUpdate);
    else if (subject) void runSubjectSearch(subject, onUpdate);
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
    $listingDensity;
    page = 1;
  });

  const pageSize = $derived(listingPageSize($listingDensity));
  const visible = $derived(filterPageEvents(filterMuted(events, $muteState), pageFilter));
  const paged = $derived(visible.slice((page - 1) * pageSize, page * pageSize));
</script>

<TopBar />
<main class="shell">
  <h1>Search</h1>
  {#if searchTerm}
    <p class="search-term">
      {#if searchKind}<span class="muted">{searchKind}</span>{/if}
      <span>{searchTerm}</span>
    </p>
  {/if}
  <div class="listing-toolbar">
    <PageFilter bind:value={pageFilter} />
    <ListingViewToggle label="Search results" />
  </div>
  {#if loading}<p class="muted">{events.length ? 'Updating…' : 'Searching…'}</p>{/if}
  {#if !loading && visible.length === 0}
    <p class="muted">Nothing matched.</p>
  {/if}
  {#if $listingDensity === 'table'}
    <EventsTable events={visible} />
  {:else}
    <div
      class:card-grid={$listingDensity === 'full'}
      class:card-grid-results={$listingDensity === 'full'}
      class:listing-list={$listingDensity === 'list'}
    >
      {#each paged as event (event.id)}
        <EventCard {event} density={$listingDensity} />
      {/each}
    </div>
    <Pager {page} total={visible.length} {pageSize} onPage={(p) => (page = p)} />
  {/if}
</main>
