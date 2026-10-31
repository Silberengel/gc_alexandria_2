<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { tick } from 'svelte';
  import { NIP32_BOOKLIST_LABEL } from '$lib/constants';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { signAndPublish } from '$lib/sign';
  import { showNotice } from '$lib/stores/toast';
  import { publicationLabelDraft, deletionDraft } from '$lib/drafts';
  import {
    extractNip32LabelValues,
    isListPublicationLabelEvent,
    labelEventHasSlug,
    eventTargetsPublication
  } from '$lib/nip32';
  import { isReadLabelSlug } from '$lib/nip32';
  import {
    displayTitleForPublicationLabel,
    loadTrustedShelfSuggestions,
    myPublicationListLabels,
    slugifyPublicationLabel
  } from '$lib/publication-lists';
  import {
    loadBookshelfState,
    toggleBookshelfShelf,
    addNewBookshelf,
    type BookshelfState
  } from '$lib/bookshelf-actions';
  import { MY_BOOK_COLLECTION_D_TAG, type BookshelfShelfOption } from '$lib/bookshelf';
  import { placeMenuPanel, type MenuPlacement } from '$lib/menu-placement';

  interface Props {
    publication: Event;
  }

  let { publication }: Props = $props();
  let mine = $state<Event[]>([]);
  let listsOpen = $state(false);
  let shelfOpen = $state(false);
  let listsPlace = $state<MenuPlacement>({ side: 'start', up: false, top: 0, left: 0, maxHeight: 320 });
  let shelfPlace = $state<MenuPlacement>({ side: 'start', up: false, top: 0, left: 0, maxHeight: 320 });
  let listsWrap: HTMLDivElement | undefined = $state();
  let shelfWrap: HTMLDivElement | undefined = $state();
  let listsPanel: HTMLUListElement | undefined = $state();
  let shelfPanel: HTMLUListElement | undefined = $state();
  let busy = $state(false);
  let busySlug = $state<string | null>(null);
  let bookshelf = $state<BookshelfState | null>(null);
  let shelfLoading = $state(false);
  let addingList = $state(false);
  let addingShelf = $state(false);
  let newListName = $state('');
  let newShelfName = $state('');
  /** Add new shelf memberships as encrypted private tags. */
  let shelfPrivate = $state(false);
  let listLabelSuggestions = $state<string[]>([]);
  let folderNameSuggestions = $state<string[]>([]);
  let suggestionsLoading = $state(false);
  let suggestionsLoaded = $state(false);

  $effect(() => {
    const unsub = session.metadata.subscribe((events) => {
      mine = events;
    });
    return unsub;
  });

  $effect(() => {
    if (!listsOpen && !shelfOpen) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (listsOpen && listsWrap && t && !listsWrap.contains(t)) {
        listsOpen = false;
        addingList = false;
        newListName = '';
      }
      if (shelfOpen && shelfWrap && t && !shelfWrap.contains(t)) {
        shelfOpen = false;
        addingShelf = false;
        newShelfName = '';
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      listsOpen = false;
      shelfOpen = false;
      addingList = false;
      addingShelf = false;
      newListName = '';
      newShelfName = '';
    };
    const onReposition = () => {
      if (listsOpen) placeListsMenu();
      if (shelfOpen) placeShelfMenu();
    };
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  });

  $effect(() => {
    const pk = $session.pubkey;
    if (!pk) {
      bookshelf = null;
      return;
    }
    let cancelled = false;
    shelfLoading = true;
    void loadBookshelfState(pk, publication).then((state) => {
      if (!cancelled) {
        bookshelf = state;
        shelfLoading = false;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const myLabels = $derived(
    mine.filter((e) => isListPublicationLabelEvent(e) && eventTargetsPublication(e, publication))
  );
  const appliedSlugs = $derived(
    new Set(
      myLabels
        .flatMap((e) => extractNip32LabelValues(e.tags).map((s) => s.toLowerCase()))
        .filter((s) => !isReadLabelSlug(s))
    )
  );
  /** Lists this account already uses anywhere — not the canned home-shelf genres. */
  const myListOptions = $derived(myPublicationListLabels(mine));
  const listOptions = $derived([
    { slug: NIP32_BOOKLIST_LABEL, title: displayTitleForPublicationLabel(NIP32_BOOKLIST_LABEL) },
    ...myListOptions
  ]);
  const listOptionSlugs = $derived(new Set(listOptions.map((o) => o.slug)));
  /** True when this edition already has at least one of the viewer's list labels. */
  const onAList = $derived(appliedSlugs.size > 0);
  /** True when this edition is already in one of the viewer's bookshelf folders. */
  const onABookshelf = $derived((bookshelf?.membershipCoords.size ?? 0) > 0);

  const listSuggestionExclude = $derived(new Set([...appliedSlugs, ...listOptionSlugs]));
  const folderSuggestionExclude = $derived(
    new Set([
      ...(bookshelf?.shelves.map((s) => s.d.toLowerCase()) ?? []),
      ...(bookshelf?.shelves.map((s) => s.label.trim().toLowerCase()) ?? [])
    ])
  );

  const filteredListSuggestions = $derived(
    listLabelSuggestions.filter((name) => {
      const key = slugifyPublicationLabel(name).toLowerCase();
      return (
        !listSuggestionExclude.has(key) && !listSuggestionExclude.has(name.trim().toLowerCase())
      );
    })
  );
  const filteredFolderSuggestions = $derived(
    folderNameSuggestions.filter((name) => {
      const key = name.trim().toLowerCase();
      return !folderSuggestionExclude.has(key);
    })
  );

  async function ensureTrustedSuggestions(): Promise<void> {
    if (suggestionsLoaded || suggestionsLoading) return;
    suggestionsLoading = true;
    try {
      const next = await loadTrustedShelfSuggestions([
        ...listSuggestionExclude,
        ...folderSuggestionExclude
      ]);
      listLabelSuggestions = next.listLabels;
      folderNameSuggestions = next.folderNames;
      suggestionsLoaded = true;
    } catch {
      listLabelSuggestions = [];
      folderNameSuggestions = [];
      suggestionsLoaded = true;
    } finally {
      suggestionsLoading = false;
    }
  }

  function placeListsMenu(measured?: { width: number; height: number }): void {
    if (!listsWrap) return;
    listsPlace = placeMenuPanel(listsWrap, measured ?? { width: 260, height: 420 });
  }

  function placeShelfMenu(measured?: { width: number; height: number }): void {
    if (!shelfWrap) return;
    shelfPlace = placeMenuPanel(shelfWrap, measured ?? { width: 260, height: 420 });
  }

  async function refineListsPlace(): Promise<void> {
    await tick();
    requestAnimationFrame(() => {
      if (!listsPanel) return;
      const rect = listsPanel.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      placeListsMenu({ width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
    });
  }

  async function refineShelfPlace(): Promise<void> {
    await tick();
    requestAnimationFrame(() => {
      if (!shelfPanel) return;
      const rect = shelfPanel.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      placeShelfMenu({ width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
    });
  }

  async function needSignIn(): Promise<boolean> {
    if ($session.pubkey) return true;
    openLoginDialog();
    return false;
  }

  async function toggleLabel(slug: string): Promise<void> {
    if (isReadLabelSlug(slug)) return;
    if (!(await needSignIn()) || busySlug) return;
    busySlug = slug;
    try {
      const existing = myLabels.filter((e) => labelEventHasSlug(e, slug));
      if (existing.length) {
        for (const label of existing) {
          await signAndPublish(deletionDraft(label), { quiet: true });
        }
        mine = mine.filter((e) => !existing.includes(e));
        showNotice('Removed from shelf.', true);
      } else {
        const signed = await signAndPublish(publicationLabelDraft(publication, slug), {
          successMessage: `Added to ${slug} shelf.`
        });
        if (signed) mine = [...mine, signed];
      }
    } finally {
      busySlug = null;
      listsOpen = false;
      addingList = false;
      newListName = '';
    }
  }

  async function submitNewList(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = newListName.trim();
    if (!name) return;
    const slug = slugifyPublicationLabel(name);
    if (isReadLabelSlug(slug)) {
      window.alert('Use the read button to mark a book as read.');
      return;
    }
    await toggleLabel(slug);
  }

  async function onToggleShelf(shelf: BookshelfShelfOption): Promise<void> {
    const pk = $session.pubkey;
    if (!pk || !bookshelf || busy) return;
    busy = true;
    try {
      const already = bookshelf.membershipCoords.has(shelf.coordinate);
      const next = await toggleBookshelfShelf(pk, publication, shelf, bookshelf, {
        private: !already && shelfPrivate
      });
      if ('error' in next) {
        window.alert(next.error);
        return;
      }
      bookshelf = next;
    } finally {
      busy = false;
      shelfOpen = false;
      addingShelf = false;
      newShelfName = '';
    }
  }

  async function submitNewShelf(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const pk = $session.pubkey;
    const name = newShelfName.trim();
    if (!pk || !bookshelf || busy || !name) return;
    busy = true;
    try {
      const next = await addNewBookshelf(pk, publication, name, bookshelf);
      if ('error' in next) {
        window.alert(next.error);
        return;
      }
      bookshelf = next;
      shelfOpen = false;
      addingShelf = false;
      newShelfName = '';
    } finally {
      busy = false;
    }
  }

  async function ensureRootShelf(): Promise<void> {
    await onToggleShelf({
      coordinate: `30045:pending:${MY_BOOK_COLLECTION_D_TAG}`,
      d: MY_BOOK_COLLECTION_D_TAG,
      depth: 0,
      label: 'My bookshelf',
      isRoot: true
    });
  }

  async function startAddList(): Promise<void> {
    addingList = true;
    addingShelf = false;
    // Wait for suggestions (and tick inside refine) once so the panel is measured
    // with the add form and any new suggestion rows — avoid a no-op refine race.
    await ensureTrustedSuggestions();
    await refineListsPlace();
  }

  async function startAddShelf(): Promise<void> {
    addingShelf = true;
    addingList = false;
    await ensureTrustedSuggestions();
    await refineShelfPlace();
  }

  async function toggleListsMenu(): Promise<void> {
    if (!listsOpen && listsWrap) {
      placeListsMenu({ width: 260, height: 420 });
      void ensureTrustedSuggestions().then(() => void refineListsPlace());
    }
    listsOpen = !listsOpen;
    shelfOpen = false;
    if (!listsOpen) {
      addingList = false;
      newListName = '';
    } else {
      void refineListsPlace();
    }
  }

  async function toggleShelfMenu(): Promise<void> {
    if (!shelfOpen && shelfWrap) {
      placeShelfMenu({ width: 260, height: 420 });
      void ensureTrustedSuggestions().then(() => void refineShelfPlace());
    }
    shelfOpen = !shelfOpen;
    listsOpen = false;
    if (!shelfOpen) {
      addingShelf = false;
      newShelfName = '';
    } else {
      void refineShelfPlace();
    }
  }
</script>

{#if $session.pubkey}
  <div class="shelf-actions">
    <div class="menu-wrap" bind:this={listsWrap}>
      <button
        class="btn"
        type="button"
        disabled={!!busySlug}
        aria-expanded={listsOpen}
        onclick={() => void toggleListsMenu()}
      >
        {onAList ? 'Edit the list' : 'Add to a list'}
      </button>
      {#if listsOpen}
        <ul
          class="menu-panel menu-panel-fixed"
          bind:this={listsPanel}
          style={`top:${listsPlace.top}px;left:${listsPlace.left}px;width:260px;max-height:${listsPlace.maxHeight}px;overflow-y:auto`}
          role="menu"
        >
          {#each listOptions as opt (opt.slug)}
            <li>
              <button
                class="menu-item"
                type="button"
                disabled={busySlug === opt.slug}
                onclick={() => void toggleLabel(opt.slug)}
              >
                <span class="menu-check" aria-hidden="true">{appliedSlugs.has(opt.slug) ? '✓' : ''}</span>
                {opt.title}
              </button>
            </li>
          {/each}
          {#if filteredListSuggestions.length}
            <li class="menu-sep"></li>
            <li class="menu-item-static shelf-suggest-heading">From trusted npubs</li>
            {#each filteredListSuggestions as name (name)}
              <li>
                <button
                  class="menu-item"
                  type="button"
                  disabled={!!busySlug}
                  onclick={() => void toggleLabel(slugifyPublicationLabel(name))}
                >
                  <span class="menu-check" aria-hidden="true"></span>
                  {name}
                </button>
              </li>
            {/each}
          {:else if suggestionsLoading}
            <li class="menu-sep"></li>
            <li class="menu-item-static shelf-suggest-heading">Loading suggestions…</li>
          {/if}
          <li class="menu-sep"></li>
          {#if addingList}
            <li class="menu-item-static shelf-suggest-form-wrap">
              <form class="shelf-suggest-form" onsubmit={(e) => void submitNewList(e)}>
                <label class="visually-hidden" for="shelf-new-list-name">New list name</label>
                <input
                  id="shelf-new-list-name"
                  class="shelf-suggest-input"
                  type="text"
                  bind:value={newListName}
                  placeholder="List name"
                  autocomplete="off"
                  spellcheck="false"
                  disabled={!!busySlug}
                />
                <div class="shelf-suggest-actions">
                  <button class="btn" type="submit" disabled={!!busySlug || !newListName.trim()}
                    >Add</button
                  >
                  <button
                    class="btn"
                    type="button"
                    disabled={!!busySlug}
                    onclick={() => {
                      addingList = false;
                      newListName = '';
                      void refineListsPlace();
                    }}>Cancel</button
                  >
                </div>
              </form>
            </li>
          {:else}
            <li>
              <button class="menu-item" type="button" onclick={() => void startAddList()}>
                + Add a new list…
              </button>
            </li>
          {/if}
        </ul>
      {/if}
    </div>

    <div class="menu-wrap" bind:this={shelfWrap}>
      <button
        class="btn"
        type="button"
        disabled={busy || shelfLoading}
        aria-expanded={shelfOpen}
        onclick={() => void toggleShelfMenu()}
      >
        {#if shelfLoading}
          <span class="jump-busy-spinner" aria-hidden="true"></span>
        {/if}
        {#if shelfLoading}
          Loading bookshelves…
        {:else}
          {onABookshelf ? 'Edit the bookshelf' : 'Add to your bookshelf'}
        {/if}
      </button>
      {#if shelfOpen}
        <ul
          class="menu-panel menu-panel-fixed"
          bind:this={shelfPanel}
          style={`top:${shelfPlace.top}px;left:${shelfPlace.left}px;width:260px;max-height:${shelfPlace.maxHeight}px;overflow-y:auto`}
          role="menu"
        >
          {#if !bookshelf?.shelves.length}
            <li>
              <button class="menu-item" type="button" disabled={busy} onclick={() => void ensureRootShelf()}>
                My bookshelf
              </button>
            </li>
          {:else}
            {#each bookshelf.shelves as shelf (shelf.coordinate)}
              <li>
                <button
                  class="menu-item"
                  type="button"
                  style={shelf.depth ? `padding-left: ${0.75 + shelf.depth * 0.75}rem` : undefined}
                  disabled={busy}
                  onclick={() => void onToggleShelf(shelf)}
                >
                  <span class="menu-check" aria-hidden="true"
                    >{bookshelf.membershipCoords.has(shelf.coordinate) ? '✓' : ''}</span
                  >
                  {shelf.isRoot || shelf.d === MY_BOOK_COLLECTION_D_TAG ? 'My bookshelf' : shelf.label}
                </button>
              </li>
            {/each}
          {/if}
          {#if filteredFolderSuggestions.length}
            <li class="menu-sep"></li>
            <li class="menu-item-static shelf-suggest-heading">From trusted npubs</li>
            {#each filteredFolderSuggestions as name (name)}
              <li>
                <button
                  class="menu-item"
                  type="button"
                  disabled={busy}
                  onclick={() => {
                    newShelfName = name;
                    addingShelf = true;
                    void refineShelfPlace();
                  }}
                >
                  <span class="menu-check" aria-hidden="true"></span>
                  {name}
                </button>
              </li>
            {/each}
          {:else if suggestionsLoading}
            <li class="menu-sep"></li>
            <li class="menu-item-static shelf-suggest-heading">Loading suggestions…</li>
          {/if}
          <li class="menu-sep"></li>
          <li class="menu-item-static">
            <label
              class="shelf-private-toggle"
              title="New adds go in encrypted directory content (hidden from others)"
            >
              <input type="checkbox" bind:checked={shelfPrivate} disabled={busy} />
              Priv
            </label>
          </li>
          {#if addingShelf}
            <li class="menu-item-static shelf-suggest-form-wrap">
              <form class="shelf-suggest-form" onsubmit={(e) => void submitNewShelf(e)}>
                <label class="visually-hidden" for="shelf-new-shelf-name">New bookshelf name</label>
                <input
                  id="shelf-new-shelf-name"
                  class="shelf-suggest-input"
                  type="text"
                  bind:value={newShelfName}
                  placeholder="Bookshelf name"
                  autocomplete="off"
                  spellcheck="false"
                  disabled={busy}
                />
                <div class="shelf-suggest-actions">
                  <button class="btn" type="submit" disabled={busy || !newShelfName.trim()}
                    >Add</button
                  >
                  <button
                    class="btn"
                    type="button"
                    disabled={busy}
                    onclick={() => {
                      addingShelf = false;
                      newShelfName = '';
                      void refineShelfPlace();
                    }}>Cancel</button
                  >
                </div>
              </form>
            </li>
          {:else}
            <li>
              <button
                class="menu-item"
                type="button"
                disabled={busy}
                onclick={() => void startAddShelf()}
              >
                + New bookshelf…
              </button>
            </li>
          {/if}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .shelf-suggest-heading {
    padding: 0.35rem 0.75rem 0.15rem;
    font-size: 0.72rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: normal;
  }
  .shelf-suggest-form-wrap {
    white-space: normal;
  }
  .shelf-suggest-form {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 12rem;
  }
  .shelf-suggest-input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.35rem 0.5rem;
    font: inherit;
    font-size: 0.9rem;
  }
  .shelf-suggest-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .shelf-suggest-actions :global(.btn) {
    padding: 0.25rem 0.55rem;
    font-size: 0.82rem;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
