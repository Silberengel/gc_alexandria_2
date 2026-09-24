<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { KIND, NIP32_BOOKLIST_LABEL } from '$lib/constants';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { signAndPublish } from '$lib/sign';
  import { publicationLabelDraft, bookmarkDraft, deletionDraft } from '$lib/drafts';
  import {
    extractNip32LabelValues,
    isListPublicationLabelEvent,
    labelEventHasSlug,
    eventTargetsPublication
  } from '$lib/nip32';
  import { isReadLabelSlug } from '$lib/nip32';
  import { bookmarkHasPublication } from '$lib/shelves';
  import { latestReplaceable } from '$lib/mute';
  import {
    HOME_SHELF_SLUGS,
    displayTitleForPublicationLabel,
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
  let listsPlace = $state<MenuPlacement>({ side: 'start', up: false, top: 0, left: 0 });
  let shelfPlace = $state<MenuPlacement>({ side: 'start', up: false, top: 0, left: 0 });
  let listsWrap: HTMLDivElement | undefined = $state();
  let shelfWrap: HTMLDivElement | undefined = $state();
  let busy = $state(false);
  let busySlug = $state<string | null>(null);
  let bookshelf = $state<BookshelfState | null>(null);
  let shelfLoading = $state(false);

  $effect(() => {
    const unsub = session.metadata.subscribe((events) => {
      mine = events;
    });
    return unsub;
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
  const extraSlugs = $derived(
    [...appliedSlugs].filter(
      (s) =>
        s !== NIP32_BOOKLIST_LABEL &&
        !(HOME_SHELF_SLUGS as readonly string[]).includes(s) &&
        !isReadLabelSlug(s)
    )
  );
  const listOptions = $derived([
    { slug: NIP32_BOOKLIST_LABEL, title: displayTitleForPublicationLabel(NIP32_BOOKLIST_LABEL) },
    ...HOME_SHELF_SLUGS.map((slug) => ({
      slug,
      title: displayTitleForPublicationLabel(slug)
    })),
    ...extraSlugs.map((slug) => ({ slug, title: displayTitleForPublicationLabel(slug) }))
  ]);

  const myBookmark = $derived(latestReplaceable(mine, KIND.BOOKMARK));
  const onBookmark = $derived(bookmarkHasPublication(myBookmark, publication));

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
          await signAndPublish(deletionDraft(label));
        }
        mine = mine.filter((e) => !existing.includes(e));
      } else {
        const signed = await signAndPublish(publicationLabelDraft(publication, slug));
        if (signed) mine = [...mine, signed];
      }
    } finally {
      busySlug = null;
      listsOpen = false;
    }
  }

  async function addNewLabel(): Promise<void> {
    const name = window.prompt('New list name');
    if (!name?.trim()) return;
    const slug = slugifyPublicationLabel(name);
    if (isReadLabelSlug(slug)) {
      window.alert('Use the read button to mark a book as read.');
      return;
    }
    await toggleLabel(slug);
  }

  async function toggleBookmark(): Promise<void> {
    if (!(await needSignIn()) || busy) return;
    busy = true;
    try {
      const signed = await signAndPublish(bookmarkDraft(myBookmark, publication, !onBookmark));
      if (signed) {
        mine = [...mine.filter((e) => e.kind !== KIND.BOOKMARK), signed];
      }
    } finally {
      busy = false;
    }
  }

  async function onToggleShelf(shelf: BookshelfShelfOption): Promise<void> {
    const pk = $session.pubkey;
    if (!pk || !bookshelf || busy) return;
    busy = true;
    try {
      const next = await toggleBookshelfShelf(pk, publication, shelf, bookshelf);
      if ('error' in next) {
        window.alert(next.error);
        return;
      }
      bookshelf = next;
    } finally {
      busy = false;
      shelfOpen = false;
    }
  }

  async function onAddShelf(): Promise<void> {
    const pk = $session.pubkey;
    if (!pk || !bookshelf || busy) return;
    const name = window.prompt('New bookshelf name');
    if (!name?.trim()) return;
    busy = true;
    try {
      const next = await addNewBookshelf(pk, publication, name.trim(), bookshelf);
      if ('error' in next) {
        window.alert(next.error);
        return;
      }
      bookshelf = next;
    } finally {
      busy = false;
      shelfOpen = false;
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
</script>

{#if $session.pubkey}
  <div class="shelf-actions">
    <div class="menu-wrap" bind:this={listsWrap}>
      <button
        class="btn"
        type="button"
        disabled={!!busySlug}
        aria-expanded={listsOpen}
        onclick={() => {
          if (!listsOpen && listsWrap) listsPlace = placeMenuPanel(listsWrap, { width: 240, height: 280 });
          listsOpen = !listsOpen;
          shelfOpen = false;
        }}
      >
        Add to a list
      </button>
      {#if listsOpen}
        <ul
          class="menu-panel"
          class:menu-panel-end={listsPlace.side === 'end'}
          class:menu-panel-start={listsPlace.side === 'start'}
          class:menu-panel-up={listsPlace.up}
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
          <li class="menu-sep"></li>
          <li>
            <button class="menu-item" type="button" onclick={() => void addNewLabel()}>
              + Add a new list…
            </button>
          </li>
        </ul>
      {/if}
    </div>

    <div class="menu-wrap" bind:this={shelfWrap}>
      <button
        class="btn"
        type="button"
        disabled={busy || shelfLoading}
        aria-expanded={shelfOpen}
        onclick={() => {
          if (!shelfOpen && shelfWrap) shelfPlace = placeMenuPanel(shelfWrap, { width: 240, height: 280 });
          shelfOpen = !shelfOpen;
          listsOpen = false;
        }}
      >
        Add to your bookshelf
      </button>
      {#if shelfOpen}
        <ul
          class="menu-panel"
          class:menu-panel-end={shelfPlace.side === 'end'}
          class:menu-panel-start={shelfPlace.side === 'start'}
          class:menu-panel-up={shelfPlace.up}
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
          <li class="menu-sep"></li>
          <li>
            <button class="menu-item" type="button" disabled={busy} onclick={() => void onAddShelf()}>
              + New bookshelf…
            </button>
          </li>
        </ul>
      {/if}
    </div>

    <button class="btn" type="button" disabled={busy} onclick={() => void toggleBookmark()}>
      {onBookmark ? 'Remove bookmark' : 'Bookmark'}
    </button>
  </div>
{:else}
  <div class="shelf-actions">
    <button class="btn" type="button" onclick={() => openLoginDialog()}>Sign in to list, shelf, or bookmark</button>
  </div>
{/if}
