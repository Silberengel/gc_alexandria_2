<script lang="ts">
  import Router from 'svelte-spa-router';
  import Home from './routes/Home.svelte';
  import Search from './routes/Search.svelte';
  import Publication from './routes/Publication.svelte';
  import Wiki from './routes/Wiki.svelte';
  import Profile from './routes/Profile.svelte';
  import Settings from './routes/Settings.svelte';
  import About from './routes/About.svelte';
  import Start from './routes/Start.svelte';
  import Contact from './routes/Contact.svelte';
  import NotFound from './routes/NotFound.svelte';

  const routes = {
    '/': Home,
    '/search': Search,
    '/settings': Settings,
    '/about': About,
    '/start': Start,
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
</script>

<Router {routes} />
