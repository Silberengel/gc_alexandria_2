<script lang="ts">
  import type { Event } from 'nostr-tools';
  import {
    DEFAULT_AUTHOR_RESULT_SCOPE,
    type AuthorResultScope
  } from '$lib/result-scope';
  import {
    kindOptionLabel,
    pubkeyOptionLabel,
    uniqueKinds,
    uniquePubkeys,
    type SearchSortMode
  } from '$lib/search-refine';

  const SCOPE_PREFIX = 'scope:';

  interface Props {
    events: Event[];
    kind: number | null;
    pubkey: string;
    sinceDate: string;
    untilDate: string;
    sort: SearchSortMode;
    resultScope?: AuthorResultScope;
    showMineScope?: boolean;
    showFollowsScope?: boolean;
    showTrustedScope?: boolean;
    onKind: (v: number | null) => void;
    onPubkey: (v: string) => void;
    onSinceDate: (v: string) => void;
    onUntilDate: (v: string) => void;
    onSort: (v: SearchSortMode) => void;
    onResultScope?: (v: AuthorResultScope) => void;
    onClear: () => void;
  }

  let {
    events,
    kind,
    pubkey,
    sinceDate,
    untilDate,
    sort,
    resultScope = DEFAULT_AUTHOR_RESULT_SCOPE,
    showMineScope = false,
    showFollowsScope = false,
    showTrustedScope = true,
    onKind,
    onPubkey,
    onSinceDate,
    onUntilDate,
    onSort,
    onResultScope,
    onClear
  }: Props = $props();

  const kinds = $derived.by(() => {
    const list = uniqueKinds(events);
    // Keep the active kind visible even if it dropped out of the current hit set.
    if (kind != null && !list.includes(kind)) return [...list, kind].sort((a, b) => a - b);
    return list;
  });
  const pubkeys = $derived(uniquePubkeys(events));
  const publisherValue = $derived(
    resultScope !== 'all' ? `${SCOPE_PREFIX}${resultScope}` : pubkey
  );
  const hasRefine = $derived(
    kind != null ||
      !!pubkey ||
      !!sinceDate ||
      !!untilDate ||
      sort !== 'best' ||
      resultScope !== DEFAULT_AUTHOR_RESULT_SCOPE
  );

  let detailsOpen = $state(false);
  let openedForActive = false;

  $effect(() => {
    if (hasRefine && !openedForActive) {
      detailsOpen = true;
      openedForActive = true;
    }
    if (!hasRefine) openedForActive = false;
  });

  function onPublisherChange(raw: string): void {
    if (!raw) {
      onResultScope?.('all');
      onPubkey('');
      return;
    }
    if (raw.startsWith(SCOPE_PREFIX)) {
      const scope = raw.slice(SCOPE_PREFIX.length) as AuthorResultScope;
      onResultScope?.(scope);
      onPubkey('');
      return;
    }
    onResultScope?.('all');
    onPubkey(raw);
  }
</script>

{#if events.length > 0}
  <details class="accordion search-refine-panel" bind:open={detailsOpen}>
    <summary>
      Advanced filter
      {#if hasRefine}
        <span class="search-refine-summary-active muted">· active</span>
      {/if}
    </summary>
    <div class="search-refine-bar" role="group" aria-label="Refine results">
      <label class="search-refine-field">
        <span class="muted">Kind</span>
        <select
          value={kind == null ? '' : String(kind)}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            onKind(v === '' ? null : Number(v));
          }}
        >
          <option value="">All kinds</option>
          {#each kinds as k (k)}
            <option value={String(k)}>{kindOptionLabel(k)}</option>
          {/each}
        </select>
      </label>
      <label class="search-refine-field">
        <span class="muted">Publisher</span>
        <select
          value={publisherValue}
          onchange={(e) => onPublisherChange((e.currentTarget as HTMLSelectElement).value)}
        >
          <optgroup label="Audience">
            <option value="">Anyone / All npubs</option>
            {#if showMineScope}
              <option value="{SCOPE_PREFIX}mine">Me</option>
            {/if}
            {#if showFollowsScope}
              <option value="{SCOPE_PREFIX}follows">My follows</option>
            {/if}
            {#if showTrustedScope}
              <option value="{SCOPE_PREFIX}trusted">Trusted npubs</option>
            {/if}
          </optgroup>
          {#if pubkeys.length}
            <optgroup label="Publishers in results">
              {#each pubkeys as pk (pk)}
                <option value={pk}>{pubkeyOptionLabel(pk)}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
      </label>
      <label class="search-refine-field">
        <span class="muted">From</span>
        <input type="date" value={sinceDate} onchange={(e) => onSinceDate(e.currentTarget.value)} />
      </label>
      <label class="search-refine-field">
        <span class="muted">To</span>
        <input type="date" value={untilDate} onchange={(e) => onUntilDate(e.currentTarget.value)} />
      </label>
      <label class="search-refine-field">
        <span class="muted">Sort</span>
        <select
          value={sort}
          onchange={(e) => onSort((e.currentTarget as HTMLSelectElement).value as SearchSortMode)}
        >
          <option value="best">Best match</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="title-asc">Title A–Z</option>
          <option value="title-desc">Title Z–A</option>
        </select>
      </label>
      {#if hasRefine}
        <button type="button" class="btn btn-ghost search-refine-clear" onclick={() => onClear()}>
          Clear filter
        </button>
      {/if}
    </div>
  </details>
{/if}
