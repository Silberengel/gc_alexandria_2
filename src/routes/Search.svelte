<script lang="ts">
  import { onMount } from 'svelte';
  import SearchForm from '$lib/components/SearchForm.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import EventCard from '$lib/components/EventCard.svelte';
  import EventsTable from '$lib/components/EventsTable.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import ListingViewToggle from '$lib/components/ListingViewToggle.svelte';
  import SearchRefineBar from '$lib/components/SearchRefineBar.svelte';
  import AdvancedSearchPanel from '$lib/components/AdvancedSearchPanel.svelte';
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
    runKindTagSearch,
    runReadSearch,
    runReadingQueueSearch,
    runAdvancedSearch,
    npubFromInput
  } from '$lib/search';
  import { parseAdvancedSearch, type AdvancedSearchRequest } from '$lib/advanced-search';
  import { parseSearchPointer } from '$lib/search-pointer';
  import SearchPointerEditor from '$lib/components/SearchPointerEditor.svelte';
  import { muteState, filterMuted, followPubkeysFromMetadata } from '$lib/mute';
  import { filterPageEvents } from '$lib/page-filter';
  import {
    dateInputToSince,
    dateInputToUntil,
    filterSearchEvents,
    sortSearchEvents,
    type SearchSortMode
  } from '$lib/search-refine';
  import {
    filterEventsByAuthorScope,
    type AuthorResultScope
  } from '$lib/result-scope';
  import { session } from '$lib/stores/session';
  import { trust } from '$lib/stores/trust';
  import { trustedAssertions } from '$lib/trusted-assertions';
  import type { Event } from 'nostr-tools';

  let events = $state<Event[]>([]);
  let loading = $state(false);
  let pageFilter = $state('');
  let page = $state(1);
  let lastKey = '';
  /** Bumps on each new hash search; drops stale onUpdate paints. */
  let searchGen = 0;
  /** Active query shown under the Search heading (empty when no params). */
  let searchTerm = $state('');
  let searchKind = $state('');
  let resultScope = $state<AuthorResultScope>('all');
  let scoresReady = $state(0);
  let advancedReq = $state<AdvancedSearchRequest | null>(null);

  let refineKind = $state<number | null>(null);
  let refinePubkey = $state('');
  let refineSinceDate = $state('');
  let refineUntilDate = $state('');
  let refineSort = $state<SearchSortMode>('best');

  const signedIn = $derived(Boolean($session.pubkey));
  let follows = $state<Set<string>>(new Set());
  const hasFollows = $derived(follows.size > 0);
  const showMineScope = $derived(signedIn);
  const showFollowsScope = $derived(signedIn && hasFollows);
  const showTrustedScope = true;

  function hashParams(): URLSearchParams {
    const hash = window.location.hash;
    const qs = hash.includes('?') ? hash.split('?')[1] : '';
    return new URLSearchParams(qs);
  }

  function resetRefine(): void {
    refineKind = null;
    refinePubkey = '';
    refineSinceDate = '';
    refineUntilDate = '';
    refineSort = 'best';
  }

  function searchKey(params: URLSearchParams): string {
    const viewer = session.getPubkey()?.toLowerCase() ?? '';
    return [
      `viewer=${viewer}`,
      ...[
        'adv',
        'q',
        'subject',
        'label',
        'author',
        'title',
        'identifier',
        'language',
        'bookshelf',
        'd',
        'k',
        'npub',
        'read',
        'queue'
      ].map((k) => `${k}=${params.get(k) ?? ''}`)
    ].join('&');
  }

  function describeSearch(params: URLSearchParams): { kind: string; term: string } {
    const adv = parseAdvancedSearch(params);
    if (adv) {
      const bits: string[] = [];
      if (adv.filter?.kinds?.length) bits.push(`kinds ${adv.filter.kinds.join(',')}`);
      if (adv.filter?.search) bits.push(adv.filter.search);
      if (adv.mercury?.q) bits.push(adv.mercury.q);
      if (adv.mercury?.title) bits.push(adv.mercury.title);
      if (adv.filter?.authors?.length) bits.push(`${adv.filter.authors.length} authors`);
      return { kind: 'Advanced', term: bits.join(' · ') || 'custom filter' };
    }
    const keyed: [string, string][] = [
      ['queue', 'Reading now'],
      ['read', 'Read by'],
      ['bookshelf', 'Bookshelf'],
      ['d', 'Slug'],
      ['k', 'Kind'],
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
      if (!term) continue;
      if (key === 'queue' && term.toLowerCase() === 'follows') {
        return { kind: 'Reading now', term: 'from follows' };
      }
      return { kind, term };
    }
    return { kind: '', term: '' };
  }

  function runFromHash(): void {
    const params = hashParams();
    const key = searchKey(params);
    const described = describeSearch(params);
    const adv = parseAdvancedSearch(params);
    advancedReq = adv;
    searchTerm = described.term;
    searchKind = described.kind;
    if (key === lastKey) return;
    lastKey = key;
    const runGen = ++searchGen;
    resultScope = 'all';
    resetRefine();
    const q = params.get('q') ?? '';
    const subject = params.get('subject') ?? '';
    const label = params.get('label') ?? '';
    const author = params.get('author') ?? '';
    const title = params.get('title') ?? '';
    const identifier = params.get('identifier') ?? '';
    const language = params.get('language') ?? '';
    const bookshelf = params.get('bookshelf') ?? '';
    const d = params.get('d') ?? '';
    const k = params.get('k') ?? '';
    const shelfNpub = params.get('npub') ?? '';
    const read = params.get('read') ?? '';
    const queue = params.get('queue') ?? '';
    const term = described.term;
    if (!term && !adv) {
      events = [];
      loading = false;
      return;
    }
    if (!adv) {
      const npub = npubFromInput(term);
      if (npub && !bookshelf && !read && !queue && !k) {
        window.location.hash = `#/p/${npub}`;
        return;
      }
    }
    page = 1;
    const onUpdate = (r: { events: Event[]; loading: boolean }) => {
      if (runGen !== searchGen) return;
      events = r.events;
      loading = r.loading;
    };
    if (adv) void runAdvancedSearch(adv, onUpdate);
    else if (queue) void runReadingQueueSearch(queue, onUpdate);
    else if (read) void runReadSearch(read, onUpdate);
    else if (bookshelf) void runBookshelfSearch(bookshelf, onUpdate, shelfNpub || undefined);
    else if (d) void runDTagSearch(d, onUpdate);
    else if (k) void runKindTagSearch(k, onUpdate);
    else if (subject) void runSubjectSearch(subject, onUpdate);
    else if (label) void runLabelSearch(label, onUpdate);
    else if (author) void runAuthorSearch(author, onUpdate);
    else if (title) void runTitleSearch(title, onUpdate);
    else if (identifier) void runIdentifierSearch(identifier, onUpdate);
    else if (language) void runLanguageSearch(language, onUpdate);
    else void runSearch(q, onUpdate);
  }

  function setResultScope(next: AuthorResultScope): void {
    resultScope = next;
    page = 1;
  }

  $effect(() => {
    if (resultScope === 'mine' && !showMineScope) resultScope = 'all';
    else if (resultScope === 'follows' && !showFollowsScope) resultScope = 'all';
  });

  $effect(() => {
    if (resultScope !== 'trusted' || !events.length) return;
    const authors = [...new Set(events.map((e) => e.pubkey.toLowerCase()))];
    let cancelled = false;
    void trustedAssertions
      .resolveProvider(session.getPubkey())
      .then(() => trustedAssertions.requestScoresAndWait(authors))
      .then(() => {
        if (!cancelled) scoresReady += 1;
      })
      .catch(() => {
        /* keep last scores */
      });
    return () => {
      cancelled = true;
    };
  });

  onMount(() => {
    follows = followPubkeysFromMetadata(session.getMetadata());
    const unsubMeta = session.metadata.subscribe((metaEvents) => {
      follows = followPubkeysFromMetadata(metaEvents);
    });
    let lastViewer = $session.pubkey?.toLowerCase() ?? '';
    const unsubSession = session.subscribe(($s) => {
      const next = $s.pubkey?.toLowerCase() ?? '';
      if (next === lastViewer) return;
      lastViewer = next;
      lastKey = '';
      runFromHash();
    });
    runFromHash();
    window.addEventListener('hashchange', runFromHash);
    return () => {
      unsubMeta();
      unsubSession();
      window.removeEventListener('hashchange', runFromHash);
    };
  });

  $effect(() => {
    pageFilter;
    $listingDensity;
    resultScope;
    refineKind;
    refinePubkey;
    refineSinceDate;
    refineUntilDate;
    refineSort;
    page = 1;
  });

  const pageSize = $derived(listingPageSize($listingDensity));
  const muted = $derived(filterMuted(events, $muteState));
  const visible = $derived(
    (() => {
      void scoresReady;
      void $trust.rankMin;
      return filterEventsByAuthorScope(
        filterPageEvents(
          sortSearchEvents(
            filterSearchEvents(muted, {
              kind: refineKind,
              pubkey: refinePubkey || null,
              since: refineSinceDate ? dateInputToSince(refineSinceDate) : null,
              until: refineUntilDate ? dateInputToUntil(refineUntilDate) : null
            }),
            refineSort
          ),
          pageFilter
        ),
        resultScope,
        {
          viewerPubkey: $session.pubkey,
          followPubkeySet: follows,
          rankMin: $trust.rankMin,
          getScore: (pk) => trustedAssertions.getScore(pk)
        }
      );
    })()
  );
  const paged = $derived(visible.slice((page - 1) * pageSize, page * pageSize));
  /** Bech32 / coordinate queries → editable kind · pubkey · d (or event id) parts. */
  const searchPointer = $derived(
    searchTerm && searchKind !== 'Advanced' ? parseSearchPointer(searchTerm) : null
  );
