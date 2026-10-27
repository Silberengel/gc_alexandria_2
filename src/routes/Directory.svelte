<script lang="ts">
  import type { Event } from 'nostr-tools';
  import TopBar from '$lib/components/TopBar.svelte';
  import DirectoryBrowser from '$lib/components/DirectoryBrowser.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import { MY_BOOK_COLLECTION_D_TAG, ROOT_DIRECTORY_D_TAG } from '$lib/bookshelf';
  import { ensureUserHomeDirectories } from '$lib/bookshelf-actions';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { session } from '$lib/stores/session';

  let loading = $state(false);
  let creating = $state(false);
  let error = $state('');
  let rootFolder = $state<Event | null>(null);

  const signedIn = $derived(Boolean($session.pubkey));

  async function loadHome(pubkey: string): Promise<void> {
    loading = true;
    error = '';
    creating = false;
    try {
      creating = true;
      const home = await ensureUserHomeDirectories(pubkey);
      rootFolder = home.root;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not open your directories.';
      rootFolder = null;
    } finally {
      creating = false;
      loading = false;
    }
  }

  $effect(() => {
    const pk = $session.pubkey;
    if (!pk) {
      rootFolder = null;
      loading = false;
      creating = false;
      error = '';
      return;
    }
    void loadHome(pk);
  });
</script>

<TopBar />
<main class="shell reading-body directory-page">
  <header class="page-header">
    <h1>Directory</h1>
    <p class="muted">
      Unix-style NKBIP-04 folders. Signed-in readers always start at
      <code>/{ROOT_DIRECTORY_D_TAG}</code>
      with
      <code>/{ROOT_DIRECTORY_D_TAG}/{MY_BOOK_COLLECTION_D_TAG}</code>
      inside it.
    </p>
  </header>

  {#if !signedIn}
    <div class="card directory-signin">
      <p>Sign in to browse and manage your directories.</p>
      <button class="btn" type="button" onclick={() => openLoginDialog()}>Sign in</button>
    </div>
  {:else if loading && !rootFolder}
    <LoadingHint
      message={creating
        ? 'Preparing /root and /root/my-book-collection…'
        : 'Loading your directories…'}
    />
  {:else if error}
    <p class="muted" role="alert">{error}</p>
    <button class="btn" type="button" onclick={() => $session.pubkey && void loadHome($session.pubkey)}
      >Retry</button
    >
  {:else if rootFolder}
    <DirectoryBrowser root={rootFolder} />
  {/if}
</main>
