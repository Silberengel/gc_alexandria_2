<script lang="ts">
  import { link } from 'svelte-spa-router';
  import { session } from '$lib/stores/session';
  import { loginDialogOpen, openLoginDialog, closeLoginDialog } from '$lib/stores/login-ui';
  import UserBadge from './UserBadge.svelte';
  import LoginDialog from './LoginDialog.svelte';
  import { suggestTitles, npubFromInput, isNsec } from '$lib/search';

  interface Props {
    showSearch?: boolean;
    /** Publication reader: hide on scroll down, show on scroll up. */
    autoHideOnScroll?: boolean;
  }

  let { showSearch = false, autoHideOnScroll = false }: Props = $props();
  let query = $state('');
  let suggestions = $state<string[]>([]);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let concealed = $state(false);

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

  function submitSearch(e: Event) {
    e.preventDefault();
    const q = query.trim();
    if (!q || isNsec(q)) {
      query = '';
      return;
    }
    const npub = npubFromInput(q);
    if (npub) {
      window.location.hash = `#/p/${npub}`;
      return;
    }
    window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
  }

  function onInput(): void {
    suggestions = [];
    if (timer) clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2 || isNsec(q)) return;
    timer = setTimeout(() => {
      void suggestTitles(q).then((hits) => {
        suggestions = hits.slice(0, 8);
      });
    }, 200);
  }

  function pick(hit: string): void {
    query = hit;
    suggestions = [];
    window.location.hash = `#/search?q=${encodeURIComponent(hit)}`;
  }
</script>

<header class="top-bar" class:is-concealed={concealed}>
  <a class="brand" href="#/" use:link>
    <img src="/favicon.png" width="32" height="32" alt="" />
    <span>Library of Alexandria</span>
  </a>
  <nav>
    <a href="#/about" use:link>About</a>
    {#if $session.pubkey}
      <a href="#/contact" use:link>Contact</a>
    {/if}
    <a href="#/settings" use:link>Settings</a>
  </nav>
  {#if showSearch}
    <form class="search-form" onsubmit={submitSearch}>
      <input
        type="search"
        placeholder="Search books, wiki, events…"
        bind:value={query}
        oninput={onInput}
        autocomplete="off"
      />
      {#if suggestions.length}
        <ul class="suggest-list">
          {#each suggestions as hit}
            <li>
              <button type="button" onclick={() => pick(hit)}>{hit}</button>
            </li>
          {/each}
        </ul>
      {/if}
    </form>
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
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M11 7 9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"
          />
        </svg>
      </button>
    {/if}
  </div>
</header>

<LoginDialog open={$loginDialogOpen} onClose={closeLoginDialog} />
