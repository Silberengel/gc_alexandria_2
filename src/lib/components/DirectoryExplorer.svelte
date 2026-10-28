<script lang="ts">
  import type { Event } from 'nostr-tools';
  import type { Component } from 'svelte';
  import { link, push } from 'svelte-spa-router';
  import { onMount } from 'svelte';
  import UserBadge from './UserBadge.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import LoadingHint from './LoadingHint.svelte';
  import { KIND } from '$lib/constants';
  import { directoryDTag, MAX_BOOKSHELF_DEPTH } from '$lib/bookshelf';
  import {
    directoryChildHref,
    directoryCoordinateHref,
    directoryEntryIconClass,
    directoryEntryKindLine,
    directoryExplorerEntries,
    directoryExplorerTitle,
    type DirectoryExplorerEntry
  } from '$lib/directory-explorer';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { memoryGetEvent, memoryFindByAddress } from '$lib/nostr/event-memory';
  import { parseEventCoordinate } from '$lib/library-scope';
  import { warmAddress, warmNavEvent } from '$lib/nav-warm';
  import { formatAbsoluteTime, formatRelativeTime } from '$lib/relative-time';
  import { kindDescription } from '$lib/kind-label';

  interface Props {
    event: Event;
    /** Nesting depth (cycle / depth guard). */
    depth?: number;
    /** Coordinates already open above this node. */
    pathCoords?: string[];
    showMenu?: boolean;
    /** Compact chrome for nested folders. */
    nested?: boolean;
    /**
     * Listing / search card: title + meta only (no children).
     * Whole card click opens the feed thread.
     */
    headerOnly?: boolean;
  }

  /**
   * Deferred self-import — a static `import DirectoryExplorer from …` is undefined
   * during Vite's circular module init (folder expand rendered nothing). Dynamic
   * import resolves after this module finishes exporting.
   */
  const NestedExplorer = import('./DirectoryExplorer.svelte').then(
    (m) => m.default as Component<Props>
  );

  let {
    event,
    depth = 0,
    pathCoords = [],
    showMenu = true,
    nested = false,
    headerOnly = false
  }: Props = $props();

  const title = $derived(directoryExplorerTitle(event));
  const dTag = $derived(directoryDTag(event));
  const entries = $derived(directoryExplorerEntries(event));
  const relative = $derived(formatRelativeTime(event.created_at));
  const absolute = $derived(formatAbsoluteTime(event.created_at));

  let expanded = $state<Record<string, boolean>>({});
  let resolved = $state<Record<string, Event | null>>({});
  let loadingKeys = $state<Record<string, boolean>>({});

  const selfCoord = $derived(
    event.kind === KIND.DIRECTORY
      ? `${event.kind}:${event.pubkey.toLowerCase()}:${event.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`
      : ''
  );

  async function resolveEntry(entry: DirectoryExplorerEntry): Promise<Event | null> {
    if (entry.coordinate) {
      const parsed = parseEventCoordinate(entry.coordinate);
      const warmAddr = parsed
        ? memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d)
        : null;
      const warm = warmAddr ?? (entry.eventId ? memoryGetEvent(entry.eventId) : null);
      if (warm) return warm;
      warmAddress(entry.coordinate);
      const hit = await fetchByAddress(entry.coordinate, {
        hintRelays: entry.relayHint ? [entry.relayHint] : undefined
      });
      return hit;
    }
    if (entry.eventId) {
      const warm = memoryGetEvent(entry.eventId);
      if (warm) return warm;
      return fetchById(entry.eventId, {
        hintRelays: entry.relayHint ? [entry.relayHint] : undefined
      });
    }
    return null;
  }

  async function ensureResolved(entry: DirectoryExplorerEntry): Promise<Event | null> {
    if (resolved[entry.key] !== undefined) return resolved[entry.key];
    if (loadingKeys[entry.key]) return null;
    loadingKeys = { ...loadingKeys, [entry.key]: true };
    try {
      const hit = await resolveEntry(entry);
      resolved = { ...resolved, [entry.key]: hit };
      return hit;
    } finally {
      loadingKeys = { ...loadingKeys, [entry.key]: false };
    }
  }

  async function toggleFolder(entry: DirectoryExplorerEntry): Promise<void> {
    const next = !expanded[entry.key];
    expanded = { ...expanded, [entry.key]: next };
    if (next) await ensureResolved(entry);
  }

  async function openFile(entry: DirectoryExplorerEntry): Promise<void> {
    const hit = await ensureResolved(entry);
    if (hit) {
      warmNavEvent(hit);
      const href = directoryChildHref(hit);
      if (href) {
        push(href.startsWith('#') ? href.slice(1) : href);
        return;
      }
    }
    if (entry.coordinate) {
      const href = directoryCoordinateHref(entry.coordinate);
      if (href) {
        push(href.startsWith('#') ? href.slice(1) : href);
        return;
      }
    }
    if (entry.eventId) {
      push(`/feed?thread=${entry.eventId}`);
    }
  }

  function entryHref(entry: DirectoryExplorerEntry): string {
    const hit = resolved[entry.key];
    if (hit) {
      const href = directoryChildHref(hit);
      if (href) return href;
    }
    if (entry.coordinate) return directoryCoordinateHref(entry.coordinate) ?? '';
    if (entry.eventId) return `#/feed?thread=${entry.eventId}`;
    return '';
  }

  onMount(() => {
    if (headerOnly) return;
    // Prefetch first wave of children so labels can upgrade from d-slugs to titles.
    void (async () => {
      for (const entry of entries.slice(0, 24)) {
        await ensureResolved(entry);
      }
    })();
  });

  function displayLabel(entry: DirectoryExplorerEntry): string {
    const hit = resolved[entry.key];
    if (hit) {
      const t =
        hit.tags.find((t) => t[0] === 'title')?.[1]?.trim() ||
        hit.tags.find((t) => t[0] === 'd')?.[1]?.replace(/-/g, ' ');
      if (t) return t;
    }
    return entry.label;
  }

  const childPath = $derived(
    selfCoord ? [...pathCoords, selfCoord.toLowerCase()] : pathCoords
  );
  const atDepthLimit = $derived(depth >= MAX_BOOKSHELF_DEPTH);
