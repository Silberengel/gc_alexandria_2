<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { nip19 } from 'nostr-tools';
  import { querystring, replace } from 'svelte-spa-router';
  import DirectoryBrowser from '$lib/components/DirectoryBrowser.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import MentionControl from '$lib/components/MentionControl.svelte';
  import {
    MY_BOOK_COLLECTION_D_TAG,
    ROOT_DIRECTORY_D_TAG,
    directoryDTag
  } from '$lib/bookshelf';
  import {
    adoptOrphanDirectoriesUnderRoot,
    createRootAdoptingDirectories,
    ensureUserHomeDirectories,
    listOwnedDirectories,
    loadUserDirectoryRoot
  } from '$lib/bookshelf-actions';
  import {
    compareDirectoryListing,
    directoriesUnreachableFrom,
    directoryExplorerTitle,
    upsertDirectoryEvents
  } from '$lib/directory-explorer';
  import { deletionRevision, filterDeletedEvents } from '$lib/deletions';
  import { hexPubkey } from '$lib/metadata';
  import { pruneToLatestReplaceables } from '$lib/nostr/replaceable';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { session } from '$lib/stores/session';
  import { showNotice } from '$lib/stores/toast';

  let loading = $state(false);
  let creating = $state(false);
  let adopting = $state(false);
  let error = $state('');
  let rootFolder = $state<Event | null>(null);
  /** All latest kind-30045 events for the viewing pubkey. */
  let ownedDirectories = $state<Event[]>([]);
  /**
   * When the owner has no `/root`, browse a chosen 30045 as a temporary top
   * (read-only). Null = show the flat index of all directories.
   */
  let browseFolder = $state<Event | null>(null);
  /** Hex pubkey whose directories are shown. */
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
  const hasFilesystemRoot = $derived(Boolean(rootFolder));
  /** Drop tombstones + older replaceables so adopt banners / extras stay accurate. */
  const liveOwnedDirectories = $derived.by(() => {
    void $deletionRevision;
    return pruneToLatestReplaceables(filterDeletedEvents(ownedDirectories));
  });
  const sortedOwned = $derived([...liveOwnedDirectories].sort(compareDirectoryListing));
  const orphanDirectories = $derived(
    rootFolder ? directoriesUnreachableFrom(rootFolder, liveOwnedDirectories) : []
  );
  const showAdoptOrphans = $derived(
    viewingSelf && hasFilesystemRoot && orphanDirectories.length > 0
  );
  const showCreateRootAdopt = $derived(
    viewingSelf && !hasFilesystemRoot && ownedDirectories.length > 0
  );

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
    browseFolder = null;
    try {
      const all = await listOwnedDirectories(pk);
      ownedDirectories = all;
      const existingRoot =
        all.find((e) => directoryDTag(e) === ROOT_DIRECTORY_D_TAG) ?? null;

      if (isSelf) {
        if (existingRoot) {
          rootFolder = existingRoot;
        } else if (all.length === 0) {
          // Fresh account — mint empty /root + my-book-collection.
          creating = true;
          const home = await ensureUserHomeDirectories(pk);
          rootFolder = home.root;
          ownedDirectories = await listOwnedDirectories(pk);
        } else {
          // Existing directories but no /root — offer an adopt button (do not auto-mint).
          rootFolder = null;
        }
      } else {
        rootFolder = existingRoot ?? (await loadUserDirectoryRoot(pk));
        if (!rootFolder && !all.length) {
          error = 'No kind 30045 directories found for that pubkey on relays.';
          return;
        }
      }
    } catch (e) {
      error =
        e instanceof Error
          ? e.message
          : isSelf
            ? 'Could not open your directories.'
            : 'Could not open that directory.';
      rootFolder = null;
      ownedDirectories = [];
    } finally {
      creating = false;
      loading = false;
    }
  }

  async function onAdoptOrphans(): Promise<void> {
    if (!rootFolder || !orphanDirectories.length || adopting) return;
    adopting = true;
    const orphans = orphanDirectories;
    const count = orphans.length;
    try {
      const next = await adoptOrphanDirectoriesUnderRoot(rootFolder, orphans);
      if ('error' in next) {
        showNotice(next.error);
        return;
      }
      rootFolder = next;
      ownedDirectories = await listOwnedDirectories(next.pubkey);
      showNotice(
        `Added ${count} ${count === 1 ? 'directory' : 'directories'} under /root.`,
        true
      );
    } finally {
      adopting = false;
    }
  }

  async function onCreateRootAndAdopt(): Promise<void> {
    if (!viewingPubkey || adopting || hasFilesystemRoot) return;
    adopting = true;
    try {
      const next = await createRootAdoptingDirectories(viewingPubkey, ownedDirectories);
      if ('error' in next) {
        showNotice(next.error);
        return;
      }
      rootFolder = next.root;
      ownedDirectories = await listOwnedDirectories(viewingPubkey);
      browseFolder = null;
      showNotice('Created /root and /my-book-collection, and linked your directories.', true);
    } finally {
      adopting = false;
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

  function openOwnedFolder(ev: Event): void {
    browseFolder = ev;
  }

  function backToOwnedIndex(): void {
    browseFolder = null;
  }

  $effect(() => {
    void $querystring;
    void $session.pubkey;
    const target = targetFromRoute();
    if (!target) {
      viewingPubkey = null;
      rootFolder = null;
      ownedDirectories = [];
      browseFolder = null;
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
      inside it), plus every other kind 30045 from this pubkey. Signed-in readers can manage their
      own tree; anyone can open another pubkey’s folders read-only.
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
        <MentionControl
          id="directory-owner-input"
          mode="npub"
          class="directory-owner-input"
          bind:value={ownerInput}
          placeholder={signedIn ? 'Your npub (default) or another pubkey' : 'npub or hex pubkey'}
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
  {:else if loading && !rootFolder && !ownedDirectories.length}
    <LoadingHint
      message={creating
        ? 'Preparing /root and /root/my-book-collection…'
        : viewingSelf
          ? 'Loading your directories…'
          : 'Loading directories…'}
    />
  {:else if error}
    <p class="muted" role="alert">{error}</p>
    <button class="btn" type="button" onclick={() => viewingPubkey && void loadHome(viewingPubkey)}
      >Retry</button
    >
  {:else if hasFilesystemRoot && rootFolder}
    {#if showAdoptOrphans}
      <div class="directory-adopt-banner">
        <p class="directory-adopt-copy">
          {orphanDirectories.length}
          {orphanDirectories.length === 1 ? 'directory is' : 'directories are'} outside
          <code>/{ROOT_DIRECTORY_D_TAG}</code>
          {#if orphanDirectories.length <= 4}
            ({orphanDirectories.map((d) => `/${directoryDTag(d) || '…'}`).join(', ')})
          {/if}
          .
        </p>
        <button
          class="btn btn-primary"
          type="button"
          disabled={adopting}
          onclick={() => void onAdoptOrphans()}
        >
          {adopting
            ? 'Adding…'
            : `Add ${orphanDirectories.length === 1 ? 'it' : 'them'} to /${ROOT_DIRECTORY_D_TAG}`}
        </button>
      </div>
    {/if}
    <DirectoryBrowser
      root={rootFolder}
      {readOnly}
      ownedDirectories={liveOwnedDirectories}
      onRootChange={(next) => {
        rootFolder = next;
        // Keep the owned pool on the latest /root replaceable so orphans / extras
        // never treat a prior /root id as a parallel tree.
        ownedDirectories = upsertDirectoryEvents(ownedDirectories, next);
      }}
      onOwnedDirectoriesChange={(next) => {
        ownedDirectories = next;
        const latestRoot =
          next.find((e) => directoryDTag(e) === ROOT_DIRECTORY_D_TAG) ?? null;
        if (latestRoot && (!rootFolder || rootFolder.id !== latestRoot.id)) {
          rootFolder = latestRoot;
        }
      }}
    />
  {:else if browseFolder}
    <div class="directory-browse-back">
      <button class="btn btn-ghost" type="button" onclick={backToOwnedIndex}
        >← All directories</button
      >
    </div>
    <DirectoryBrowser root={browseFolder} readOnly />
  {:else if sortedOwned.length}
    <p class="muted directory-no-root-hint">
      No <code>/{ROOT_DIRECTORY_D_TAG}</code> for this pubkey — showing all kind 30045 directories.
    </p>
    {#if showCreateRootAdopt}
      <div class="directory-adopt-banner">
        <p class="directory-adopt-copy">
          Create <code>/{ROOT_DIRECTORY_D_TAG}</code> and
          <code>/{MY_BOOK_COLLECTION_D_TAG}</code>, then link every existing directory under root.
        </p>
        <button
          class="btn btn-primary"
          type="button"
          disabled={adopting}
          onclick={() => void onCreateRootAndAdopt()}
        >
          {adopting ? 'Creating…' : 'Create /root and adopt directories'}
        </button>
      </div>
    {/if}
    <ul class="directory-owned-index">
      {#each sortedOwned as dir (dir.id)}
        <li>
          <button
            class="directory-owned-index-btn"
            type="button"
            onclick={() => openOwnedFolder(dir)}
          >
            <span class="directory-owned-index-icon" aria-hidden="true"></span>
            <span class="directory-owned-index-body">
              <span class="directory-owned-index-title">{directoryExplorerTitle(dir)}</span>
              <span class="muted directory-owned-index-d">/{directoryDTag(dir) || '…'}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</main>
