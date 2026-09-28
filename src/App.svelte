<script lang="ts">
  import { onMount } from 'svelte';
  import Router, { location } from 'svelte-spa-router';
  import Home from './routes/Home.svelte';
  import Search from './routes/Search.svelte';
  import Publication from './routes/Publication.svelte';
  import Wiki from './routes/Wiki.svelte';
  import Profile from './routes/Profile.svelte';
  import Settings from './routes/Settings.svelte';
  import About from './routes/About.svelte';
  import Booklists from './routes/Booklists.svelte';
  import StartRedirect from './routes/StartRedirect.svelte';
  import Contact from './routes/Contact.svelte';
  import DouayPassage from './routes/DouayPassage.svelte';
  import NotFound from './routes/NotFound.svelte';
  import { scheduleDeletionSweep } from './lib/deletions';
  import { session } from './lib/stores/session';
  import MediaViewer from './lib/components/MediaViewer.svelte';

  const routes = {
    '/': Home,
    '/search': Search,
    '/settings': Settings,
    '/about': About,
    '/booklists': Booklists,
    '/start': StartRedirect,
    '/contact': Contact,
    '/p/:id': Profile,
    '/publication/d/:d/p/:npub': Publication,
    '/publication/d/:d': Publication,
    '/publication/naddr/:naddr': Publication,
    '/publication/nevent/:naddr': Publication,
    '/publication/note/:naddr': Publication,
    '/publication/:naddr': Publication,
    '/wiki/d/:d/p/:npub': Wiki,
    '/wiki/d/:d': Wiki,
    '/wiki/naddr/:naddr': Wiki,
    '/wiki/nevent/:naddr': Wiki,
    '/wiki/note/:naddr': Wiki,
    '/wiki/:naddr': Wiki,
    '/spec/d/:d/p/:npub': Wiki,
    '/spec/d/:d': Wiki,
    '/spec/naddr/:naddr': Wiki,
    '/spec/nevent/:naddr': Wiki,
    '/spec/note/:naddr': Wiki,
    '/spec/:naddr': Wiki,
    /** Biblestr-compatible Douay: `/luke/9?verses=46-50` (after library routes). */
    '/:book/:chapter': DouayPassage,
    '*': NotFound
  };

  /** Path-only — query changes (?section=, ?read=) must not reset an in-progress deep scroll. */
  let lastScrollPath = '';

  $effect(() => {
    const path = $location || '/';
    if (path === lastScrollPath) return;
    lastScrollPath = path;
    // Reader scrollY otherwise carries onto Home (mobile lands at the bottom).
    queueMicrotask(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  });

  onMount(() => {
    // Hash SPA: keep the browser from re-applying a deep scroll after we reset.
    try {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    } catch {
      /* ignore */
    }
    scheduleDeletionSweep();
    // Hydrate in the background — never blank the SPA while bunker/extension restore runs.
    void session.restore();
  });
</script>

<Router {routes} />
<MediaViewer />
