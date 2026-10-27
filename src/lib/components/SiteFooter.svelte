<script lang="ts">
  import { link, location } from 'svelte-spa-router';
  import { navigateReturn } from '$lib/nav-history';
  import { session } from '$lib/stores/session';
  import { loginDialogOpen, openLoginDialog, closeLoginDialog } from '$lib/stores/login-ui';
  import UserBadge from './UserBadge.svelte';
  import LoginDialog from './LoginDialog.svelte';

  const path = $derived(($location ?? '').split('?')[0] || '');
  const onHome = $derived(path === '/' || path === '');
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
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
        />
      </svg>
    </button>
    <a
      href="#/about"
      use:link
      class="site-footer-btn"
      title="About"
      aria-label="About"
      aria-current={onAbout ? 'page' : undefined}
    >
      About
    </a>
    <a
      href="#/contact"
      use:link
      class="site-footer-btn"
      title="Contact"
      aria-label="Contact"
      aria-current={onContact ? 'page' : undefined}
    >
      Contact
    </a>
    <a
      href="#/settings"
      use:link
      class="site-footer-btn"
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
    <span class="site-footer-sep" aria-hidden="true"></span>
    {#if $session.pubkey}
      <div class="site-footer-btn site-footer-profile" class:is-current={onProfile}>
        <UserBadge pubkey={$session.pubkey} />
      </div>
      <button
        type="button"
        class="site-footer-btn"
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
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M11 7 9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"
            />
          </svg>
        {/if}
      </button>
    {/if}
  </nav>
</footer>

<LoginDialog open={$loginDialogOpen} onClose={closeLoginDialog} />
