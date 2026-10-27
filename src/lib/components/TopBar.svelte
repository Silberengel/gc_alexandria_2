<script lang="ts">
  import { link, location } from 'svelte-spa-router';
  import { session } from '$lib/stores/session';
  import { topBarAutoHide } from '$lib/stores/top-bar-ui';
  import { appScrollY, onAppScroll } from '$lib/app-scroll';
  import SearchForm from './SearchForm.svelte';

  let concealed = $state(false);

  const path = $derived(($location ?? '').split('?')[0] || '');
  const onSearchPage = $derived(path === '/search');
  /** Hub + recent/search only — article routes keep the global search field. */
  const onWikiHub = $derived(
    path === '/wiki' || path === '/wiki/recent' || path === '/wiki/search'
  );
  const searchVisible = $derived(!onSearchPage && !onWikiHub);
  const onHome = $derived(path === '/' || path === '');
  const onFeed = $derived(path.startsWith('/feed'));
  const onCompose = $derived(path.startsWith('/compose'));
  const onDirectory = $derived(path.startsWith('/directory'));
  const signedIn = $derived(Boolean($session.pubkey));
  const autoHideOnScroll = $derived($topBarAutoHide);

  $effect(() => {
    if (!autoHideOnScroll) {
      concealed = false;
      document.documentElement.classList.remove('top-bar-concealed');
      return;
    }

    const TOP_SHOW = 48;
    const DELTA = 8;
    let lastY = appScrollY();
    let raf = 0;

    const apply = () => {
      raf = 0;
      const y = appScrollY();
      const dy = y - lastY;
      if (y <= TOP_SHOW) {
        concealed = false;
        lastY = y;
      } else if (Math.abs(dy) >= DELTA) {
        concealed = dy > 0;
        lastY = y;
      }
      document.documentElement.classList.toggle('top-bar-concealed', concealed);
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(apply);
    };

    // Fresh reader entry: start visible, then follow scroll direction.
    concealed = false;
    document.documentElement.classList.remove('top-bar-concealed');
    lastY = appScrollY();
    const stop = onAppScroll(onScroll, { passive: true });
    return () => {
      stop();
      if (raf) cancelAnimationFrame(raf);
      document.documentElement.classList.remove('top-bar-concealed');
    };
  });
</script>

<header class="top-bar" class:is-concealed={concealed} class:top-bar-with-search={searchVisible}>
  <a class="brand" href="#/" use:link>
    <img src="/favicon.png" width="32" height="32" alt="" />
    <span>Library of Alexandria</span>
  </a>
  <nav>
    <div class="top-bar-nav-tabs">
      <a href="#/" use:link aria-current={onHome ? 'page' : undefined}>Home</a>
      <a href="#/search" use:link aria-current={onSearchPage ? 'page' : undefined}>Search</a>
      <a href="#/wiki" use:link aria-current={onWikiHub ? 'page' : undefined}>Wiki</a>
      {#if signedIn}
        <a href="#/compose" use:link aria-current={onCompose ? 'page' : undefined}>Compose</a>
        <a href="#/directory" use:link aria-current={onDirectory ? 'page' : undefined}>Directory</a>
      {/if}
      <a href="#/feed" use:link aria-current={onFeed ? 'page' : undefined}>Feed</a>
    </div>
  </nav>
  {#if searchVisible}
    <SearchForm class="top-bar-search" />
  {/if}
</header>
