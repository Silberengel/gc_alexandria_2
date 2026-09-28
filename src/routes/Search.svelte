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
  import { muteState, filterMuted, followPubkeysFromMetadata } from '$lib/mute';
  import { filterPageEvents } from '$lib/page-filter';
  import { session } from '$lib/stores/session';
  import type { Event } from 'nostr-tools';

  type ResultScope = 'all' | 'mine' | 'follows';

  let events = $state<Event[]>([]);
  let loading = $state(false);
  let pageFilter = $state('');
  let page = $state(1);
  let lastKey = '';
  /** Active query shown under the Search heading (empty when no params). */
  let searchTerm = $state('');
  let searchKind = $state('');
  let resultScope = $state<ResultScope>('all');

  const signedIn = $derived(Boolean($session.pubkey));
  let follows = $state<Set<string>>(new Set());

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
    resultScope = 'all';
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

  function setResultScope(next: ResultScope): void {
    resultScope = next;
    page = 1;
  }

  function filterByScope(list: Event[], scope: ResultScope): Event[] {
    if (scope === 'all') return list;
    const me = $session.pubkey?.toLowerCase();
    if (!me) return [];
    if (scope === 'mine') return list.filter((e) => e.pubkey.toLowerCase() === me);
    return list.filter((e) => follows.has(e.pubkey.toLowerCase()));
  }

  onMount(() => {
    follows = followPubkeysFromMetadata(session.getMetadata());
    const unsubMeta = session.metadata.subscribe((events) => {
      follows = followPubkeysFromMetadata(events);
    });
    runFromHash();
    window.addEventListener('hashchange', runFromHash);
    return () => {
      unsubMeta();
      window.removeEventListener('hashchange', runFromHash);
    };
  });

  $effect(() => {
    pageFilter;
    $listingDensity;
    resultScope;
    page = 1;
  });

  const pageSize = $derived(listingPageSize($listingDensity));
  const visible = $derived(
    filterByScope(filterPageEvents(filterMuted(events, $muteState), pageFilter), resultScope)
  );
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
  </div>
  <div class="listing-toolbar search-result-filters" role="group" aria-label="Result filters">
    <div class="booklist-scope search-result-scope" role="group" aria-label="Result source">
      <button
        type="button"
        class="booklist-scope-btn"
        class:active={resultScope === 'all'}
        aria-pressed={resultScope === 'all'}
        onclick={() => setResultScope('all')}
      >All</button>
      <button
        type="button"
        class="booklist-scope-btn"
        class:active={resultScope === 'mine'}
        aria-pressed={resultScope === 'mine'}
        disabled={!signedIn}
        title={signedIn ? 'Published by you' : 'Sign in to filter to your publications'}
        onclick={() => setResultScope('mine')}
      >From me</button>
      <button
        type="button"
        class="booklist-scope-btn"
        class:active={resultScope === 'follows'}
        aria-pressed={resultScope === 'follows'}
        disabled={!signedIn}
        title={signedIn ? 'Published by accounts you follow' : 'Sign in to filter to follows'}
        onclick={() => setResultScope('follows')}
      >From follows</button>
    </div>
    <ListingViewToggle label="Search results" />
  </div>
  {#if loading}<p class="muted">{events.length ? 'Updating…' : 'Searching…'}</p>{/if}
  {#if !loading && visible.length === 0}
    <p class="muted">
      {#if resultScope === 'mine'}
        Nothing here from you.
      {:else if resultScope === 'follows'}
        Nothing here from accounts you follow.
      {:else}
        Nothing matched.
      {/if}
    </p>
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
