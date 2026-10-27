<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link, push } from 'svelte-spa-router';
  import LoadingHint from './LoadingHint.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { KIND } from '$lib/constants';
  import { MAX_BOOKSHELF_DEPTH } from '$lib/bookshelf';
  import {
    directoryChildCounts,
    directoryChildHref,
    directoryCoordinateHref,
    directoryEntryIconClass,
    directoryEntryKindLine,
    directoryExplorerEntries,
    directoryExplorerTitle,
    directoryPathSegment,
    directoryTitleTag,
    formatDirectoryGmtParts,
    type DirectoryExplorerEntry
  } from '$lib/directory-explorer';
  import { directoryDTag } from '$lib/bookshelf';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { memoryFindByAddress, memoryGetEvent } from '$lib/nostr/event-memory';
  import { parseEventCoordinate } from '$lib/library-scope';
  import { warmAddress, warmNavEvent } from '$lib/nav-warm';
  import {
    directoryBrowserPrefs,
    resolvedDirectoryColumnWidth,
    type DirectoryColumnId,
    type DirectorySortCol
  } from '$lib/stores/directory-browser-prefs';

  interface Props {
    /** Filesystem top — always the viewer's `/root` directory. */
    root: Event;
  }

  let { root }: Props = $props();

  /** Stack of opened folders; index 0 is always `/root`. */
  let stack = $state<Event[]>([root]);
  let resolved = $state<Record<string, Event | null>>({});
  let loadingKeys = $state<Record<string, boolean>>({});

  const prefs = $derived($directoryBrowserPrefs);
  const colWidth = $derived({
    name: resolvedDirectoryColumnWidth(prefs, 'name'),
    created: resolvedDirectoryColumnWidth(prefs, 'created'),
    objects: resolvedDirectoryColumnWidth(prefs, 'objects'),
    kind: resolvedDirectoryColumnWidth(prefs, 'kind')
  });

  $effect(() => {
    // Keep `/root` at stack[0] when ensureUserHomeDirectories republishes it.
    const next = root;
    const head = stack[0];
    if (!head || head.id !== next.id) {
      stack = stack.length > 1 ? [next, ...stack.slice(1)] : [next];
    }
  });

  const cwd = $derived(stack.length ? stack[stack.length - 1]! : root);
  const pathSegments = $derived(
    stack.map((ev) => ({
      event: ev,
      name: directoryPathSegment(ev)
    }))
  );

  type ListingRow = {
    key: string;
    role: 'folder' | 'file';
    name: string;
    dTag: string;
    createdAt: number | null;
    folders: number | null;
    events: number | null;
    objects: number | null;
    kindLine: string;
    iconClass: string;
    entry?: DirectoryExplorerEntry;
    event?: Event;
  };

  const listing = $derived.by((): ListingRow[] => {
    return directoryExplorerEntries(cwd).map((entry) => {
      const hit = resolved[entry.key] ?? undefined;
      if (entry.role === 'folder') {
        const counts = hit ? directoryChildCounts(hit) : null;
        const folders = counts?.folders ?? null;
        const events = counts?.events ?? null;
        return {
          key: entry.key,
          role: 'folder' as const,
          name: (hit ? directoryExplorerTitle(hit) : '') || entry.label,
          dTag: hit ? directoryDTag(hit) : entry.coordinate?.split(':')[2] || entry.label,
          createdAt: hit?.created_at ?? null,
          folders,
          events,
          objects: folders != null && events != null ? folders + events : null,
          kindLine: 'Folder',
          iconClass: 'is-folder',
          entry,
          event: hit
        };
      }
      const title =
        (hit && (directoryTitleTag(hit) || directoryExplorerTitle(hit))) || entry.label;
      return {
        key: entry.key,
        role: 'file' as const,
        name: title,
        dTag: hit ? directoryDTag(hit) || '' : entry.coordinate?.split(':').slice(2).join(':') || '',
        createdAt: hit?.created_at ?? null,
        folders: null,
        events: null,
        objects: null,
        kindLine: directoryEntryKindLine(entry),
        iconClass: directoryEntryIconClass(entry),
        entry,
        event: hit
      };
    });
  });

  const sortedListing = $derived(
    [...listing].sort((a, b) => {
      if (a.role !== b.role) return a.role === 'folder' ? -1 : 1;
      const dir = prefs.sortDir === 'asc' ? 1 : -1;
      switch (prefs.sortCol) {
        case 'created':
          return ((a.createdAt ?? 0) - (b.createdAt ?? 0)) * dir;
        case 'objects':
          return ((a.objects ?? -1) - (b.objects ?? -1)) * dir;
        case 'kind':
          return a.kindLine.localeCompare(b.kindLine, undefined, { sensitivity: 'base' }) * dir;
        case 'name':
        default:
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir;
      }
    })
  );

  const atDepthLimit = $derived(stack.length >= MAX_BOOKSHELF_DEPTH);

  async function resolveEntry(entry: DirectoryExplorerEntry): Promise<Event | null> {
    if (entry.coordinate) {
      const parsed = parseEventCoordinate(entry.coordinate);
      const warmAddr = parsed
        ? memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d)
        : null;
      const warm = warmAddr ?? (entry.eventId ? memoryGetEvent(entry.eventId) : null);
      if (warm) return warm;
      warmAddress(entry.coordinate);
      return fetchByAddress(entry.coordinate, {
        hintRelays: entry.relayHint ? [entry.relayHint] : undefined
      });
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

  $effect(() => {
    const current = cwd;
    if (!current) return;
    const entries = directoryExplorerEntries(current);
    void (async () => {
      for (const entry of entries.slice(0, 40)) {
        await ensureResolved(entry);
      }
    })();
  });

  function goHome(): void {
    stack = [root];
  }

  function goToDepth(depth: number): void {
    // Never climb above `/root` (depth 1).
    const next = Math.max(1, depth);
    stack = stack.slice(0, next);
  }

  async function openFolder(ev: Event): Promise<void> {
    if (atDepthLimit) return;
    stack = [...stack, ev];
  }

  async function activateRow(row: ListingRow): Promise<void> {
    if (row.role === 'folder') {
      if (row.event) {
        await openFolder(row.event);
        return;
      }
      if (row.entry) {
        const hit = await ensureResolved(row.entry);
        if (hit && hit.kind === KIND.DIRECTORY) await openFolder(hit);
      }
      return;
    }
    if (!row.entry) return;
    const hit = await ensureResolved(row.entry);
    if (hit) {
      warmNavEvent(hit);
      const href = directoryChildHref(hit);
      if (href) {
        push(href.startsWith('#') ? href.slice(1) : href);
        return;
      }
    }
    if (row.entry.coordinate) {
      const href = directoryCoordinateHref(row.entry.coordinate);
      if (href) {
        push(href.startsWith('#') ? href.slice(1) : href);
        return;
      }
    }
    if (row.entry.eventId) push(`/feed?thread=${row.entry.eventId}`);
  }

  function rowHref(row: ListingRow): string {
    if (row.role === 'folder') return '';
    if (row.event) return directoryChildHref(row.event) ?? '';
    if (row.entry?.coordinate) return directoryCoordinateHref(row.entry.coordinate) ?? '';
    if (row.entry?.eventId) return `#/feed?thread=${row.entry.eventId}`;
    return '';
  }

  function sortArrow(col: DirectorySortCol): string {
    if (prefs.sortCol !== col) return '';
    return prefs.sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  function ariaSort(col: DirectorySortCol): 'ascending' | 'descending' | 'none' {
    if (prefs.sortCol !== col) return 'none';
    return prefs.sortDir === 'asc' ? 'ascending' : 'descending';
  }

  let resizeCol = $state<DirectoryColumnId | null>(null);
  let resizeStartX = $state(0);
  let resizeStartW = $state(0);

  function onResizeStart(col: DirectoryColumnId, e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    resizeCol = col;
    resizeStartX = e.clientX;
    resizeStartW = resolvedDirectoryColumnWidth(prefs, col);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onResizeMove(e: PointerEvent): void {
    if (!resizeCol) return;
    const next = resizeStartW + (e.clientX - resizeStartX);
    directoryBrowserPrefs.setWidth(resizeCol, next);
  }

  function onResizeEnd(e: PointerEvent): void {
    if (!resizeCol) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* already released */
    }
    resizeCol = null;
  }
</script>

<section class="dir-browser" aria-label="Directory browser">
  <nav class="dir-browser-path" aria-label="Path">
    <button type="button" class="dir-browser-crumb" onclick={goHome} aria-label="Go to /root">
      <span class="dir-browser-icon is-folder" aria-hidden="true"></span>
    </button>
    {#each pathSegments as seg, i}
      <span class="dir-browser-sep" aria-hidden="true">/</span>
      <button
        type="button"
        class="dir-browser-crumb"
        class:is-current={i === pathSegments.length - 1}
        onclick={() => goToDepth(i + 1)}
      >
        {seg.name}
      </button>
    {/each}
    <CopyPointerButton event={cwd} class="dir-browser-copy" />
  </nav>

  <div class="dir-browser-toolbar">
    <span class="muted dir-browser-cwd">
      /{pathSegments.map((s) => s.name).join('/')}
    </span>
  </div>

  <div class="dir-browser-table-wrap">
    <table class="dir-browser-table">
      <colgroup>
        <col class="dir-col-icon" style="width: 2rem" />
        <col style="width: {colWidth.name}px" />
        <col style="width: {colWidth.created}px" />
        <col style="width: {colWidth.objects}px" />
        <col style="width: {colWidth.kind}px" />
      </colgroup>
      <thead>
        <tr>
          <th class="dir-col-icon" scope="col"><span class="visually-hidden">Type</span></th>
          <th class="dir-col-name" scope="col" aria-sort={ariaSort('name')}>
            <button
              type="button"
              class="dir-browser-th-btn"
              class:is-active={prefs.sortCol === 'name'}
              onclick={() => directoryBrowserPrefs.toggleSort('name')}
            >
              Name{sortArrow('name')}
            </button>
            <span
              class="dir-browser-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize name column"
              onpointerdown={(e) => onResizeStart('name', e)}
              onpointermove={onResizeMove}
              onpointerup={onResizeEnd}
              onpointercancel={onResizeEnd}
            ></span>
          </th>
          <th class="dir-col-date" scope="col" aria-sort={ariaSort('created')}>
            <button
              type="button"
              class="dir-browser-th-btn"
              class:is-active={prefs.sortCol === 'created'}
              onclick={() => directoryBrowserPrefs.toggleSort('created')}
            >
              Created{sortArrow('created')}
            </button>
            <span
              class="dir-browser-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize created column"
              onpointerdown={(e) => onResizeStart('created', e)}
              onpointermove={onResizeMove}
              onpointerup={onResizeEnd}
              onpointercancel={onResizeEnd}
            ></span>
          </th>
          <th class="dir-col-num" scope="col" aria-sort={ariaSort('objects')}>
            <button
              type="button"
              class="dir-browser-th-btn"
              class:is-active={prefs.sortCol === 'objects'}
              onclick={() => directoryBrowserPrefs.toggleSort('objects')}
            >
              Objects{sortArrow('objects')}
            </button>
            <span
              class="dir-browser-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize objects column"
              onpointerdown={(e) => onResizeStart('objects', e)}
              onpointermove={onResizeMove}
              onpointerup={onResizeEnd}
              onpointercancel={onResizeEnd}
            ></span>
          </th>
          <th class="dir-col-kind" scope="col" aria-sort={ariaSort('kind')}>
            <button
              type="button"
              class="dir-browser-th-btn"
              class:is-active={prefs.sortCol === 'kind'}
              onclick={() => directoryBrowserPrefs.toggleSort('kind')}
            >
              Kind{sortArrow('kind')}
            </button>
            <span
              class="dir-browser-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize kind column"
              onpointerdown={(e) => onResizeStart('kind', e)}
              onpointermove={onResizeMove}
              onpointerup={onResizeEnd}
              onpointercancel={onResizeEnd}
            ></span>
          </th>
        </tr>
      </thead>
      <tbody>
        {#if !sortedListing.length}
          <tr>
            <td colspan="5" class="dir-browser-empty muted">This folder is empty.</td>
          </tr>
        {:else}
          {#each sortedListing as row (row.key)}
            {@const busy = row.entry ? !!loadingKeys[row.entry.key] : false}
            {@const href = rowHref(row)}
            {@const created = row.createdAt != null ? formatDirectoryGmtParts(row.createdAt) : null}
            <tr
              class="dir-browser-row"
              class:is-folder={row.role === 'folder'}
              class:is-file={row.role === 'file'}
            >
              <td class="dir-col-icon">
                <span class="dir-browser-icon {row.iconClass}" aria-hidden="true"></span>
              </td>
              <td class="dir-col-name">
                <div class="dir-browser-name-block">
                  {#if row.role === 'folder'}
                    <button
                      type="button"
                      class="dir-browser-name"
                      disabled={atDepthLimit}
                      onclick={() => void activateRow(row)}
                    >
                      {row.name}
                    </button>
                  {:else if href}
                    <a
                      class="dir-browser-name"
                      href={href}
                      use:link
                      onclick={(e) => {
                        e.preventDefault();
                        void activateRow(row);
                      }}>{row.name}</a
                    >
                  {:else}
                    <button type="button" class="dir-browser-name" onclick={() => void activateRow(row)}>
                      {row.name}
                    </button>
                  {/if}
                  {#if busy}
                    <span class="muted">…</span>
                  {/if}
                  {#if row.dTag}
                    <span class="dir-browser-dtag">{row.dTag}</span>
                  {/if}
                </div>
              </td>
              <td class="dir-col-date">
                {#if created}
                  <time
                    class="dir-browser-created"
                    datetime={new Date(row.createdAt! * 1000).toISOString()}
                  >
                    <span class="dir-browser-created-date">{created.date}</span>
                    <span class="dir-browser-created-time">{created.time}</span>
                  </time>
                {:else}
                  <span class="muted">{busy ? '…' : '—'}</span>
                {/if}
              </td>
              <td class="dir-col-num">
                {row.role === 'folder' ? (row.objects ?? (busy ? '…' : '—')) : '—'}
              </td>
              <td class="dir-col-kind muted">{row.kindLine}</td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  {#if loadingKeys && Object.values(loadingKeys).some(Boolean) && !sortedListing.some((r) => r.createdAt != null || r.role === 'file')}
    <LoadingHint message="Reading folder…" />
  {/if}
</section>
