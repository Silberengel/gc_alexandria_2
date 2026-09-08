<script lang="ts">
  import { link } from 'svelte-spa-router';
  import { session } from '$lib/stores/session';
  import UserBadge from './UserBadge.svelte';
  import { suggestTitles, npubFromInput, isNsec } from '$lib/search';

  interface Props {
    showSearch?: boolean;
  }

  let { showSearch = false }: Props = $props();
  let query = $state('');
  let suggestions = $state<string[]>([]);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function submitSearch(e: Event) {
    e.preventDefault();
    const q = query.trim();
    if (!q || isNsec(q)) {
      query = '';
      return;
    }
    const npub = npubFromInput(q);
    if (npub) {
      window.location.hash = `#/p/${npub}`;
      return;
    }
    window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
  }

  function onInput(): void {
    suggestions = [];
    if (timer) clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2 || isNsec(q)) return;
    timer = setTimeout(() => {
      void suggestTitles(q).then((hits) => {
        suggestions = hits.slice(0, 8);
      });
    }, 200);
  }

  function pick(hit: string): void {
    query = hit;
    suggestions = [];
    window.location.hash = `#/search?q=${encodeURIComponent(hit)}`;
  }
</script>

<header class="top-bar">
  <a class="brand" href="#/" use:link>
    <img src="/favicon.png" width="32" height="32" alt="" />
    <span>Library of Alexandria</span>
  </a>
  <nav>
    <a href="#/about" use:link>About</a>
    {#if $session.pubkey}
      <a href="#/contact" use:link>Contact</a>
    {/if}
    <a href="#/settings" use:link>Settings</a>
  </nav>
  {#if showSearch}
    <form class="search-form" onsubmit={submitSearch}>
      <input
        type="search"
        placeholder="Search books, wiki, events…"
        bind:value={query}
        oninput={onInput}
        autocomplete="off"
      />
      {#if suggestions.length}
        <ul class="suggest-list">
          {#each suggestions as hit}
            <li>
              <button type="button" onclick={() => pick(hit)}>{hit}</button>
            </li>
          {/each}
        </ul>
      {/if}
    </form>
  {/if}
  <div style="margin-left:auto">
    {#if $session.pubkey}
      <UserBadge pubkey={$session.pubkey} />
      <button class="btn" type="button" onclick={() => session.signOut()}>Sign out</button>
    {:else}
      <button class="btn btn-primary" type="button" disabled={$session.loading} onclick={() => session.signIn()}>
        {$session.loading ? 'Signing in…' : 'Sign in'}
      </button>
    {/if}
  </div>
</header>