</script>

<section
  class="directory-explorer"
  class:directory-explorer-nested={nested}
  class:directory-explorer-header-only={headerOnly}
  aria-label={title}
>
  {#if !nested}
    <header class="directory-explorer-head">
      <span class="directory-explorer-folder-icon" aria-hidden="true"></span>
      <div class="directory-explorer-titles">
        <div class="directory-explorer-title-row">
          <h2 class="directory-explorer-title">{title}</h2>
          {#if dTag}
            <span class="directory-explorer-dtag">{dTag}</span>
          {/if}
        </div>
        <p class="directory-explorer-meta muted">
          <UserBadge pubkey={event.pubkey} />
          <time datetime={new Date(event.created_at * 1000).toISOString()} title={absolute}
            >{relative}</time
          >
          <span>{kindDescription(KIND.DIRECTORY)}</span>
          <span>{entries.length} {entries.length === 1 ? 'item' : 'items'}</span>
        </p>
      </div>
      {#if showMenu && !headerOnly}
        <CopyPointerButton {event} class="directory-explorer-copy" />
      {/if}
    </header>
  {/if}

  {#if headerOnly}
    <!-- Listing indicator — children load on the feed thread. -->
  {:else if entries.length === 0}
    <p class="muted directory-explorer-empty">This folder is empty.</p>
  {:else}
    <ul class="directory-explorer-list" role="tree">
      {#each entries as entry (entry.key)}
        {@const open = !!expanded[entry.key]}
        {@const child = resolved[entry.key]}
        {@const busy = !!loadingKeys[entry.key]}
        {@const href = entry.role === 'file' ? entryHref(entry) : ''}
        {@const cycle =
          entry.role === 'folder' &&
          entry.coordinate != null &&
          childPath.includes(entry.coordinate.toLowerCase())}
        <li
          class="directory-explorer-item"
          class:is-folder={entry.role === 'folder'}
          class:is-open={open}
          role="treeitem"
          aria-selected="false"
          aria-expanded={entry.role === 'folder' ? open : undefined}
        >
          <div class="directory-explorer-row">
            {#if entry.role === 'folder'}
              <button
                type="button"
                class="directory-explorer-twist"
                aria-label={open ? 'Collapse folder' : 'Expand folder'}
                disabled={cycle || atDepthLimit}
                onclick={() => void toggleFolder(entry)}
              >
                <span class="directory-explorer-twist-icon" aria-hidden="true"></span>
              </button>
              <button
                type="button"
                class="directory-explorer-link"
                onclick={() => void toggleFolder(entry)}
              >
                <span class="directory-explorer-icon is-folder" aria-hidden="true"></span>
                <span class="directory-explorer-name">{displayLabel(entry)}</span>
                <span class="directory-explorer-kind muted">{directoryEntryKindLine(entry)}</span>
              </button>
            {:else if href}
              <span class="directory-explorer-twist-spacer" aria-hidden="true"></span>
              <a
                class="directory-explorer-link"
                href={href}
                use:link
                onclick={(e) => {
                  e.preventDefault();
                  void openFile(entry);
                }}
              >
                <span
                  class="directory-explorer-icon {directoryEntryIconClass(entry)}"
                  aria-hidden="true"
                ></span>
                <span class="directory-explorer-name">{displayLabel(entry)}</span>
                <span class="directory-explorer-kind muted">{directoryEntryKindLine(entry)}</span>
              </a>
            {:else}
              <span class="directory-explorer-twist-spacer" aria-hidden="true"></span>
              <button type="button" class="directory-explorer-link" onclick={() => void openFile(entry)}>
                <span
                  class="directory-explorer-icon {directoryEntryIconClass(entry)}"
                  aria-hidden="true"
                ></span>
                <span class="directory-explorer-name">{displayLabel(entry)}</span>
                <span class="directory-explorer-kind muted">{directoryEntryKindLine(entry)}</span>
              </button>
            {/if}
            {#if busy}
              <span class="directory-explorer-busy muted">…</span>
            {/if}
          </div>
          {#if entry.role === 'folder' && open}
            <div class="directory-explorer-children">
              {#if cycle}
                <p class="muted directory-explorer-empty">Cycle detected.</p>
              {:else if atDepthLimit}
                <p class="muted directory-explorer-empty">Maximum folder depth reached.</p>
              {:else if child && child.kind === KIND.DIRECTORY}
                {#await NestedExplorer then Explorer}
                  <Explorer
                    event={child}
                    depth={depth + 1}
                    pathCoords={childPath}
                    showMenu={false}
                    nested
                  />
                {/await}
              {:else if child}
                <p class="muted directory-explorer-empty">Not a directory.</p>
              {:else if busy}
                <LoadingHint message="Opening folder…" />
              {:else}
                <p class="muted directory-explorer-empty">Could not load this folder.</p>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
