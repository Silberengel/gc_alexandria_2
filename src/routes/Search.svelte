<script lang="ts">
  import { onMount, untrack } from 'svelte';
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
  import { link } from 'svelte-spa-router';
  import {
    runLabelSearch,
    runSearch,
    runSubjectSearch,
    runAuthorSearch,
    runTitleSearch,
    runIdentifierSearch,
    runLanguageSearch,
    loadBookshelfCatalog,
    fetchOwnPublishedNotOnBookshelf,
    isOwnMyBookCollectionBookshelf,
    runDTagSearch,
    runKindTagSearch,
    runReadSearch,
    runReadingQueueSearch,
    runAdvancedSearch,
    hexPubkey,
    npubFromInput
  } from '$lib/search';
  import { parseAdvancedSearch, type AdvancedSearchRequest } from '$lib/advanced-search';
  import { parseSearchPointer } from '$lib/search-pointer';
  import SearchPointerEditor from '$lib/components/SearchPointerEditor.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
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
    DEFAULT_AUTHOR_RESULT_SCOPE,
    filterEventsByAuthorScope,
    type AuthorResultScope
  } from '$lib/result-scope';
  import { directoryDTag } from '$lib/bookshelf';
  import { KIND } from '$lib/constants';
  import { normalizeDTag } from '$lib/dtag';
  import { readerFocusQuote } from '$lib/reader-share-url';
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
  /** Bookshelf search: author npub/hex from `?npub=` and resolved 30045. */
  let bookshelfAuthorHex = $state('');
  let bookshelfDirectory = $state<Event | null>(null);
  /** Own my-book-collection: authored pubs missing from the directory. */
  let publishedOffShelf = $state<Event[]>([]);
  let publishedOffShelfLoading = $state(false);
  let bookshelfSlug = $state('');
  let resultScope = $state<AuthorResultScope>(DEFAULT_AUTHOR_RESULT_SCOPE);
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

  /** Remount SearchForm + AdvancedSearchPanel so drafts wipe even without a hashchange. */
  let formResetKey = $state(0);

  const hasSearchState = $derived(
    Boolean(searchTerm) ||
      Boolean(advancedReq) ||
      Boolean(pageFilter.trim()) ||
      refineKind != null ||
      Boolean(refinePubkey) ||
      Boolean(refineSinceDate) ||
      Boolean(refineUntilDate) ||
      refineSort !== 'best' ||
      resultScope !== DEFAULT_AUTHOR_RESULT_SCOPE ||
      events.length > 0 ||
      loading
  );

  function clearSearchEverything(): void {
    pageFilter = '';
    resetRefine();
    resultScope = DEFAULT_AUTHOR_RESULT_SCOPE;
    page = 1;
    events = [];
    loading = false;
    searchTerm = '';
    searchKind = '';
    advancedReq = null;
    bookshelfAuthorHex = '';
    bookshelfDirectory = null;
    bookshelfSlug = '';
    publishedOffShelf = [];
    publishedOffShelfLoading = false;
    lastKey = '';
    searchGen += 1;
    formResetKey += 1;
    const hash = window.location.hash || '#/search';
    if (hash.includes('?')) {
      window.location.hash = '#/search';
    }
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
    // Same URL with an empty miss must retry — a cooled relay / flaky round
    // used to stick on "Nothing matched" until the hash changed.
    if (key === lastKey && (events.length > 0 || loading)) return;
    lastKey = key;
    const runGen = ++searchGen;
    const bookshelfParam = (params.get('bookshelf') ?? '').trim();
    // Advanced dumps and curated bookshelves: show members as listed — Grapevine
    // "trusted" would hide a whole shelf when the curator has no known rank.
    resultScope = adv || bookshelfParam ? 'all' : DEFAULT_AUTHOR_RESULT_SCOPE;
    resetRefine();
    const q = params.get('q') ?? '';
    const subject = params.get('subject') ?? '';
    const label = params.get('label') ?? '';
    const author = params.get('author') ?? '';
    const title = params.get('title') ?? '';
    const identifier = params.get('identifier') ?? '';
    const language = params.get('language') ?? '';
    const bookshelf = bookshelfParam;
    const d = params.get('d') ?? '';
    const k = params.get('k') ?? '';
    const shelfNpub = params.get('npub') ?? '';
    const read = params.get('read') ?? '';
    const queue = params.get('queue') ?? '';
    const term = described.term;
    const nextAuthorHex = bookshelf ? hexPubkey(shelfNpub) ?? '' : '';
    bookshelfSlug = bookshelf;
    // Keep prior directory until the new fetch lands so Edit does not flicker away.
    if (!bookshelf) {
      bookshelfAuthorHex = '';
      bookshelfDirectory = null;
      publishedOffShelf = [];
      publishedOffShelfLoading = false;
    } else {
      bookshelfAuthorHex = nextAuthorHex;
      publishedOffShelf = [];
      publishedOffShelfLoading = false;
    }
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
    // Drop prior hits immediately so a new query never shows stale cards.
    events = [];
    loading = true;
    const onUpdate = (r: { events: Event[]; loading: boolean }) => {
      if (runGen !== searchGen) return;
      events = r.events;
      loading = r.loading;
    };
    if (adv) void runAdvancedSearch(adv, onUpdate);
    else if (queue) void runReadingQueueSearch(queue, onUpdate);
    else if (read) void runReadSearch(read, onUpdate);
    else if (bookshelf) {
      void loadBookshelfCatalog(bookshelf, shelfNpub || undefined)
        .then(({ directory, events: shelfEvents }) => {
          if (runGen !== searchGen) return;
          if (directory) {
            bookshelfDirectory = directory;
          } else {
            // Keep a prior hit for the same slug so Edit does not vanish on a flaky refetch.
            const priorD = bookshelfDirectory ? normalizeDTag(directoryDTag(bookshelfDirectory)) : '';
            const wantD = normalizeDTag(bookshelf);
            const priorAuthor = bookshelfDirectory?.pubkey.toLowerCase() ?? '';
            const wantAuthor = (nextAuthorHex || priorAuthor).toLowerCase();
            if (!bookshelfDirectory || priorD !== wantD || (wantAuthor && priorAuthor !== wantAuthor)) {
              bookshelfDirectory = null;
            }
          }
          const dir = bookshelfDirectory;
          if (dir && !bookshelfAuthorHex) bookshelfAuthorHex = dir.pubkey.toLowerCase();
          const me = session.getPubkey()?.toLowerCase() ?? '';
          const author = (nextAuthorHex || dir?.pubkey || me).toLowerCase();
          if (!bookshelfAuthorHex && author) bookshelfAuthorHex = author;
          onUpdate({ events: shelfEvents, loading: false });
          // Hydrate ranks after paint so "Trusted" can work without delaying the shelf.
          const authors = [...new Set(shelfEvents.map((e) => e.pubkey))];
          if (authors.length) {
            void (async () => {
              try {
                await trustedAssertions.resolveProvider(session.getPubkey());
                await trustedAssertions.requestScoresAndWait(authors);
                if (runGen === searchGen) scoresReady += 1;
              } catch {
                /* scores optional */
              }
            })();
          }
          if (me && author === me && isOwnMyBookCollectionBookshelf(bookshelf)) {
            publishedOffShelfLoading = true;
            void fetchOwnPublishedNotOnBookshelf(dir, me)
              .then((pubs) => {
                if (runGen !== searchGen) return;
                publishedOffShelf = pubs;
              })
              .finally(() => {
                if (runGen === searchGen) publishedOffShelfLoading = false;
              });
          }
        })
        .catch(() => {
          if (runGen !== searchGen) return;
          onUpdate({ events: [], loading: false });
        });
    }
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
    if (resultScope === 'mine' && !showMineScope) resultScope = DEFAULT_AUTHOR_RESULT_SCOPE;
    else if (resultScope === 'follows' && !showFollowsScope) {
      resultScope = DEFAULT_AUTHOR_RESULT_SCOPE;
    }
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
    // untrack: reading `page` here would re-run on every pager click and fight pagination.
    if (untrack(() => page) !== 1) page = 1;
  });

  /** Full-text `q` from the active search — opens library cards with `?quote=`. */
  const searchFocusQuote = $derived.by(() => {
    const mercuryQ = advancedReq?.mercury?.q?.trim();
    if (mercuryQ) return readerFocusQuote(mercuryQ);
    const filterSearch = advancedReq?.filter?.search?.trim();
    if (filterSearch) return readerFocusQuote(filterSearch);
    const q = hashParams().get('q')?.trim();
    if (q) return readerFocusQuote(q);
    return '';
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
    searchTerm && searchKind !== 'Advanced' && searchKind !== 'Bookshelf'
      ? parseSearchPointer(searchTerm)
      : null
  );
  const isOwnBookshelf = $derived(
    Boolean(
      bookshelfAuthorHex &&
        $session.pubkey &&
        bookshelfAuthorHex === $session.pubkey.toLowerCase()
    )
  );
  const bookshelfEditHref = $derived(
    bookshelfDirectory
      ? `#/compose?copy=${bookshelfDirectory.id.toLowerCase()}`
      : `#/compose?kind=${KIND.DIRECTORY}`
  );
  const showPublishedOffShelfSection = $derived(
    searchKind === 'Bookshelf' &&
      isOwnBookshelf &&
      isOwnMyBookCollectionBookshelf(bookshelfSlug)
  );
  const publishedOffShelfVisible = $derived(
    (() => {
      if (!showPublishedOffShelfSection) return [] as Event[];
      // Drop anything already painted in the on-shelf grid (id or replaceable addr).
      const listedIds = new Set(events.map((e) => e.id.toLowerCase()));
      const listedAddrs = new Set(
        events.map((e) => `${e.kind}:${e.pubkey.toLowerCase()}:${e.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`)
      );
      const mutedOff = filterMuted(
        publishedOffShelf.filter((e) => {
          if (listedIds.has(e.id.toLowerCase())) return false;
          const addr = `${e.kind}:${e.pubkey.toLowerCase()}:${e.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
          return !listedAddrs.has(addr);
        }),
        $muteState
      );
      return filterPageEvents(mutedOff, pageFilter);
    })()
  );

  const searching = $derived(loading && events.length === 0);
  const loadingMessage = $derived.by(() => {
    if (searchKind === 'Bookshelf') return `Loading bookshelf "${searchTerm}"…`;
    if (searchTerm) return `Searching for "${searchTerm}"…`;
    return 'Searching…';
  });
</script>

<main class="shell shell-wide">
  <header class="page-header">
    <p class="page-kicker">Catalog</p>
    <h1>Search</h1>
    {#if !searchTerm}
      <p class="page-lede muted">Find publications, wiki pages, authors, and labels across the library.</p>
    {/if}
    <div class="search-page-query">
      {#key formResetKey}
        <SearchForm
          class="page-search-form"
          initialQuery={searchKind === 'Advanced' || searchKind === 'Bookshelf' ? '' : searchTerm}
        />
      {/key}
      <button
        type="button"
        class="btn search-page-clear-all"
        disabled={!hasSearchState}
        onclick={clearSearchEverything}
      >Clear all</button>
    </div>
  </header>
  {#if searchTerm}
    {#if searchPointer}
      <SearchPointerEditor pointer={searchPointer} />
    {:else if searchKind === 'Bookshelf'}
      <div class="search-term search-term-bookshelf">
        <p class="search-term-bookshelf-label">
          <span class="muted">Bookshelf</span>
          <span>{searchTerm}</span>
        </p>
        {#if bookshelfAuthorHex}
          <p class="search-bookshelf-curator">
            <span class="search-bookshelf-curator-label">Curator:</span>
            <UserBadge pubkey={bookshelfAuthorHex} compact />
          </p>
        {/if}
        {#if isOwnBookshelf}
          <a class="btn search-bookshelf-edit" href={bookshelfEditHref} use:link>Edit the list</a>
        {/if}
      </div>
    {:else}
      <p class="search-term">
        {#if searchKind}<span class="muted">{searchKind}</span>{/if}
        <span>{searchTerm}</span>
      </p>
    {/if}
  {/if}
  {#if searching}
    <LoadingHint message={loadingMessage} />
  {/if}
  {#key formResetKey}
    <AdvancedSearchPanel initial={advancedReq} open={Boolean(advancedReq)} />
  {/key}
  <div class="listing-toolbar search-result-filters" role="group" aria-label="Result filters">
    <PageFilter bind:value={pageFilter} />
    {#if resultScope === 'trusted' && (events.length > 0 || Boolean(searchTerm) || Boolean(advancedReq))}
      <button
        type="button"
        class="btn btn-ghost search-reveal-untrusted"
        title="Show results from authors below the trust rank minimum"
        onclick={() => setResultScope('all')}
      >
        Reveal events from untrusted npubs
      </button>
    {/if}
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
      // Bookshelves default to "all" so Clear does not re-hide the shelf.
      setResultScope(bookshelfSlug ? 'all' : DEFAULT_AUTHOR_RESULT_SCOPE);
    }}
  />
  {#if !searching}
    {#if loading}
      <LoadingHint message="Updating…" />
    {/if}
    {#if events.length > 0 || visible.length > 0}
      <p class="muted wiki-search-count">
        {visible.length} {visible.length === 1 ? 'card' : 'cards'}
        {#if showPublishedOffShelfSection}
          <span class="search-bookshelf-on-shelf-label">on this shelf</span>
        {/if}
      </p>
    {/if}
    {#if !loading && visible.length === 0 && (Boolean(searchTerm) || Boolean(advancedReq) || showPublishedOffShelfSection)}
      <p class="muted">
        {#if showPublishedOffShelfSection && (publishedOffShelfVisible.length > 0 || publishedOffShelfLoading)}
          Nothing on this shelf yet.
        {:else if searchKind === 'Bookshelf' && events.length === 0}
          Could not load this bookshelf, or it has no publications yet.
        {:else if resultScope === 'mine'}
          Nothing here from you.
        {:else if resultScope === 'follows'}
          Nothing here from your follows.
        {:else if resultScope === 'trusted' && events.length > 0}
          Nothing here from trusted npubs (rank ≥ {$trust.rankMin}).
          {events.length}
          {events.length === 1 ? 'hit is' : 'hits are'}
          hidden.
        {:else if resultScope === 'trusted'}
          Nothing here from trusted npubs (rank ≥ {$trust.rankMin}).
        {:else if refinePubkey}
          Nothing from that publisher.
        {:else}
          Nothing matched.
        {/if}
      </p>
    {/if}
    {#if visible.length > 0}
      {#if $listingDensity === 'table'}
        <EventsTable events={visible} focusQuote={searchFocusQuote} />
      {:else}
        <div class="card-grid card-grid-results">
          {#each paged as event (event.id)}
            <EventCard {event} asCard openAsThread focusQuote={searchFocusQuote} />
          {/each}
        </div>
        <Pager {page} total={visible.length} {pageSize} onPage={(p) => (page = p)} />
      {/if}
    {/if}
    {#if showPublishedOffShelfSection}
      <section class="search-bookshelf-published" aria-label="Books I published">
        <h2 class="search-bookshelf-published-title">Books I published</h2>
        <p class="muted search-bookshelf-published-lede">Not on this shelf yet.</p>
        {#if publishedOffShelfLoading && !publishedOffShelfVisible.length}
          <LoadingHint message="Loading your publications…" />
        {:else if publishedOffShelfVisible.length === 0}
          <p class="muted">No other publications of yours outside this shelf.</p>
        {:else if $listingDensity === 'table'}
          <EventsTable events={publishedOffShelfVisible} focusQuote={searchFocusQuote} />
        {:else}
          <div class="card-grid card-grid-results">
            {#each publishedOffShelfVisible as event (event.id)}
              <EventCard {event} asCard openAsThread focusQuote={searchFocusQuote} />
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</main>
