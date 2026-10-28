<script lang="ts">
  import { push, querystring, replace } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import AuthorScopeFilter from '$lib/components/AuthorScopeFilter.svelte';
  import WikiListRow from '$lib/components/WikiListRow.svelte';
  import WikiRecentKindFilter from '$lib/components/WikiRecentKindFilter.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import {
    loadWikiRecent,
    parseWikiRecentKind,
    pickRandomWikiPage,
    wikiHubListingHref,
    wikiHubResultHref,
    type WikiRecentKindFilter as KindFilter
  } from '$lib/wiki-hub';
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

  let q = $state('');
  let suggestions = $state<string[]>([]);
  let suggestTimer: ReturnType<typeof setTimeout> | null = null;
  let recentPool = $state<Event[]>([]);
  let recentLoading = $state(true);
  let recentKind = $state<KindFilter>('all');
  let authorScope = $state<AuthorResultScope>(DEFAULT_AUTHOR_RESULT_SCOPE);
  let recentSeq = 0;
  let scoresReady = $state(0);
  let randomBusy = $state(false);
  let follows = $state<Set<string>>(new Set());

  const signedIn = $derived(Boolean($session.pubkey));
  const showMineScope = $derived(signedIn);
  const showFollowsScope = $derived(signedIn && follows.size > 0);

  const params = $derived(new URLSearchParams($querystring ?? ''));
  const kindFromQuery = $derived(parseWikiRecentKind(params.get('kind')));
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
    const nextKind = kindFromQuery;
    const nextFrom = fromFromQuery;
    recentKind = nextKind;
    authorScope = nextFrom;
    const seq = ++recentSeq;
    recentLoading = true;
    void loadWikiRecent(50, nextKind).then(
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

  function setListing(next: { kind?: KindFilter; from?: AuthorResultScope }): void {
    const kind = next.kind ?? kindFromQuery;
    const from = next.from ?? fromFromQuery;
    if (kind === kindFromQuery && from === fromFromQuery) return;
    const href = wikiHubListingHref({ kind, from });
    void replace(href.startsWith('#') ? href.slice(1) : href);
  }

  function setRecentKind(next: KindFilter): void {
    setListing({ kind: next });
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
    void push(`/wiki/search?q=${encodeURIComponent(trimmed)}`);
  }

  function onSubmit(e: SubmitEvent): void {
    e.preventDefault();
    goSearch(q);
  }

  async function onRandom(): Promise<void> {
    if (randomBusy) return;
    randomBusy = true;
    try {
      const hit = await pickRandomWikiPage();
      if (!hit) return;
      warmNavEvent(hit);
      const href = wikiHubResultHref(hit);
      void push(href.startsWith('#') ? href.slice(1) : href);
    } finally {
      randomBusy = false;
    }
  }
</script>

<main class="shell wiki-hub">
  <div class="wiki-hub-hero">
    <h1 class="wiki-hub-title">Wiki</h1>
    <p class="wiki-hub-tagline muted">
      Read Nostr wiki articles and specs — search a topic, browse recent changes, or open a random
      page.
    </p>
    <form class="wiki-hub-search search-form" onsubmit={onSubmit}>
      <input
        type="search"
        placeholder="Search wiki and specs…"
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
    <nav class="wiki-hub-actions" aria-label="Wiki">
      <button class="btn" type="button" disabled={randomBusy} onclick={() => void onRandom()}>
        {randomBusy ? 'Picking…' : 'Random page'}
      </button>
    </nav>
  </div>

  <section class="wiki-hub-recent" aria-labelledby="wiki-recent-heading">
    <div class="wiki-hub-section-head">
      <h2 id="wiki-recent-heading">Recent changes</h2>
    </div>
    <WikiRecentKindFilter value={recentKind} onchange={setRecentKind} />
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
      <LoadingHint message="Loading recent wiki pages…" />
    {:else if !recent.length}
      <p class="muted">
        {#if authorScope === 'mine'}
          No recent pages from you.
        {:else if authorScope === 'follows'}
          No recent pages from accounts you follow.
        {:else if authorScope === 'trusted'}
          No recent pages from trusted npubs (rank ≥ {$trust.rankMin}).
        {:else if recentKind === 'wiki'}
          No recent wiki articles yet.
        {:else if recentKind === 'spec'}
          No recent specs yet.
        {:else}
          No recent wiki pages yet.
        {/if}
      </p>
    {:else}
      <ul class="wiki-list">
        {#each recent as event (event.id)}
          <WikiListRow {event} />
        {/each}
      </ul>
    {/if}
  </section>
</main>
