<script lang="ts">
  import { onMount } from 'svelte';
  import { link, push } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import TopBar from '$lib/components/TopBar.svelte';
  import WikiListRow from '$lib/components/WikiListRow.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import { loadWikiRecent, pickRandomWikiPage, wikiHubResultHref } from '$lib/wiki-hub';
  import { suggestTitles, isNsec } from '$lib/search';
  import { warmNavEvent } from '$lib/nav-warm';

  let q = $state('');
  let suggestions = $state<string[]>([]);
  let suggestTimer: ReturnType<typeof setTimeout> | null = null;
  let recent = $state<Event[]>([]);
  let recentLoading = $state(true);
  let randomBusy = $state(false);

  onMount(() => {
    void (async () => {
      try {
        recent = await loadWikiRecent(12);
      } finally {
        recentLoading = false;
      }
    })();
  });

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

<TopBar showSearch={false} />
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
      <a class="btn" href="#/wiki/recent" use:link>Recent changes</a>
      <button class="btn" type="button" disabled={randomBusy} onclick={() => void onRandom()}>
        {randomBusy ? 'Picking…' : 'Random page'}
      </button>
    </nav>
  </div>

  <section class="wiki-hub-recent" aria-labelledby="wiki-recent-heading">
    <div class="wiki-hub-section-head">
      <h2 id="wiki-recent-heading">Recent changes</h2>
      <a class="muted" href="#/wiki/recent" use:link>See all</a>
    </div>
    {#if recentLoading}
      <LoadingHint message="Loading recent wiki pages…" />
    {:else if !recent.length}
      <p class="muted">No recent wiki pages yet.</p>
    {:else}
      <ul class="wiki-list">
        {#each recent as event (event.id)}
          <WikiListRow {event} />
        {/each}
      </ul>
    {/if}
  </section>
</main>