</script>

<main class="shell shell-wide">
  <header class="page-header">
    <p class="page-kicker">Catalog</p>
    <h1>Search</h1>
    {#if !searchTerm}
      <p class="page-lede muted">Find publications, wiki pages, authors, and labels across the library.</p>
    {/if}
    <SearchForm class="page-search-form" initialQuery={searchKind === 'Advanced' ? '' : searchTerm} />
  </header>
  {#if searchTerm}
    {#if searchPointer}
      <SearchPointerEditor pointer={searchPointer} />
    {:else}
      <p class="search-term">
        {#if searchKind}<span class="muted">{searchKind}</span>{/if}
        <span>{searchTerm}</span>
      </p>
    {/if}
  {/if}
  <AdvancedSearchPanel initial={advancedReq} open={Boolean(advancedReq)} />
  <div class="listing-toolbar search-result-filters" role="group" aria-label="Result filters">
    <PageFilter bind:value={pageFilter} />
    <ListingViewToggle label="Search results" />
  </div>
  <SearchRefineBar
    events={muted}
    kind={refineKind}
    pubkey={refinePubkey}
    sinceDate={refineSinceDate}
    untilDate={refineUntilDate}
    sort={refineSort}
    {resultScope}
    {showMineScope}
    {showFollowsScope}
    {showTrustedScope}
    onKind={(v) => (refineKind = v)}
    onPubkey={(v) => (refinePubkey = v)}
    onSinceDate={(v) => (refineSinceDate = v)}
    onUntilDate={(v) => (refineUntilDate = v)}
    onSort={(v) => (refineSort = v)}
    onResultScope={(v) => setResultScope(v)}
    onClear={() => {
      resetRefine();
      setResultScope('all');
    }}
  />
  {#if loading}<LoadingHint message={events.length ? 'Updating…' : 'Searching…'} />{/if}
  {#if !loading && visible.length === 0}
    <p class="muted">
      {#if resultScope === 'mine'}
        Nothing here from you.
      {:else if resultScope === 'follows'}
        Nothing here from your follows.
      {:else if resultScope === 'trusted'}
        Nothing here from trusted npubs (rank ≥ {$trust.rankMin}).
      {:else if refinePubkey}
        Nothing from that publisher.
      {:else}
        Nothing matched.
      {/if}
    </p>
  {/if}
  {#if $listingDensity === 'table'}
    <EventsTable events={visible} />
  {:else}
    <div class="card-grid card-grid-results">
      {#each paged as event (event.id)}
        <EventCard {event} asCard openAsThread />
      {/each}
    </div>
    <Pager {page} total={visible.length} {pageSize} onPage={(p) => (page = p)} />
  {/if}
</main>
