<script lang="ts">
  import { link } from 'svelte-spa-router';
  import { session } from '$lib/stores/session';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    showSearch?: boolean;
  }

  let { showSearch = false }: Props = $props();
  let query = $state('');

  function submitSearch(e: Event) {
    e.preventDefault();
    if (!query.trim()) return;
    window.location.hash = `#/search?q=${encodeURIComponent(query.trim())}`;
  }
</script>

<header class="top-bar">
  <a class="brand" href="#/" use:link>
    <img src="/favicon.png" width="32" height="32" alt="" />
    <span>Library of Alexandria</span>
  </a>
  <nav>
    <a href="#/about" use:link>About</a>
    <a href="#/contact" use:link>Contact</a>
    <a href="#/settings" use:link>Settings</a>
  </nav>
  {#if showSearch}
    <form class="search-form" onsubmit={submitSearch} style="flex:1;min-width:12rem;max-width:28rem">
      <input type="search" placeholder="Search books, wiki, events…" bind:value={query} />
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
