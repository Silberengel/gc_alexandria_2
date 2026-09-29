<script lang="ts">
  import { onMount } from 'svelte';
  import Router, { location } from 'svelte-spa-router';
  import { wrap } from 'svelte-spa-router/wrap';
  import { scheduleDeletionSweep } from './lib/deletions';
  import { session } from './lib/stores/session';
  import MediaViewer from './lib/components/MediaViewer.svelte';

  const routes = {
    '/': wrap({ asyncComponent: () => import('./routes/Home.svelte') }),
    '/search': wrap({ asyncComponent: () => import('./routes/Search.svelte') }),
    '/settings': wrap({ asyncComponent: () => import('./routes/Settings.svelte') }),
    '/about': wrap({ asyncComponent: () => import('./routes/About.svelte') }),
    '/booklists': wrap({ asyncComponent: () => import('./routes/Booklists.svelte') }),
    '/start': wrap({ asyncComponent: () => import('./routes/StartRedirect.svelte') }),
    '/contact': wrap({ asyncComponent: () => import('./routes/Contact.svelte') }),
    '/p/:id/:kind': wrap({ asyncComponent: () => import('./routes/Profile.svelte') }),
    '/p/:id': wrap({ asyncComponent: () => import('./routes/Profile.svelte') }),
    '/publication/d/:d/p/:npub': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/publication/d/:d': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/publication/naddr/:naddr': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/publication/nevent/:naddr': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/publication/note/:naddr': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/publication/:naddr': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/wiki/d/:d/p/:npub': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/wiki/d/:d': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/wiki/naddr/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/wiki/nevent/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/wiki/note/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/wiki/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/spec/d/:d/p/:npub': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/spec/d/:d': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/spec/naddr/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/spec/nevent/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/spec/note/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/spec/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/article/d/:d/p/:npub': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/article/d/:d': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/article/naddr/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/article/nevent/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/article/note/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    '/article/:naddr': wrap({ asyncComponent: () => import('./routes/Wiki.svelte') }),
    /** Biblestr-compatible Douay: `/luke/9?verses=46-50` (after library routes). */
    '/:book/:chapter': wrap({ asyncComponent: () => import('./routes/DouayPassage.svelte') }),
    '*': wrap({ asyncComponent: () => import('./routes/NotFound.svelte') })
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
