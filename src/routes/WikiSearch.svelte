<script lang="ts">
  import { link, push, querystring } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import WikiListRow from '$lib/components/WikiListRow.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import { searchWikiHub } from '$lib/wiki-hub';
  import { suggestTitles, isNsec } from '$lib/search';

  let draft = $state('');
  let suggestions = $state<string[]>([]);
  let suggestTimer: ReturnType<typeof setTimeout> | null = null;
  let results = $state<Event[]>([]);
  let loading = $state(false);
  let message = $state('');
  let lastKey = '';

  const q = $derived((new URLSearchParams($querystring ?? '').get('q') ?? '').trim());

  $effect(() => {
    const key = q;
    if (key === lastKey) return;
    lastKey = key;
    draft = key;
    suggestions = [];
    if (!key) {
      results = [];
      loading = false;
      message = '';
      return;
    }
    let cancelled = false;
    loading = true;
    message = '';
    void searchWikiHub(key).then((hits) => {
      if (cancelled) return;
      results = hits;
      loading = false;
      message = hits.length ? '' : 'Nothing matched.';
    });
    return () => {
      cancelled = true;
    };
  });

  function onInput(): void {
    suggestions = [];
    if (suggestTimer) clearTimeout(suggestTimer);
    const next = draft.trim();
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
    goSearch(draft);
  }
</script>

<main class="shell wiki-hub wiki-hub-subpage">
  <header class="page-header">
    <p class="muted"><a href="#/wiki" use:link>← Wiki</a></p>
    <h1>Wiki search</h1>
  </header>

  <form class="wiki-hub-search search-form" onsubmit={onSubmit}>
    <input
      type="search"
      placeholder="Search wiki and specs…"
      bind:value={draft}
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

  {#if !q}
    <p class="muted">Type a topic and press Enter.</p>
  {:else if loading}
    <LoadingHint message={`Searching for “${q}”…`} />
  {:else if message}
    <p class="muted">{message}</p>
  {:else}
    <p class="muted wiki-search-count">{results.length} {results.length === 1 ? 'result' : 'results'}</p>
    <ul class="wiki-list">
      {#each results as event (event.id)}
        <WikiListRow {event} />
      {/each}
    </ul>
  {/if}
</main>
