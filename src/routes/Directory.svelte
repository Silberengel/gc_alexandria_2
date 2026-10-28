<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { nip19 } from 'nostr-tools';
  import { querystring, replace } from 'svelte-spa-router';
  import DirectoryBrowser from '$lib/components/DirectoryBrowser.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import { MY_BOOK_COLLECTION_D_TAG, ROOT_DIRECTORY_D_TAG } from '$lib/bookshelf';
  import { ensureUserHomeDirectories, loadUserDirectoryRoot } from '$lib/bookshelf-actions';
  import { hexPubkey } from '$lib/metadata';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { session } from '$lib/stores/session';

  let loading = $state(false);
  let creating = $state(false);
  let error = $state('');
  let rootFolder = $state<Event | null>(null);
  /** Hex pubkey whose `/root` is shown. */
  let viewingPubkey = $state<string | null>(null);
  /** Field text (npub or hex); defaults to the signed-in user. */
  let ownerInput = $state('');
  let ownerFieldError = $state('');
  let ownerAccordionOpen = $state(false);

  const signedIn = $derived(Boolean($session.pubkey));
  const viewingSelf = $derived(
    Boolean(
      viewingPubkey && $session.pubkey && viewingPubkey === $session.pubkey.toLowerCase()
    )
  );
  const readOnly = $derived(!viewingSelf);

  function npubForHex(hex: string): string {
    try {
      return nip19.npubEncode(hex.toLowerCase());
    } catch {
      return hex;
    }
  }

  function targetFromRoute(): string | null {
    const params = new URLSearchParams($querystring ?? '');
    const fromUrl = hexPubkey((params.get('npub') ?? params.get('pubkey') ?? '').trim());
    if (fromUrl) return fromUrl;
    return $session.pubkey?.toLowerCase() ?? null;
  }

  async function loadHome(pubkey: string): Promise<void> {
    const pk = pubkey.toLowerCase();
    const isSelf = Boolean($session.pubkey && pk === $session.pubkey.toLowerCase());
    loading = true;
    error = '';
    creating = false;
    viewingPubkey = pk;
    ownerInput = npubForHex(pk);
    try {
      if (isSelf) {
        creating = true;
        const home = await ensureUserHomeDirectories(pk);
        rootFolder = home.root;
      } else {
        const root = await loadUserDirectoryRoot(pk);
        if (!root) {
          error = 'No /root directory found for that pubkey on relays.';
          rootFolder = null;
          return;
        }
        rootFolder = root;
      }
    } catch (e) {
      error =
        e instanceof Error
          ? e.message
          : isSelf
            ? 'Could not open your directories.'
            : 'Could not open that directory.';
      rootFolder = null;
    } finally {
      creating = false;
      loading = false;
    }
  }

  function setOwnerInUrl(hex: string | null): void {
    const params = new URLSearchParams($querystring ?? '');
    const sessionPk = $session.pubkey?.toLowerCase() ?? null;
    if (!hex || (sessionPk && hex === sessionPk)) {
      params.delete('npub');
      params.delete('pubkey');
    } else {
      params.set('npub', npubForHex(hex));
      params.delete('pubkey');
    }
    const q = params.toString();
    replace(q ? `/directory?${q}` : '/directory');
  }

  function submitOwner(e: SubmitEvent): void {
    e.preventDefault();
    ownerFieldError = '';
    const hex = hexPubkey(ownerInput);
    if (!hex) {
      ownerFieldError = 'Enter a valid npub or 64-character hex pubkey.';
      return;
    }
    ownerAccordionOpen = false;
    setOwnerInUrl(hex);
  }

  function viewMine(): void {
    ownerFieldError = '';
    ownerAccordionOpen = false;
    setOwnerInUrl(null);
  }

  $effect(() => {
    void $querystring;
    void $session.pubkey;
    const target = targetFromRoute();
    if (!target) {
      viewingPubkey = null;
      rootFolder = null;
      loading = false;
      creating = false;
      error = '';
      ownerInput = '';
      ownerAccordionOpen = true;
      return;
    }
    void loadHome(target);
  });
</script>

<main class="shell reading-body directory-page">
  <header class="page-header">
    <h1>Directory</h1>
    <p class="muted directory-lede">
      Unix-style NKBIP-04 folders. Browse
      <code>/{ROOT_DIRECTORY_D_TAG}</code>
      (with
      <code>/{ROOT_DIRECTORY_D_TAG}/{MY_BOOK_COLLECTION_D_TAG}</code>
      inside it). Signed-in readers can manage their own tree; anyone can open another pubkey’s
      folders read-only.
    </p>
  </header>

  <details class="accordion directory-owner-accordion" bind:open={ownerAccordionOpen}>
    <summary class="directory-owner-summary">
      <span class="directory-owner-summary-label">Viewing</span>
      {#if viewingPubkey}
        <!-- Prevent badge link clicks from toggling the accordion. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="directory-owner-summary-badge"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          <UserBadge pubkey={viewingPubkey} />
        </span>
        {#if readOnly}
          <span class="directory-readonly-pill">Read-only</span>
        {/if}
      {:else}
        <span class="muted">choose an owner</span>
      {/if}
    </summary>
    <form class="directory-owner-form" onsubmit={submitOwner}>
      <label class="directory-owner-label" for="directory-owner-input">Owner</label>
      <div class="directory-owner-row">
        <input
          id="directory-owner-input"
          type="text"
          class="directory-owner-input"
          bind:value={ownerInput}
          placeholder={signedIn ? 'Your npub (default) or another pubkey' : 'npub or hex pubkey'}
          autocomplete="off"
          spellcheck="false"
        />
        <button class="btn btn-primary" type="submit">Open</button>
        {#if signedIn && !viewingSelf}
          <button class="btn" type="button" onclick={viewMine}>My folders</button>
        {/if}
      </div>
      {#if ownerFieldError}
        <p class="compose-error directory-owner-error" role="alert">{ownerFieldError}</p>
      {/if}
    </form>
  </details>

  {#if !viewingPubkey}
    <div class="card directory-signin">
      <p>
        {#if signedIn}
          Loading your directories…
        {:else}
          Sign in to open your folders, or paste someone’s npub above.
        {/if}
      </p>
      {#if !signedIn}
        <button class="btn" type="button" onclick={() => openLoginDialog()}>Sign in</button>
      {/if}
    </div>
  {:else if loading && !rootFolder}
    <LoadingHint
      message={creating
        ? 'Preparing /root and /root/my-book-collection…'
        : viewingSelf
          ? 'Loading your directories…'
          : 'Loading directory…'}
    />
  {:else if error}
    <p class="muted" role="alert">{error}</p>
    <button class="btn" type="button" onclick={() => viewingPubkey && void loadHome(viewingPubkey)}
      >Retry</button
    >
  {:else if rootFolder}
    <DirectoryBrowser
      root={rootFolder}
      {readOnly}
      onRootChange={(next) => {
        rootFolder = next;
      }}
    />
  {/if}
</main>
