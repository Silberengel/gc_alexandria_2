<script lang="ts">
  import { onMount } from 'svelte';
  import Router from 'svelte-spa-router';
  import Home from './routes/Home.svelte';
  import Search from './routes/Search.svelte';
  import Publication from './routes/Publication.svelte';
  import Wiki from './routes/Wiki.svelte';
  import Profile from './routes/Profile.svelte';
  import Settings from './routes/Settings.svelte';
  import About from './routes/About.svelte';
  import StartRedirect from './routes/StartRedirect.svelte';
  import Contact from './routes/Contact.svelte';
  import NotFound from './routes/NotFound.svelte';
  import { scheduleDeletionSweep } from './lib/deletions';
  import { session } from './lib/stores/session';

  const routes = {
    '/': Home,
    '/search': Search,
    '/settings': Settings,
    '/about': About,
    '/start': StartRedirect,
    '/contact': Contact,
    '/p/:id': Profile,
    '/publication/d/:d/p/:npub': Publication,
    '/publication/d/:d': Publication,
    '/publication/:naddr': Publication,
    '/wiki/d/:d/p/:npub': Wiki,
    '/wiki/d/:d': Wiki,
    '/wiki/:naddr': Wiki,
    '*': NotFound
  };

  let ready = $state(false);

  onMount(() => {
    scheduleDeletionSweep();
    // Hydrate from localStorage immediately, then wait briefly for window.nostr.
    void session.restore().finally(() => {
      ready = true;
    });
  });
</script>

{#if ready}
  <Router {routes} />
{/if}
