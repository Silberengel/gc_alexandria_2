<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { untrack } from 'svelte';
  import { link, push } from 'svelte-spa-router';
  import LoadingHint from './LoadingHint.svelte';
  import CopyPointerButton from './CopyPointerButton.svelte';
  import { KIND } from '$lib/constants';
  import {
    MAX_BOOKSHELF_DEPTH,
    ROOT_DIRECTORY_D_TAG,
    directoryCoordinateFromEvent,
    directoryDTag,
    isProtectedDirectoryDTag
  } from '$lib/bookshelf';
  import {
    createFolderInParent,
    deleteFolderFromParent,
    directoryPrivateMembershipTags,
    listOwnedDirectories,
    moveMemberBetweenDirectories,
    removeMemberFromDirectory,
    renameFolderInParent
  } from '$lib/bookshelf-actions';
  import { session } from '$lib/stores/session';
  import {
    directoryChildCounts,
    directoryChildHref,
    directoryCoordinateHref,
    directoryEntryIconClass,
    directoryEntryKindLine,
    directoryExplorerEntries,
    directoryExplorerTitle,
    directoryPathSegment,
    directoriesUnreachableFrom,
    directoryTitleTag,
    formatDirectoryGmtParts,
    upsertDirectoryEvents,
    type DirectoryExplorerEntry
  } from '$lib/directory-explorer';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { memoryFindByAddress, memoryGetEvent } from '$lib/nostr/event-memory';
  import { parseEventCoordinate } from '$lib/library-scope';
  import { warmAddress, warmNavEvent } from '$lib/nav-warm';
  import { showNotice } from '$lib/stores/toast';
  import {
    directoryBrowserPrefs,
    resolvedDirectoryColumnWidth,
    type DirectoryColumnId,
    type DirectorySortCol
  } from '$lib/stores/directory-browser-prefs';

  interface Props {
    /** Filesystem top — the owner's `/root` directory. */
    root: Event;
    /** Hide create/remove/rename when browsing someone else's tree. */
    readOnly?: boolean;
    /**
     * All kind-30045 events from this owner. At `/root`, directories not linked
     * under the tree are listed too (parallel roots / orphans).
     */
    ownedDirectories?: Event[];
    /** Fired when `/root` is republished after a membership change. */
    onRootChange?: (root: Event) => void;
    /** Fired after owned folder create/delete/rename so the parent can refresh. */
    onOwnedDirectoriesChange?: (directories: Event[]) => void;
  }

  let {
    root,
    readOnly = false,
    ownedDirectories = [],
    onRootChange,
    onOwnedDirectoriesChange
  }: Props = $props();

  /** Stack of opened folders; index 0 is always `/root`. */
  let stack = $state<Event[]>(untrack(() => [root]));
  let resolved = $state<Record<string, Event | null>>({});
  let loadingKeys = $state<Record<string, boolean>>({});
  let selectionBusy = $state(false);
  let creatingFolder = $state(false);
  let newFolderOpen = $state(false);
  let newFolderName = $state('');
  let newFolderInput: HTMLInputElement | undefined = $state();
  let selectedKeys = $state<Record<string, boolean>>({});
  let renameOpen = $state(false);
  let renameName = $state('');
  let renamingFolder = $state(false);
  let renameInput: HTMLInputElement | undefined = $state();
  let selectAllInput: HTMLInputElement | undefined = $state();
  /** Destination picker for Move. */
  let moveOpen = $state(false);
  let moveDestId = $state('');
  let moveFolders = $state<Event[]>([]);
  let moveFoldersLoading = $state(false);
  /** Decrypted private a/e tags for the open folder (owner only). */
  let cwdPrivateTags = $state<string[][]>([]);

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

  $effect(() => {
    const folder = cwd;
    const pk = $session.pubkey?.toLowerCase() ?? '';
    if (!folder || readOnly || !pk || folder.pubkey.toLowerCase() !== pk) {
      cwdPrivateTags = [];
      return;
    }
    let cancelled = false;
    void directoryPrivateMembershipTags(folder).then((tags) => {
      if (!cancelled) cwdPrivateTags = tags;
    });
    return () => {
      cancelled = true;
    };
  });

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
    /** Membership a/e-tag points at an event that could not be fetched. */
    missing: boolean;
    kindLine: string;
    iconClass: string;
    entry?: DirectoryExplorerEntry;
    event?: Event;
  };

  const atFilesystemRoot = $derived(
    stack.length === 1 && directoryDTag(cwd) === ROOT_DIRECTORY_D_TAG
  );

  const listing = $derived.by((): ListingRow[] => {
    const rows: ListingRow[] = directoryExplorerEntries(cwd, cwdPrivateTags).map((entry) => {
      const resolvedHit = Object.prototype.hasOwnProperty.call(resolved, entry.key)
        ? resolved[entry.key]
        : undefined;
      const hit = resolvedHit ?? undefined;
      const missing = resolvedHit === null;
      const privSuffix = entry.private ? ' · Private' : '';
      if (entry.role === 'folder') {
        const counts = hit ? directoryChildCounts(hit) : null;
        const folders = counts?.folders ?? null;
        const events = counts?.events ?? null;
        return {
          key: entry.key,
          role: 'folder' as const,
          name: (hit ? directoryExplorerTitle(hit) : '') || entry.label,
          dTag: hit
            ? directoryDTag(hit)
            : entry.coordinate?.split(':').slice(2).join(':') || entry.label,
          createdAt: hit?.created_at ?? null,
          folders,
          events,
          objects: folders != null && events != null ? folders + events : null,
          missing,
          kindLine: (missing ? 'Missing folder' : 'Folder') + privSuffix,
          iconClass: missing ? 'is-folder is-missing' : 'is-folder',
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
        missing,
        kindLine:
          (missing ? `Missing ${directoryEntryKindLine(entry)}` : directoryEntryKindLine(entry)) +
          privSuffix,
        iconClass: missing
          ? `${directoryEntryIconClass(entry)} is-missing`
          : directoryEntryIconClass(entry),
        entry,
        event: hit
      };
    });

    // At /root, also list this author's other 30045 trees (e.g. starter guides)
    // that are not linked under the filesystem root.
    if (atFilesystemRoot && ownedDirectories.length) {
      const listedCoords = new Set(
        rows
          .map((r) => r.entry?.coordinate?.toLowerCase())
          .filter((c): c is string => Boolean(c))
      );
      const listedIds = new Set(rows.map((r) => r.event?.id.toLowerCase()).filter(Boolean));
      const cwdCoord = directoryCoordinateFromEvent(cwd).toLowerCase();
      for (const ev of directoriesUnreachableFrom(cwd, ownedDirectories)) {
        const coord = directoryCoordinateFromEvent(ev).toLowerCase();
        if (coord === cwdCoord || listedCoords.has(coord) || listedIds.has(ev.id.toLowerCase()))
          continue;
        // Never list /root (or its stale replaceables) as a child of itself.
        if (directoryDTag(ev) === ROOT_DIRECTORY_D_TAG) continue;
        const counts = directoryChildCounts(ev);
        rows.push({
          key: `owned:${ev.id}`,
          role: 'folder',
          name: directoryExplorerTitle(ev),
          dTag: directoryDTag(ev),
          createdAt: ev.created_at,
          folders: counts.folders,
          events: counts.events,
          objects: counts.folders + counts.events,
          missing: false,
          kindLine: 'Folder',
          iconClass: 'is-folder',
          event: ev
        });
      }
    }
    return rows;
  });

  $effect(() => {
    if (!atFilesystemRoot || !ownedDirectories.length) return;
    const extras = directoriesUnreachableFrom(cwd, ownedDirectories);
    if (!extras.length) return;
    const next = { ...resolved };
    let changed = false;
    for (const ev of extras) {
      const key = `owned:${ev.id}`;
      if (next[key] === undefined) {
        next[key] = ev;
        changed = true;
      }
    }
    if (changed) resolved = next;
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
  const occupiedDTags = $derived(
    listing
      .map((row) => row.dTag)
      .filter(Boolean)
      .concat(directoryDTag(cwd))
  );

  function rowSelectable(row: ListingRow): boolean {
    if (row.entry) return true;
    // Parallel-tree / orphan folders: selectable for Delete (not Remove/Move).
    return row.role === 'folder' && !!row.event && !isProtectedDirectoryDTag(row.dTag);
  }

  const selectedRows = $derived(sortedListing.filter((row) => selectedKeys[row.key]));
  const selectedCount = $derived(selectedRows.length);
  const selectableRows = $derived(sortedListing.filter((row) => rowSelectable(row)));
  const allSelected = $derived(
    selectableRows.length > 0 && selectableRows.every((row) => selectedKeys[row.key])
  );
  const someSelected = $derived(selectedCount > 0 && !allSelected);
  const selectedDeletableFolders = $derived(
    selectedRows.filter(
      (row) => row.role === 'folder' && !isProtectedDirectoryDTag(row.dTag)
    )
  );
  const singleRenameTarget = $derived(
    selectedDeletableFolders.length === 1 && selectedCount === 1
      ? selectedDeletableFolders[0]!
      : null
  );
  /** Membership rows can be removed/moved; orphan folder rows can be deleted. */
  const selectedMembershipRows = $derived(selectedRows.filter((row) => row.entry));
  const selectedMoveRows = $derived(selectedMembershipRows);
  const selectedFolderCoords = $derived(
    new Set(
      selectedMoveRows
        .filter((row) => row.role === 'folder')
        .map((row) => {
          if (row.event) return directoryCoordinateFromEvent(row.event).toLowerCase();
          return row.entry?.coordinate?.toLowerCase() ?? '';
        })
        .filter(Boolean)
    )
  );
  const moveDestinations = $derived(
    moveFolders.filter((folder) => {
      const coord = directoryCoordinateFromEvent(folder).toLowerCase();
      if (coord === directoryCoordinateFromEvent(cwd).toLowerCase()) return false;
      if (selectedFolderCoords.has(coord)) return false;
      return true;
    })
  );

  $effect(() => {
    // Drop checks when navigating into another folder.
    void cwd.id;
    selectedKeys = {};
    renameOpen = false;
    renameName = '';
    moveOpen = false;
    moveDestId = '';
  });

  $effect(() => {
    if (newFolderOpen) newFolderInput?.focus();
  });

  $effect(() => {
    if (renameOpen) renameInput?.focus();
  });

  $effect(() => {
    if (selectAllInput) selectAllInput.indeterminate = someSelected;
  });

  function toggleRowSelected(key: string, checked: boolean): void {
    selectedKeys = { ...selectedKeys, [key]: checked };
  }

  function toggleSelectAll(checked: boolean): void {
    if (!checked) {
      selectedKeys = {};
      return;
    }
    const next: Record<string, boolean> = {};
    for (const row of sortedListing) {
      if (rowSelectable(row)) next[row.key] = true;
    }
    selectedKeys = next;
  }

  function publishOwnedUpdate(...events: Event[]): void {
    if (!events.length) return;
    onOwnedDirectoriesChange?.(upsertDirectoryEvents(ownedDirectories, ...events));
  }

  function clearSelection(): void {
    selectedKeys = {};
    renameOpen = false;
    renameName = '';
    moveOpen = false;
    moveDestId = '';
  }

  async function openMovePicker(): Promise<void> {
    if (readOnly || !selectedMoveRows.length || selectionBusy) return;
    renameOpen = false;
    moveOpen = true;
    moveDestId = '';
    moveFoldersLoading = true;
    try {
      const pk = cwd.pubkey.toLowerCase();
      const listed = ownedDirectories.length
        ? ownedDirectories
        : await listOwnedDirectories(pk);
      // Prefer live owned list; fall back to whatever we already know.
      moveFolders = listed.filter((e) => e.kind === KIND.DIRECTORY);
    } catch {
      moveFolders = ownedDirectories.slice();
      showNotice('Could not refresh folder list.');
    } finally {
      moveFoldersLoading = false;
    }
  }

  function cancelMove(): void {
    moveOpen = false;
    moveDestId = '';
  }

  async function submitMoveSelected(): Promise<void> {
    if (readOnly || !moveDestId || selectionBusy) return;
    const dest = moveDestinations.find((f) => f.id === moveDestId);
    if (!dest) {
      showNotice('Choose a destination folder.');
      return;
    }
    const rows = selectedMoveRows;
    if (!rows.length) return;

    selectionBusy = true;
    let from = cwd;
    let to = dest;
    let moved = 0;
    let unlinkFailed = 0;
    const nextResolved = { ...resolved };
    try {
      for (const row of rows) {
        const member =
          row.event ?? (row.entry ? await ensureResolved(row.entry) : null);
        if (!member) {
          showNotice(`Could not load “${row.name}”.`);
          continue;
        }
        if (
          member.kind === KIND.DIRECTORY &&
          directoryCoordinateFromEvent(member) === directoryCoordinateFromEvent(to)
        ) {
          showNotice(`Cannot move “${row.name}” into itself.`);
          continue;
        }
        const result = await moveMemberBetweenDirectories(from, to, member, {
          private: row.entry?.private === true
        });
        if ('error' in result) {
          showNotice(result.error);
          break;
        }
        from = result.from;
        to = result.to;
        delete nextResolved[row.key];
        moved += 1;
        if (!result.unlinked) unlinkFailed += 1;
      }
      if (moved) {
        replaceStackEvent(cwd.id, from);
        // Keep an open destination folder in the path in sync after the replaceable update.
        stack = stack.map((ev) =>
          directoryCoordinateFromEvent(ev) === directoryCoordinateFromEvent(dest) ? to : ev
        );
        if (directoryDTag(to) === ROOT_DIRECTORY_D_TAG || to.id === root.id) {
          onRootChange?.(to);
        } else if (
          directoryCoordinateFromEvent(from) === directoryCoordinateFromEvent(root)
        ) {
          onRootChange?.(from);
        }
        publishOwnedUpdate(from, to);
        resolved = nextResolved;
        clearSelection();
        const destLabel = `/${directoryDTag(to) || directoryExplorerTitle(to)}`;
        if (unlinkFailed) {
          showNotice(
            `Copied ${moved} to ${destLabel}, but ${unlinkFailed} stayed linked here too.`
          );
        } else {
          showNotice(
            moved === 1 ? `Moved “${rows[0]!.name}” to ${destLabel}` : `Moved ${moved} items to ${destLabel}`,
            true
          );
        }
      }
    } finally {
      selectionBusy = false;
    }
  }

  function replaceStackEvent(previousId: string, next: Event): void {
    stack = stack.map((ev) => (ev.id === previousId ? next : ev));
    if (directoryDTag(next) === ROOT_DIRECTORY_D_TAG || next.id === root.id) {
      onRootChange?.(next);
    }
  }

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
        if (hit && hit.kind === KIND.DIRECTORY) {
          await openFolder(hit);
          return;
        }
        showNotice(
          readOnly
            ? `“${row.name}” is linked here but its folder event is missing on relays.`
            : `“${row.name}” is linked here but its folder event is missing on relays. Select it and choose Remove to unlink.`
        );
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

  function openNewFolder(): void {
    if (readOnly) return;
    newFolderName = '';
    newFolderOpen = true;
  }

  async function submitNewFolder(): Promise<void> {
    if (readOnly) return;
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    creatingFolder = true;
    try {
      const result = await createFolderInParent(cwd, name, occupiedDTags);
      if ('error' in result) {
        showNotice(result.error);
        return;
      }
      replaceStackEvent(cwd.id, result.parent);
      publishOwnedUpdate(result.parent, result.folder);
      // Prefetch will re-key entries; seed by coordinate once listing rebuilds.
      warmAddress(
        `${result.folder.kind}:${result.folder.pubkey.toLowerCase()}:${directoryDTag(result.folder)}`
      );
      newFolderOpen = false;
      newFolderName = '';
      showNotice(`Created /${directoryDTag(result.folder)}`, true);
    } finally {
      creatingFolder = false;
    }
  }

  async function removeSelected(): Promise<void> {
    if (readOnly) return;
    const rows = selectedMembershipRows;
    if (!rows.length || selectionBusy) return;
    const label =
      rows.length === 1
        ? `Remove “${rows[0]!.name}” from this folder? It will not be deleted from relays.`
        : `Remove ${rows.length} items from this folder? They will not be deleted from relays.`;
    if (!window.confirm(label)) return;

    selectionBusy = true;
    let parent = cwd;
    let removed = 0;
    const nextResolved = { ...resolved };
    try {
      for (const row of rows) {
        const result = await removeMemberFromDirectory(parent, {
          coordinate: row.entry!.coordinate,
          eventId: row.entry!.eventId,
          event: row.event ?? null
        });
        if ('error' in result) {
          showNotice(result.error);
          break;
        }
        parent = result;
        delete nextResolved[row.key];
        removed += 1;
      }
      if (removed) {
        replaceStackEvent(cwd.id, parent);
        publishOwnedUpdate(parent);
        resolved = nextResolved;
        clearSelection();
        showNotice(
          removed === 1 ? `Removed “${rows[0]!.name}”` : `Removed ${removed} items`,
          true
        );
      }
    } finally {
      selectionBusy = false;
    }
  }

  async function deleteSelectedFolders(): Promise<void> {
    if (readOnly) return;
    const rows = selectedDeletableFolders;
    if (!rows.length || selectionBusy) return;
    const hasMembership = rows.some((row) => row.entry);
    const label =
      rows.length === 1
        ? hasMembership
          ? `Permanently delete folder “${rows[0]!.name}”? It will be unlinked here and a deletion event will be published. Nested items are not deleted.`
          : `Permanently delete folder “${rows[0]!.name}”? A deletion event will be published. Nested items are not deleted.`
        : `Permanently delete ${rows.length} folders? Deletion events will be published${
            hasMembership ? ' and linked folders will be unlinked here' : ''
          }. Nested items are not deleted.`;
    if (!window.confirm(label)) return;

    selectionBusy = true;
    let parent = cwd;
    let deleted = 0;
    const nextResolved = { ...resolved };
    const deletedFolderIds = new Set<string>();
    const deletedFolderCoords = new Set<string>();
    try {
      for (const row of rows) {
        const folder = row.event ?? (row.entry ? await ensureResolved(row.entry) : null);
        if (!folder || folder.kind !== KIND.DIRECTORY) {
          showNotice(`Could not load “${row.name}”.`);
          continue;
        }
        const result = await deleteFolderFromParent(parent, folder);
        if ('error' in result) {
          showNotice(result.error);
          // Still drop tombstoned folders from the owned list when deletion published.
          if (result.error.startsWith('Folder deleted')) {
            deletedFolderIds.add(folder.id);
            deletedFolderCoords.add(directoryCoordinateFromEvent(folder).toLowerCase());
          }
          break;
        }
        parent = result.parent;
        delete nextResolved[row.key];
        deletedFolderIds.add(folder.id);
        deletedFolderCoords.add(directoryCoordinateFromEvent(folder).toLowerCase());
        deleted += 1;
      }
      if (deletedFolderIds.size) {
        replaceStackEvent(cwd.id, parent);
        resolved = nextResolved;
        stack = stack.filter((ev) => !deletedFolderIds.has(ev.id));
        if (!stack.length) stack = [root];
        const nextOwned = upsertDirectoryEvents(
          ownedDirectories.filter(
            (e) =>
              !deletedFolderIds.has(e.id) &&
              !deletedFolderCoords.has(directoryCoordinateFromEvent(e).toLowerCase())
          ),
          parent
        );
        onOwnedDirectoriesChange?.(nextOwned);
        clearSelection();
      }
      if (deleted) {
        showNotice(
          deleted === 1 ? `Deleted “${rows[0]!.name}”` : `Deleted ${deleted} folders`,
          true
        );
      }
    } finally {
      selectionBusy = false;
    }
  }

  function openRenameSelected(): void {
    if (readOnly) return;
    const row = singleRenameTarget;
    if (!row) return;
    moveOpen = false;
    moveDestId = '';
    renameOpen = true;
    renameName = row.dTag || row.name;
  }

  function cancelRename(): void {
    renameOpen = false;
    renameName = '';
  }

  async function submitRenameSelected(): Promise<void> {
    if (readOnly) return;
    const row = singleRenameTarget;
    const name = renameName.trim();
    if (!row || !name || renamingFolder) return;
    const folder = row.event ?? (row.entry ? await ensureResolved(row.entry) : null);
    if (!folder || folder.kind !== KIND.DIRECTORY) {
      showNotice('Could not load that folder.');
      return;
    }
    renamingFolder = true;
    selectionBusy = true;
    try {
      const result = await renameFolderInParent(cwd, folder, name, occupiedDTags);
      if ('error' in result) {
        showNotice(result.error);
        return;
      }
      replaceStackEvent(cwd.id, result.parent);
      publishOwnedUpdate(result.parent, result.folder);
      const nextResolved = { ...resolved };
      delete nextResolved[row.key];
      if (row.entry) {
        nextResolved[row.entry.key] = result.folder;
      }
      resolved = nextResolved;
      stack = stack.map((ev) => (ev.id === folder.id ? result.folder : ev));
      clearSelection();
      showNotice(`Renamed to /${directoryDTag(result.folder)}`, true);
    } finally {
      renamingFolder = false;
      selectionBusy = false;
    }
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
    {#if !readOnly}
      <div class="dir-browser-actions">
        {#if newFolderOpen}
          <form
            class="dir-browser-new-folder"
            onsubmit={(e) => {
              e.preventDefault();
              void submitNewFolder();
            }}
          >
            <label class="visually-hidden" for="dir-new-folder-name">Folder name</label>
            <input
              id="dir-new-folder-name"
              type="text"
              bind:this={newFolderInput}
              bind:value={newFolderName}
              placeholder="New folder name"
              maxlength="80"
              disabled={creatingFolder}
            />
            <button
              class="btn dir-browser-op-btn"
              type="submit"
              disabled={creatingFolder || !newFolderName.trim()}
            >
              {creatingFolder ? 'Creating…' : 'Create'}
            </button>
            <button
              class="btn dir-browser-op-btn"
              type="button"
              disabled={creatingFolder}
              onclick={() => {
                newFolderOpen = false;
                newFolderName = '';
              }}>Cancel</button
            >
          </form>
        {:else}
          <button
            class="btn dir-browser-new-folder-btn"
            type="button"
            disabled={creatingFolder || atDepthLimit}
            title={atDepthLimit ? 'Maximum folder depth reached' : 'Create a folder here'}
            onclick={openNewFolder}
          >
            New folder
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="dir-browser-table-wrap">
    <table class="dir-browser-table">
      <colgroup>
        <col class="dir-col-icon" style="width: 2rem" />
        <col style="width: {colWidth.name}px" />
        <col style="width: {colWidth.created}px" />
        <col style="width: {colWidth.objects}px" />
        <col style="width: {colWidth.kind}px" />
        {#if !readOnly}
          <col class="dir-col-check" style="width: 2.75rem" />
        {/if}
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
          {#if !readOnly}
            <th class="dir-col-check" scope="col">
              <label class="dir-browser-check">
                <input
                  type="checkbox"
                  bind:this={selectAllInput}
                  checked={allSelected}
                  disabled={!sortedListing.length || selectionBusy}
                  aria-label="Select all"
                  onchange={(e) => toggleSelectAll((e.currentTarget as HTMLInputElement).checked)}
                />
              </label>
            </th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#if !sortedListing.length}
          <tr>
            <td colspan={readOnly ? 5 : 6} class="dir-browser-empty muted">This folder is empty.</td>
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
              class:is-missing={row.missing}
              class:is-selected={!!selectedKeys[row.key]}
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
                  {:else if row.missing}
                    <span class="dir-browser-missing-flag muted">missing</span>
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
                  <span class="muted">{busy ? '…' : row.missing ? 'missing' : '—'}</span>
                {/if}
              </td>
              <td class="dir-col-num">
                {#if row.role === 'folder' && row.folders != null && row.events != null}
                  <span class="dir-browser-objects">
                    <span
                      >{row.folders}
                      {row.folders === 1 ? 'folder' : 'folders'}</span
                    >
                    <span class="dir-browser-objects-sep" aria-hidden="true">·</span>
                    <span
                      >{row.events} {row.events === 1 ? 'file' : 'files'}</span
                    >
                  </span>
                {:else if row.role === 'folder'}
                  <span class="muted">{busy ? '…' : row.missing ? 'missing' : '—'}</span>
                {:else}
                  {row.missing ? 'missing' : '—'}
                {/if}
              </td>
              <td class="dir-col-kind muted">{row.kindLine}</td>
              {#if !readOnly}
                <td class="dir-col-check">
                  <label class="dir-browser-check">
                    <input
                      type="checkbox"
                      checked={!!selectedKeys[row.key]}
                      disabled={selectionBusy || !rowSelectable(row)}
                      title={
                        !rowSelectable(row)
                          ? 'Not available'
                          : !row.entry
                            ? 'Outside this folder — Delete only'
                            : undefined
                      }
                      aria-label={`Select ${row.name}`}
                      onchange={(e) =>
                        toggleRowSelected(row.key, (e.currentTarget as HTMLInputElement).checked)}
                    />
                  </label>
                </td>
              {/if}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  {#if !readOnly}
    <div class="dir-browser-selection-bar" aria-label="Selection actions">
      {#if renameOpen && singleRenameTarget}
        <form
          class="dir-browser-rename"
          onsubmit={(e) => {
            e.preventDefault();
            void submitRenameSelected();
          }}
        >
          <label class="visually-hidden" for="dir-rename-selected">New folder name</label>
          <input
            id="dir-rename-selected"
            type="text"
            bind:this={renameInput}
            bind:value={renameName}
            maxlength="80"
            disabled={renamingFolder}
          />
          <button
            class="btn btn-primary dir-browser-op-btn"
            type="submit"
            disabled={renamingFolder || !renameName.trim()}
          >
            {renamingFolder ? '…' : 'Save'}
          </button>
          <button class="btn dir-browser-op-btn" type="button" disabled={renamingFolder} onclick={cancelRename}
            >Cancel</button
          >
        </form>
      {:else if moveOpen}
        <form
          class="dir-browser-move"
          onsubmit={(e) => {
            e.preventDefault();
            void submitMoveSelected();
          }}
        >
          <label class="visually-hidden" for="dir-move-dest">Move to folder</label>
          <select
            id="dir-move-dest"
            bind:value={moveDestId}
            disabled={selectionBusy || moveFoldersLoading}
          >
            <option value="">
              {moveFoldersLoading ? 'Loading folders…' : 'Move to…'}
            </option>
            {#each moveDestinations as folder (folder.id)}
              <option value={folder.id}>
                /{directoryDTag(folder) || directoryExplorerTitle(folder)}
              </option>
            {/each}
          </select>
          <button
            class="btn btn-primary dir-browser-op-btn"
            type="submit"
            disabled={selectionBusy || moveFoldersLoading || !moveDestId}
          >
            {selectionBusy ? '…' : 'Move here'}
          </button>
          <button
            class="btn dir-browser-op-btn"
            type="button"
            disabled={selectionBusy}
            onclick={cancelMove}>Cancel</button
          >
        </form>
      {:else}
        <span class="muted dir-browser-selection-count">
          {selectedCount ? `${selectedCount} selected` : 'None selected'}
        </span>
        <button
          type="button"
          class="btn dir-browser-op-btn"
          disabled={!selectedMembershipRows.length || selectionBusy}
          title="Remove selected items from this folder"
          onclick={() => void removeSelected()}
        >
          {selectionBusy ? '…' : 'Remove'}
        </button>
        <button
          type="button"
          class="btn dir-browser-op-btn"
          disabled={!selectedDeletableFolders.length || selectionBusy}
          title="Delete selected folders"
          onclick={() => void deleteSelectedFolders()}
        >
          Delete
        </button>
        <button
          type="button"
          class="btn dir-browser-op-btn"
          disabled={!selectedMoveRows.length || selectionBusy}
          title="Move selected items to another folder"
          onclick={() => void openMovePicker()}
        >
          Move
        </button>
        {#if singleRenameTarget}
          <button
            type="button"
            class="btn dir-browser-op-btn"
            disabled={selectionBusy}
            title="Rename selected folder"
            onclick={openRenameSelected}
          >
            Rename
          </button>
        {/if}
      {/if}
    </div>
  {/if}

  {#if loadingKeys && Object.values(loadingKeys).some(Boolean) && !sortedListing.some((r) => r.createdAt != null || r.role === 'file')}
    <LoadingHint message="Reading folder…" />
  {/if}
</section>
