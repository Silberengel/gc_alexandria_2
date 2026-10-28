<script lang="ts">
  import { push, querystring, replace } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import AuthorScopeFilter from '$lib/components/AuthorScopeFilter.svelte';
  import CatalogListRow from '$lib/components/CatalogListRow.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import {
    catalogHubListingHref,
    catalogHubResultHref,
    catalogHubSearchPath,
    catalogHubSearchPlaceholder,
    catalogHubSingular,
    catalogHubTagline,
    catalogHubTitle,
    loadCatalogRecent,
    pickRandomCatalogPage,
    type CatalogHubKind
  } from '$lib/catalog-hub';
  import {
    DEFAULT_AUTHOR_RESULT_SCOPE,
    filterEventsByAuthorScope,
    parseAuthorResultScope,
    type AuthorResultScope
  } from '$lib/result-scope';
  import { suggestTitles, isNsec } from '$lib/search';
  import { warmNavEvent } from '$lib/nav-warm';
  import { followPubkeysFromMetadata } from '$lib/mute';
  import { session } from '$lib/stores/session';
  import { trust } from '$lib/stores/trust';
  import { trustedAssertions } from '$lib/trusted-assertions';

  interface Props {
    kind: CatalogHubKind;
  }

  let { kind }: Props = $props();

  let q = $state('');
  let suggestions = $state<string[]>([]);
  let suggestTimer: ReturnType<typeof setTimeout> | null = null;
  let recentPool = $state<Event[]>([]);
  let recentLoading = $state(true);
  let authorScope = $state<AuthorResultScope>(DEFAULT_AUTHOR_RESULT_SCOPE);
  let recentSeq = 0;
  let scoresReady = $state(0);
  let randomBusy = $state(false);
  let follows = $state<Set<string>>(new Set());

  const signedIn = $derived(Boolean($session.pubkey));
  const showMineScope = $derived(signedIn);
  const showFollowsScope = $derived(signedIn && follows.size > 0);
  const title = $derived(catalogHubTitle(kind));
  const tagline = $derived(catalogHubTagline(kind));
  const placeholder = $derived(catalogHubSearchPlaceholder(kind));
  const singular = $derived(catalogHubSingular(kind));

  const params = $derived(new URLSearchParams($querystring ?? ''));
  const fromFromQuery = $derived(parseAuthorResultScope(params.get('from')));

  $effect(() => {
    follows = followPubkeysFromMetadata(session.getMetadata());
    const unsub = session.metadata.subscribe((meta) => {
      follows = followPubkeysFromMetadata(meta);
    });
    return () => unsub();
  });

  $effect(() => {
    if (authorScope === 'mine' && !showMineScope) {
      setListing({ from: DEFAULT_AUTHOR_RESULT_SCOPE });
    } else if (authorScope === 'follows' && !showFollowsScope) {
      setListing({ from: DEFAULT_AUTHOR_RESULT_SCOPE });
    }
  });

  $effect(() => {
    const nextFrom = fromFromQuery;
    const nextKind = kind;
    authorScope = nextFrom;
    const seq = ++recentSeq;
    recentLoading = true;
    void loadCatalogRecent(nextKind, 50).then(
      (hits) => {
        if (seq !== recentSeq) return;
        recentPool = hits;
        recentLoading = false;
      },
      () => {
        if (seq !== recentSeq) return;
        recentPool = [];
        recentLoading = false;
      }
    );
  });

  $effect(() => {
    if (authorScope !== 'trusted' || !recentPool.length) return;
    const authors = [...new Set(recentPool.map((e) => e.pubkey.toLowerCase()))];
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

  const recent = $derived(
    (() => {
      void scoresReady;
      void $trust.rankMin;
      return filterEventsByAuthorScope(recentPool, authorScope, {
        viewerPubkey: $session.pubkey,
        followPubkeySet: follows,
        rankMin: $trust.rankMin,
        getScore: (pk) => trustedAssertions.getScore(pk)
      });
    })()
  );

  function setListing(next: { from?: AuthorResultScope }): void {
    const from = next.from ?? fromFromQuery;
    if (from === fromFromQuery) return;
    const href = catalogHubListingHref(kind, { from });
    void replace(href.startsWith('#') ? href.slice(1) : href);
  }

  function setAuthorScope(next: AuthorResultScope): void {
    setListing({ from: next });
  }

  function onInput(): void {
    suggestions = [];
    if (suggestTimer) clearTimeout(suggestTimer);
    const next = q.trim();
    if (next.length < 2 || isNsec(next)) return;
    suggestTimer = setTimeout(() => {
      void suggestTitles(next).then((hits) => {
        suggestions = hits.slice(0, 8);
      });
    }, 200);
  }

  function goSearch(query: string): void {
    const trimmed = query.trim();
    if (!trimmed || isNsec(trimmed)) return;
    suggestions = [];
    void push(`${catalogHubSearchPath(kind)}?q=${encodeURIComponent(trimmed)}`);
  }

  function onSubmit(e: SubmitEvent): void {
    e.preventDefault();
    goSearch(q);
  }

  async function onRandom(): Promise<void> {
    if (randomBusy) return;
    randomBusy = true;
    try {
      const hit = await pickRandomCatalogPage(kind);
      if (!hit) return;
      warmNavEvent(hit);
      const href = catalogHubResultHref(hit);
      void push(href.startsWith('#') ? href.slice(1) : href);
    } finally {
      randomBusy = false;
    }
  }
</script>

<main class="shell wiki-hub">
  <div class="wiki-hub-hero">
    <h1 class="wiki-hub-title">{title}</h1>
    <p class="wiki-hub-tagline muted">{tagline}</p>
    <form class="wiki-hub-search search-form" onsubmit={onSubmit}>
      <input
        type="search"
        {placeholder}
        bind:value={q}
        oninput={onInput}
        autocomplete="off"
      />
      {#if suggestions.length}
        <ul class="suggest-list">
          {#each suggestions as hit}
            <li>
              <button type="button" onclick={() => goSearch(hit)}>{hit}</button>
            </li>
          {/each}
        </ul>
      {/if}
    </form>
    <nav class="wiki-hub-actions" aria-label={title}>
      <button class="btn" type="button" disabled={randomBusy} onclick={() => void onRandom()}>
        {randomBusy ? 'Picking…' : `Random ${singular}`}
      </button>
    </nav>
  </div>

  <section class="wiki-hub-recent" aria-labelledby="catalog-recent-heading">
    <div class="wiki-hub-section-head">
      <h2 id="catalog-recent-heading">Recent</h2>
    </div>
    <AuthorScopeFilter
      value={authorScope}
      showMine={showMineScope}
      showFollows={showFollowsScope}
      showTrusted={true}
      onchange={setAuthorScope}
    />
    {#if !recentLoading}
      <p class="muted wiki-search-count">
        {recent.length} {recent.length === 1 ? 'card' : 'cards'}
      </p>
    {/if}
    {#if recentLoading}
      <LoadingHint message={`Loading recent ${title.toLowerCase()}…`} />
    {:else if !recent.length}
      <p class="muted">
        {#if authorScope === 'mine'}
          No recent {singular}s from you.
        {:else if authorScope === 'follows'}
          No recent {singular}s from accounts you follow.
        {:else if authorScope === 'trusted'}
          No recent {singular}s from trusted npubs (rank ≥ {$trust.rankMin}).
        {:else}
          No recent {singular}s yet.
        {/if}
      </p>
    {:else}
      <ul class="wiki-list">
        {#each recent as event (event.id)}
          <CatalogListRow {event} />
        {/each}
      </ul>
    {/if}
  </section>
</main>
