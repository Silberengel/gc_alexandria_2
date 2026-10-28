<script lang="ts">
  import { onMount } from 'svelte';
  import Router, { location, querystring } from 'svelte-spa-router';
  import { wrap } from 'svelte-spa-router/wrap';
  import { scheduleDeletionSweep } from './lib/deletions';
  import { currentNavKey, trackNavChange } from './lib/nav-history';
  import { appScrollTo, observeAppScrollInsets, setAppScrollRoot } from './lib/app-scroll';
  import { session } from './lib/stores/session';
  import MediaViewer from './lib/components/MediaViewer.svelte';
  import RawEventViewer from './lib/components/RawEventViewer.svelte';
  import PublishToast from './lib/components/PublishToast.svelte';
  import PwaUpdateBanner from './lib/components/PwaUpdateBanner.svelte';
  import SiteFooter from './lib/components/SiteFooter.svelte';
  import TopBar from './lib/components/TopBar.svelte';

  let scrollEl = $state<HTMLElement | undefined>();

  $effect(() => {
    setAppScrollRoot(scrollEl ?? null);
    if (!scrollEl) return () => setAppScrollRoot(null);
    const stopInsets = observeAppScrollInsets(scrollEl);
    return () => {
      stopInsets();
      setAppScrollRoot(null);
    };
  });

  const routes = {
    '/': wrap({ asyncComponent: () => import('./routes/Home.svelte') }),
    '/search': wrap({ asyncComponent: () => import('./routes/Search.svelte') }),
    '/settings': wrap({ asyncComponent: () => import('./routes/Settings.svelte') }),
    '/compose': wrap({ asyncComponent: () => import('./routes/Compose.svelte') }),
    '/directory': wrap({ asyncComponent: () => import('./routes/Directory.svelte') }),
    '/about': wrap({ asyncComponent: () => import('./routes/About.svelte') }),
    '/booklists': wrap({ asyncComponent: () => import('./routes/Booklists.svelte') }),
    '/start': wrap({ asyncComponent: () => import('./routes/StartRedirect.svelte') }),
    '/contact': wrap({ asyncComponent: () => import('./routes/Contact.svelte') }),
    '/feed': wrap({ asyncComponent: () => import('./routes/Feed.svelte') }),
    /** Legacy `/feed/nevent1…` or `/feed/note1…` → `/feed?thread=` so the list never remounts. */
    '/feed/:id': wrap({ asyncComponent: () => import('./routes/FeedThreadRedirect.svelte') }),
    '/p/:id/:kind': wrap({ asyncComponent: () => import('./routes/Profile.svelte') }),
    '/p/:id': wrap({ asyncComponent: () => import('./routes/Profile.svelte') }),
    '/publication/d/:d/p/:npub': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/publication/d/:d': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/publication/naddr/:naddr': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/publication/nevent/:naddr': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/publication/note/:naddr': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    '/publication/:naddr': wrap({ asyncComponent: () => import('./routes/Publication.svelte') }),
    /** Publication / article catalog hubs (plural paths; distinct from `/publication/…` / `/article/…`). */
    '/publications': wrap({ asyncComponent: () => import('./routes/PublicationsHub.svelte') }),
    '/publications/search': wrap({
      asyncComponent: () => import('./routes/PublicationsSearch.svelte')
    }),
    '/articles': wrap({ asyncComponent: () => import('./routes/ArticlesHub.svelte') }),
    '/articles/search': wrap({ asyncComponent: () => import('./routes/ArticlesSearch.svelte') }),
    /** Wiki hub (NostrWiki-style) — must stay above `/wiki/:naddr`. */
    '/wiki': wrap({ asyncComponent: () => import('./routes/WikiHub.svelte') }),
    '/wiki/recent': wrap({ asyncComponent: () => import('./routes/WikiRecent.svelte') }),
    '/wiki/search': wrap({ asyncComponent: () => import('./routes/WikiSearch.svelte') }),
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

  /** Path-only — query changes (?section=, ?thread=, ?tab=) must not reset scroll. */
  let lastScrollPath = '';

  $effect(() => {
    const path = $location || '/';
    if (path === lastScrollPath) return;
    lastScrollPath = path;
    // Reader scrollY otherwise carries onto Home (mobile lands at the bottom).
    // Feed list ↔ thread uses query params on `/feed`, so path stays `/feed` and
    // scroll is owned by Feed.svelte (no remount, no forced jump here).
    queueMicrotask(() => appScrollTo({ top: 0, left: 0, behavior: 'auto' }));
  });

  /** App-owned back stack (path + query) for the global Return control. */
  $effect(() => {
    void $location;
    void $querystring;
    trackNavChange(currentNavKey());
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

<div class="pwa-update-host">
  <PwaUpdateBanner />
</div>
<TopBar />
<div class="app-scroll" bind:this={scrollEl}>
  <Router {routes} />
</div>
<SiteFooter />
<MediaViewer />
<RawEventViewer />
<PublishToast />
