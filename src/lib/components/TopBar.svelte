<script lang="ts">
  import { link, location } from 'svelte-spa-router';
  import { navigateReturn } from '$lib/nav-history';
  import { session } from '$lib/stores/session';
  import { loginDialogOpen, openLoginDialog, closeLoginDialog } from '$lib/stores/login-ui';
  import UserBadge from './UserBadge.svelte';
  import LoginDialog from './LoginDialog.svelte';
  import SearchForm from './SearchForm.svelte';

  interface Props {
    /**
     * Show the global search field above the nav.
     * Defaults on; forced off on `/search` (that page has its own field).
     */
    showSearch?: boolean;
    /** Publication reader: hide on scroll down, show on scroll up. */
    autoHideOnScroll?: boolean;
  }

  let { showSearch = true, autoHideOnScroll = false }: Props = $props();
  let concealed = $state(false);

  const path = $derived(($location ?? '').split('?')[0] || '');
  const onSearchPage = $derived(path === '/search');
  const searchVisible = $derived(showSearch && !onSearchPage);
  const onHome = $derived(path === '/' || path === '');
  const onFeed = $derived(path.startsWith('/feed'));
  const onCompose = $derived(path.startsWith('/compose'));
  const onSettings = $derived(path.startsWith('/settings'));
  const onAbout = $derived(path.startsWith('/about'));

  $effect(() => {
    if (!autoHideOnScroll) {
      concealed = false;
      document.documentElement.classList.remove('top-bar-concealed');
      return;
    }

    const TOP_SHOW = 48;
    const DELTA = 8;
    let lastY = window.scrollY;
    let raf = 0;

    const apply = () => {
      raf = 0;
      const y = window.scrollY;
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
    lastY = window.scrollY;
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
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
  <nav class:top-bar-nav-with-return={!onHome}>
    {#if !onHome}
      <button
        type="button"
        class="top-bar-return"
        title="Back"
        aria-label="Back"
        onclick={() => navigateReturn()}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
          />
        </svg>
      </button>
    {/if}
    <div class="top-bar-nav-tabs">
      <a
        href="#/"
        use:link
        class="top-bar-home"
        title="Home"
        aria-label="Home"
        aria-current={onHome ? 'page' : undefined}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"
          />
        </svg>
      </a>
      <a href="#/feed" use:link aria-current={onFeed ? 'page' : undefined}>Feed</a>
      <a href="#/compose" use:link aria-current={onCompose ? 'page' : undefined}>Compose</a>
      <a href="#/about" use:link aria-current={onAbout ? 'page' : undefined}>About</a>
      <a
        href="#/settings"
        use:link
        class="top-bar-settings"
        title="Settings"
        aria-label="Settings"
        aria-current={onSettings ? 'page' : undefined}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.86 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.39 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.55 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
          />
        </svg>
      </a>
    </div>
  </nav>
  {#if searchVisible}
    <SearchForm class="top-bar-search" />
  {/if}
  <div class="top-bar-session">
    {#if $session.pubkey}
      <UserBadge pubkey={$session.pubkey} />
      <button
        class="btn btn-icon icon-action-btn"
        type="button"
        title="Sign out"
        aria-label="Sign out"
        onclick={() => session.signOut()}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"
          />
        </svg>
      </button>
    {:else}
      <button
        class="btn btn-icon icon-action-btn icon-action-btn-accent"
        type="button"
        disabled={$session.loading}
        title={$session.loading ? 'Signing in…' : 'Sign in'}
        aria-label={$session.loading ? 'Signing in…' : 'Sign in'}
        onclick={() => openLoginDialog()}
      >
        {#if $session.loading}
          <span class="jump-busy-spinner" aria-hidden="true"></span>
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M11 7 9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"
            />
          </svg>
        {/if}
      </button>
    {/if}
  </div>
</header>

<LoginDialog open={$loginDialogOpen} onClose={closeLoginDialog} />
