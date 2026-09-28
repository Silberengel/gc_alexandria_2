<script lang="ts">
  import { onMount } from 'svelte';
  import { link } from 'svelte-spa-router';
  import TopBar from '$lib/components/TopBar.svelte';
  import BooklistAvatar from '$lib/components/BooklistAvatar.svelte';
  import {
    aggregateBooklists,
    filterBooklists,
    loadBooklistLabelEvents,
    parseBooklistScope,
    scopedBooklistView,
    type BooklistEntry,
    type BooklistScope
  } from '$lib/booklists';
  import { followPubkeysFromMetadata, muteState } from '$lib/mute';
  import { session } from '$lib/stores/session';

  const AVATAR_CAP = 10;

  let loading = $state(true);
  let entries = $state<BooklistEntry[]>([]);
  let scope = $state<BooklistScope>('all');

  const signedIn = $derived(Boolean($session.pubkey));
  const visible = $derived(
    filterBooklists(entries, scope).map((entry) => {
      const view = scopedBooklistView(entry, scope);
      const shown = view.authors.slice(0, AVATAR_CAP);
      const extra = Math.max(0, view.authors.length - shown.length);
      return { ...view, shown, extra };
    })
  );

  function scopeFromHash(): BooklistScope {
    const hash = window.location.hash;
    const qs = hash.includes('?') ? hash.split('?')[1] : '';
    return parseBooklistScope(new URLSearchParams(qs).get('scope'));
  }

  function setScope(next: BooklistScope): void {
    scope = next;
    const base = '#/booklists';
    window.location.hash = next === 'all' ? base : `${base}?scope=${next}`;
  }

  async function refresh(): Promise<void> {
    loading = true;
    try {
      const events = await loadBooklistLabelEvents();
      const viewer = session.getPubkey();
      const follows = followPubkeysFromMetadata(session.getMetadata());
      entries = aggregateBooklists(events, viewer, follows, $muteState);
    } finally {
      loading = false;
    }
  }

  function pubLabel(n: number): string {
    return n === 1 ? '1 publication' : `${n} publications`;
  }

  onMount(() => {
    scope = scopeFromHash();
    let lastPk = session.getPubkey();
    void refresh();
    const onHash = () => {
      scope = scopeFromHash();
    };
    window.addEventListener('hashchange', onHash);
    const unsub = session.subscribe(($s) => {
      if ($s.pubkey === lastPk) return;
      lastPk = $s.pubkey;
      void refresh();
    });
    return () => {
      window.removeEventListener('hashchange', onHash);
      unsub();
    };
  });
</script>

<TopBar showSearch />
<main class="shell settings-shell booklists-page">
  <header class="page-header">
    <p class="page-kicker">Library</p>
    <h1>Booklists</h1>
    <p class="page-lede muted">
      Labels people use to gather publications — browse your own lists, lists from accounts you follow, or the wider network.
    </p>
  </header>

  <div class="booklist-scope" role="group" aria-label="Booklist source">
    <button
      type="button"
      class="booklist-scope-btn"
      class:active={scope === 'all'}
      aria-pressed={scope === 'all'}
      onclick={() => setScope('all')}
    >All</button>
    <button
      type="button"
      class="booklist-scope-btn"
      class:active={scope === 'mine'}
      aria-pressed={scope === 'mine'}
      disabled={!signedIn}
      title={signedIn ? 'Lists you have used' : 'Sign in to see your lists'}
      onclick={() => setScope('mine')}
    >My own lists</button>
    <button
      type="button"
      class="booklist-scope-btn"
      class:active={scope === 'follows'}
      aria-pressed={scope === 'follows'}
      disabled={!signedIn}
      title={signedIn ? 'Lists from accounts you follow' : 'Sign in to see lists from follows'}
      onclick={() => setScope('follows')}
    >From follows</button>
  </div>

  {#if !signedIn && scope !== 'all'}
    <p class="muted booklists-hint">Sign in to filter by your lists or follows.</p>
  {/if}

  {#if loading}
    <p class="loading-hint">Loading booklists…</p>
  {:else if !visible.length}
    <p class="muted">
      {#if scope === 'mine'}
        You have not labeled any publications yet.
      {:else if scope === 'follows'}
        No list labels from accounts you follow yet.
      {:else}
        No booklist labels found on the relays right now.
      {/if}
    </p>
  {:else}
    <ul class="booklist-index">
      {#each visible as entry (entry.slug)}
        <li class="booklist-index-row">
          <div class="booklist-index-main">
            <a
              class="booklist-index-title"
              href={`#/search?label=${encodeURIComponent(entry.slug)}`}
              use:link
            >{entry.title}</a>
            <span class="booklist-index-meta muted">{pubLabel(entry.publicationCount)}</span>
          </div>
          {#if entry.shown.length}
            <div
              class="booklist-avatar-stack"
              title={`${entry.authors.length} ${entry.authors.length === 1 ? 'person' : 'people'}`}
            >
              {#each entry.shown as pk (pk)}
                <BooklistAvatar pubkey={pk} />
              {/each}
              {#if entry.extra > 0}
                <span class="booklist-avatar-more" aria-label={`${entry.extra} more`}>+{entry.extra}</span>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>
