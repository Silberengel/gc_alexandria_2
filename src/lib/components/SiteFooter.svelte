<script lang="ts">
  import { link, location } from 'svelte-spa-router';
  import { navigateReturn } from '$lib/nav-history';
  import { session } from '$lib/stores/session';
  import { loginDialogOpen, openLoginDialog, closeLoginDialog } from '$lib/stores/login-ui';
  import UserBadge from './UserBadge.svelte';
  import LoginDialog from './LoginDialog.svelte';

  const path = $derived(($location ?? '').split('?')[0] || '');
  const onHome = $derived(path === '/' || path === '');
  const onSearch = $derived(path === '/search');
  const onDirectory = $derived(path.startsWith('/directory'));
  const onAbout = $derived(path.startsWith('/about'));
  const onContact = $derived(path.startsWith('/contact'));
  const onSettings = $derived(path.startsWith('/settings'));
  const onProfile = $derived(path.startsWith('/p/'));
</script>

<footer class="site-footer" aria-label="App">
  <nav class="site-footer-nav">
    <button
      type="button"
      class="site-footer-btn"
      title="Back"
      aria-label="Back"
      disabled={onHome}
      onclick={() => navigateReturn()}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path
          d="M19 12H5M11 6l-6 6 6 6"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <a
      href="#/search"
      use:link
      class="site-footer-btn"
      title="Search"
      aria-label="Search"
      aria-current={onSearch ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="5.75" stroke="currentColor" stroke-width="1.75" />
        <path
          d="M15.5 15.5 20 20"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
        />
      </svg>
    </a>
    <a
      href="#/directory"
      use:link
      class="site-footer-btn"
      title="Directory"
      aria-label="Directory"
      aria-current={onDirectory ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path
          d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14A1.5 1.5 0 0 0 20.5 18V9.5A1.5 1.5 0 0 0 19 8H11l-1.7-1.7A1.5 1.5 0 0 0 8.2 5.9H5A1.5 1.5 0 0 0 3.5 7.5Z"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linejoin="round"
        />
      </svg>
    </a>
    <a
      href="#/about"
      use:link
      class="site-footer-btn"
      title="About"
      aria-label="About"
      aria-current={onAbout ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.75" />
        <path d="M12 10.5v5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
        <circle cx="12" cy="7.75" r="0.9" fill="currentColor" />
      </svg>
    </a>
    <a
      href="#/contact"
      use:link
      class="site-footer-btn"
      title="Contact"
      aria-label="Contact"
      aria-current={onContact ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <rect
          x="3.5"
          y="5.5"
          width="17"
          height="13"
          rx="1.5"
          stroke="currentColor"
          stroke-width="1.75"
        />
        <path
          d="m4.5 7.5 7.5 5.5 7.5-5.5"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </a>
    <a
      href="#/settings"
      use:link
      class="site-footer-btn"
      title="Settings"
      aria-label="Settings"
      aria-current={onSettings ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.75" />
        <path
          d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
        />
      </svg>
    </a>
    <span class="site-footer-sep" aria-hidden="true"></span>
    {#if $session.pubkey}
      <div class="site-footer-btn site-footer-profile" class:is-current={onProfile}>
        <UserBadge pubkey={$session.pubkey} avatarOnly />
      </div>
      <button
        type="button"
        class="site-footer-btn"
        title="Sign out"
        aria-label="Sign out"
        onclick={() => session.signOut()}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path
            d="M14 4.5h4.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H14M10.5 16.5 15 12l-4.5-4.5M15 12H4"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    {:else}
      <button
        type="button"
        class="site-footer-btn"
        disabled={$session.loading}
        title={$session.loading ? 'Signing in…' : 'Sign in'}
        aria-label={$session.loading ? 'Signing in…' : 'Sign in'}
        onclick={() => openLoginDialog()}
      >
        {#if $session.loading}
          <span class="jump-busy-spinner" aria-hidden="true"></span>
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <path
              d="M10 4.5H5.5A1.5 1.5 0 0 0 4 6v12a1.5 1.5 0 0 0 1.5 1.5H10M13.5 16.5 18 12l-4.5-4.5M18 12H8"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        {/if}
      </button>
    {/if}
  </nav>
</footer>

<LoginDialog open={$loginDialogOpen} onClose={closeLoginDialog} />
