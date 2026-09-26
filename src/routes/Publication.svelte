<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { replace, querystring } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import TopBar from '$lib/components/TopBar.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import EventCard from '$lib/components/EventCard.svelte';
  import EventBody from '$lib/components/EventBody.svelte';
  import CommentThread from '$lib/components/CommentThread.svelte';
  import DetailsPanel from '$lib/components/DetailsPanel.svelte';
  import RatingPanel from '$lib/components/RatingPanel.svelte';
  import ShelfActions from '$lib/components/ShelfActions.svelte';
  import ReadButton from '$lib/components/ReadButton.svelte';
  import EditionPeople from '$lib/components/EditionPeople.svelte';
  import EditionHeader from '$lib/components/EditionHeader.svelte';
  import EditionSuperindexes from '$lib/components/EditionSuperindexes.svelte';
  import EditionReaderMeta from '$lib/components/EditionReaderMeta.svelte';
  import TrackReadingButton from '$lib/components/TrackReadingButton.svelte';
  import ReadingFinishModal from '$lib/components/ReadingFinishModal.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import CopyPointerButton from '$lib/components/CopyPointerButton.svelte';
  import { KIND, NIP32_READ_LABEL } from '$lib/constants';
  import { publicationPath, hasPublicationSection, publicationSectionCount } from '$lib/metadata';
  import { muteState, filterMuted } from '$lib/mute';
  import { filterDeletedEvents, refreshDeletionsFor } from '$lib/deletions';
  import { createPageFindController, filterPageEvents } from '$lib/page-filter';
  import {
    isMercuryUnavailable,
    isMercuryPublicationMissing,
    mercuryFilter,
    mercuryPublicationMeta,
    mercuryPublicationStream,
    mercuryPublicationToc
  } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { documentStack, socialStack } from '$lib/nostr/selector';
  import { eventAddress, firstTag, isTopLevel30040 } from '$lib/nostr/verify';
  import { fetchById, fetchPublication, fetchByAddress, poolMap } from '$lib/nostr/fetch';
  import { cacheFindByAddress, cacheGetPublicationStreamSnapshot, cachePutPublicationStream, cacheClearPublicationStream } from '$lib/nostr/cache';
  import { memoryFindByAddress, memoryGetEvent, rememberEvents } from '$lib/nostr/event-memory';
  import { loadSeedsForEdition, editionHasLocalSeeds } from '$lib/nostr/seed-load';
  import {
    buildIndexScopedToc,
    collectIndexPaintEvents,
    isIndexScopedEdition,
    isReadingPlanEdition,
    listLeafIndexes,
    missingPaintAddresses,
    missingPlanDayAddresses,
    pickScopedOpenIndex,
    resolvePaintIndex,
    scopedProgressForIndex,
    warmIndexTree
  } from '$lib/index-scope';
  import { nestComments, fetchThreadEvents, threadNodeKey } from '$lib/comments';
  import { newestRatingPerAuthor, publicationRatingATagsForQuery } from '$lib/ratings';
  import { commentDraft, highlightDraft } from '$lib/drafts';
  import { publicationCoordinateLookupKeys } from '$lib/publication-coordinate';
  import { textHighlightsFromEvents, seedHighlightProfile, type TextHighlight } from '$lib/text-highlights';
  import { ingestLocalLandingHighlight, fetchSuperindexes } from '$lib/landing';
  import { signAndPublish } from '$lib/sign';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { loadResume, saveResume } from '$lib/resume';
  import {
    flushReadingProgress,
    flushReadingProgressOnHide,
    flushReadingProgressOnVisible,
    promoteReadingToFront,
    syncReadingProgress
  } from '$lib/reading-queue-actions';
  import { findQueueEntry } from '$lib/reading-queue';
  import { viewerReadingEntries } from '$lib/viewer-reading-queue';
  import { editionMetadata } from '$lib/publication-metadata';
  import { isLibraryCopyPubkey } from '$lib/hex';
  import { readerSectionHeroUrl } from '$lib/cover';
  import { bibleDisplay, groupReaderSections } from '$lib/bible-verse';
  import { verseStyling } from '$lib/stores/verse-styling';
  import { isAllowedMediaUrl } from '$lib/markup';
  import {
    decodePublicationPointer,
    enrichToc,
    buildTocTree,
    activeTocEntry,
    tocPathKeys,
    ensureIndexHeadings,
    ensureMissingSectionPlaceholders,
    expandTocFromSections,
    hexFromNpubParam,
    isPlaceholderIndex,
    isPlaceholderSection,
    isUnreadableMeta,
    mergePublicationSections,
    orderPublicationSections,
    naddrFor,
    parseToc,
    placeholderIndexEvent,
    placeholderSectionEvent,
    sectionHeading,
    tocEntryKey,
    type TocEntry
  } from '$lib/publication-load';
  import TocPanel from '$lib/components/TocPanel.svelte';
  import { searchByDTag } from '$lib/search';
  import { normalizeDTag } from '$lib/dtag';
  import { parseAddress } from '$lib/library-scope';
  import {
    eventMatchesPublicationRoute,
    takePendingNavEvent
  } from '$lib/nav-warm';

  interface Props {
    params?: { d?: string; npub?: string; naddr?: string };
  }

  let { params = {} }: Props = $props();

  let event = $state<Event | null>(null);
  let editions = $state<Event[]>([]);
  let ratings = $state<Event[]>([]);
  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let editionLabels = $state<Event[]>([]);
  let editionBookmarks = $state<Event[]>([]);
  let editionDirectories = $state<Event[]>([]);
  let editionReads = $state<Event[]>([]);
  let editionReadingQueues = $state<Event[]>([]);
  let readerPos = $state(0);
  let readerSectionId = $state<string | undefined>(undefined);
  let sectionTick = $state(false);
  let reading = $state(false);
  let superindexes = $state<Event[]>([]);
  let sections = $state<Event[]>([]);
  /** Full loaded corpus — not reactive, so ingesting stream pages does not remount the pane. */
  let sectionCorpus: Event[] = [];
  /** Reactive length for “Show more” UI (corpus itself stays non-reactive). */
  let corpusCount = $state(0);
  /**
   * Document-order index in `sectionCorpus` for `data-read-pos` / reading-queue progress.
   * Rebuilt in publishPainted from the full corpus (not the painted prefix).
   */
  let sectionReadPos = $state(new Map<string, number>());
  let toc = $state<TocEntry[]>([]);
  /** How many ordered sections to mount in the reading pane (grows on scroll / jump). */
  /**
   * Painted window into `sectionCorpus` (not always a prefix from 0).
   * Mid-book Continue only mounts nearby sections so Ascidoctor is not run on 1..N.
   */
  let paintOrigin = $state(0);
  let paintEnd = $state(35);
  /** Keep this section id inside the painted window across corpus merges. */
  let paintPinId = $state('');
  /** Douay / reading-plan: the one leaf index currently in the pane. */
  let scopedPaintIndex = $state<Event | null>(null);
  /** User chose edition root via Go to top — ignore background resume reopen. */
  let scopedAtEditionTop = false;
  /** Bumps when the scoped pane target changes; drops stale in-flight paints. */
  let scopedPaintGen = 0;
  let error = $state(false);
  /** Full-page error after the user pressed Read and no text could be loaded. */
  let unreadable = $state(false);
  /** Index/meta says there is no publishable text; keep the interactive page, hide Read. */
  let textUnavailable = $state(false);
  let loading = $state(true);
  let commentText = $state('');
  let replyOpenId = $state<string | null>(null);
  let sectionCommentText = $state<Record<string, string>>({});
  let sectionComments = $state<Record<string, Event[]>>({});
  let sectionCommentsOpen = $state<Record<string, boolean>>({});
  let treeAbort: AbortController | null = null;
  /** Info-page ToC prefetch — separate from the reader stream abort. */
  let prefetchAbort: AbortController | null = null;
  /** Avoid tearing down a warm paint when the route effect re-fires for the same edition. */
  let paintedRouteKey = '';
  let pageFilter = $state('');
  let readingBusy = $state(false);
  /** True while the section stream is still filling after the edition shell paints. */
  let sectionsLoading = $state(false);
  /** ToC jump to a section that is not in the pane yet. */
  let jumpBusy = $state(false);
  let jumpLabel = $state('');
  let tocOpen = $state(false);
  /** Expand/collapse state for nested ToC branches (default: top-level open). */
  let tocExpanded = $state<Record<string, boolean>>({});
  let readingPane = $state<HTMLElement | undefined>();
  /**
   * Snapshot of a non-empty reading-pane selection for "Create highlight" in ToC chrome.
   * Survives selection collapse when the user opens the mobile ToC or clicks the control.
   */
  let readerHighlightDraft = $state<{
    section: Event;
    quote: string;
    context?: string;
  } | null>(null);
  /** Skip one empty selectionchange after pointerdown on ToC / FAB. */
  let keepHighlightDraft = false;
  const pageFind = createPageFindController();

  function isMarkupKind(kind: number): boolean {
    return (
      kind === KIND.SECTION ||
      kind === KIND.WIKI ||
      kind === KIND.SPEC ||
      kind === KIND.LONG_FORM ||
      kind === KIND.DJOT
    );
  }

  const addr = $derived(event ? eventAddress(event) : '');
  const visibleRatings = $derived(filterPageEvents(newestRatingPerAuthor(ratings, addr, $muteState), pageFilter));
  const visibleComments = $derived(filterPageEvents(filterMuted(comments, $muteState), pageFilter));
  const mutedHighlights = $derived(filterMuted(highlights, $muteState));
  const visibleEditions = $derived(filterPageEvents(editions, pageFilter));
  const thread = $derived(nestComments(visibleComments, $muteState, event ? [event.id] : []));
  const readerToc = $derived(enrichToc(toc, sections));
  const tocTree = $derived(buildTocTree(readerToc));
  const activeToc = $derived(
    activeTocEntry(readerToc, {
      pos: readerPos,
      sectionId: readerSectionId,
      corpus: sectionCorpus
    })
  );
  const activeTocKey = $derived(activeToc ? tocEntryKey(activeToc) : '');

  $effect(() => {
    const key = activeTocKey;
    if (!key || !tocTree.length) return;
    const path = tocPathKeys(tocTree, key);
    if (path.length < 2) return;
    // Keep ancestors expanded so the current row stays visible in the outline.
    const ancestors = path.slice(0, -1);
    let changed = false;
    const next = { ...tocExpanded };
    for (const k of ancestors) {
      if (next[k] === true) continue;
      next[k] = true;
      changed = true;
    }
    if (changed) tocExpanded = next;
  });
  const paintedSections = $derived(sections);
  const readerGroups = $derived(
    $verseStyling
      ? groupReaderSections(paintedSections)
      : paintedSections.map((ev) => ({ kind: 'block' as const, event: ev }))
  );
  const moreToPaint = $derived(paintEnd < corpusCount);
  /** Edition shell painted, but no nested sections yet — keep a loading hint under the header. */
  const readingShellOnly = $derived(
    !!event && paintedSections.length > 0 && paintedSections.every((s) => s.id === event!.id)
  );
  const canRead = $derived(!!event && hasPublicationSection(event) && !textUnavailable);
  /** Tracked queue only — untracked editions use Read the publication (local resume still applies inside the reader). */
  const continueTarget = $derived.by(() => {
    if (!event || !canRead) return null;
    const entry = findQueueEntry($viewerReadingEntries, eventAddress(event));
    if (!entry) return null;
    if (isIndexScopedEdition(event)) {
      const scopedToc = toc.length ? toc : buildIndexScopedToc(event);
      const open = pickScopedOpenIndex(event, scopedToc, {
        pos: entry.pos,
        sectionId: entry.sectionId,
        queueTotal: entry.total
      });
      if (!open) return null;
      const prog = scopedProgressForIndex(event, scopedToc, open);
      if (!prog) return null;
      return { pos: prog.pos, sectionId: prog.sectionId, tracked: true as const };
    }
    return {
      pos: entry.pos,
      sectionId: entry.sectionId,
      tracked: true as const
    };
  });
  const canContinue = $derived(!!continueTarget);
  const urlFocusQuote = $derived((new URLSearchParams($querystring ?? '').get('quote') ?? '').trim());
  const urlFocusComment = $derived(
    (new URLSearchParams($querystring ?? '').get('comment') ?? '').trim().toLowerCase()
  );

  function cancelTree(): void {
    treeAbort?.abort();
    treeAbort = null;
    clearAdoptFlush();
  }

  function cancelPrefetch(): void {
    prefetchAbort?.abort();
    prefetchAbort = null;
  }

  let adoptFlushTimer = 0;
  let adoptPending: Event[] = [];
  let adoptEdition: Event | null = null;

  function clearAdoptFlush(): void {
    if (adoptFlushTimer) {
      clearTimeout(adoptFlushTimer);
      adoptFlushTimer = 0;
    }
    adoptPending = [];
    adoptEdition = null;
  }

  function refreshTocFromCorpus(): void {
    if (event && isIndexScopedEdition(event)) {
      toc = buildIndexScopedToc(event);
      return;
    }
    if (!toc.length || !sectionCorpus.length) return;
    // Indexes only — never walk tens of thousands of verse leaves into the ToC.
    const indexes: Event[] = [];
    for (const e of sectionCorpus) {
      if (e.kind === KIND.PUBLICATION) indexes.push(e);
    }
    if (!indexes.length) return;
    toc = expandTocFromSections(toc, indexes);
  }

  function publishPainted(edition: Event, reorder: boolean, fillGaps = false): void {
    if (fillGaps && toc.length) {
      sectionCorpus = ensureMissingSectionPlaceholders(sectionCorpus, toc);
    }
    if (reorder && sectionCorpus.length > 1) {
      // Cap DFS work: only walk far enough for the painted window.
      sectionCorpus = orderPublicationSections(sectionCorpus, {
        root: edition,
        toc,
        limit: Math.max(paintEnd + 40, paintOrigin + 160, 160)
      });
    }
    corpusCount = sectionCorpus.length;
    // Full-corpus indices for reading progress — not the painted-window length.
    const posMap = new Map<string, number>();
    for (let i = 0; i < sectionCorpus.length; i++) {
      posMap.set(sectionCorpus[i]!.id, i);
    }
    sectionReadPos = posMap;
    // Pin only expands the window so resume stays visible — never shrinks a grown range.
    if (paintPinId) {
      const pinned = sectionCorpus.findIndex((s) => s.id === paintPinId);
      if (pinned >= 0) {
        paintOrigin = Math.min(paintOrigin, Math.max(0, pinned - 6));
        paintEnd = Math.max(paintEnd, Math.min(sectionCorpus.length, pinned + 28));
      }
    }
    // Resume pos can be far ahead of a still-streaming corpus — never slice to empty.
    if (sectionCorpus.length) {
      if (paintOrigin >= sectionCorpus.length) {
        paintOrigin = Math.max(0, sectionCorpus.length - Math.min(PAINT_STEP, sectionCorpus.length));
      }
      if (paintEnd <= paintOrigin) {
        paintEnd = Math.min(sectionCorpus.length, paintOrigin + Math.min(35, sectionCorpus.length));
      }
      paintEnd = Math.min(sectionCorpus.length, Math.max(paintEnd, paintOrigin + 1));
    }
    const start = Math.max(0, Math.min(paintOrigin, sectionCorpus.length));
    const end = Math.max(start, Math.min(paintEnd, sectionCorpus.length));
    paintOrigin = start;
    paintEnd = end;
    sections = sectionCorpus.slice(start, end);
  }

  /** Coalesce stream pages; keep corpus off the reactive path until a cheap paint publish. */
  function scheduleAdopt(batch: Event[], edition: Event, immediate = false): void {
    if (batch.length) {
      adoptPending = mergePublicationSections(adoptPending, batch);
    }
    adoptEdition = edition;
    const flush = (reorder: boolean, isImmediate = false) => {
      adoptFlushTimer = 0;
      const pending = adoptPending;
      const ed = adoptEdition ?? edition;
      adoptPending = [];
      if (pending.length) {
        sectionCorpus = mergePublicationSections(sectionCorpus, pending);
      }
      if (!toc.length) toc = parseToc(null, ed);
      // Always deepen the ToC from loaded 30040 indexes (OT → book → chapter).
      refreshTocFromCorpus();
      // Reorder only while the corpus is modest — large Bibles keep stream order until scroll/jump.
      const doReorder = reorder && sectionCorpus.length <= (isImmediate ? 2000 : 900);
      publishPainted(ed, doReorder, isImmediate);
    };
    if (immediate) {
      if (adoptFlushTimer) clearTimeout(adoptFlushTimer);
      adoptFlushTimer = 0;
      flush(true, true);
      return;
    }
    if (adoptFlushTimer) return;
    adoptFlushTimer = window.setTimeout(() => flush(false, false), 600);
  }

  const PAINT_STEP = 40;

  /**
   * First resume jump: mount a window around `index`.
   * Later calls only expand so progressive fill / Show more are never rewound.
   * `index` is clamped to the corpus we have so a high resume pos cannot wipe the pane.
   */
  function focusPaintWindow(index: number, mode: 'jump' | 'expand' = 'expand'): void {
    if (index < 0 || !sectionCorpus.length) return;
    const clamped = Math.min(Math.max(0, Math.floor(index)), sectionCorpus.length - 1);
    const before = 6;
    const after = 28;
    const wantOrigin = Math.max(0, clamped - before);
    const wantEnd = Math.min(sectionCorpus.length, Math.max(wantOrigin + 1, clamped + after));
    if (mode === 'jump') {
      paintOrigin = wantOrigin;
      paintEnd = wantEnd;
    } else {
      paintOrigin = Math.min(paintOrigin, wantOrigin);
      paintEnd = Math.max(paintEnd, wantEnd);
    }
    if (event) publishPainted(event, false);
  }

  function extendPaint(): void {
    if (paintEnd >= sectionCorpus.length) return;
    paintEnd = Math.min(sectionCorpus.length, paintEnd + PAINT_STEP);
    if (event) publishPainted(event, true);
  }

  /** Prepend earlier sections when the reader scrolls near the top of the window. */
  function extendPaintBackward(): void {
    if (paintOrigin <= 0 || !event) return;
    const before = document.documentElement.scrollHeight;
    paintOrigin = Math.max(0, paintOrigin - PAINT_STEP);
    publishPainted(event, false);
    requestAnimationFrame(() => {
      const delta = document.documentElement.scrollHeight - before;
      if (delta > 0) window.scrollBy(0, delta);
    });
  }

  function indexInCorpus(sectionId?: string, address?: string, pos = NaN): number {
    if (sectionId) {
      const idx = sectionCorpus.findIndex((s) => s.id === sectionId);
      if (idx >= 0) return idx;
    }
    if (address) {
      const idx = sectionCorpus.findIndex((s) => eventAddress(s) === address);
      if (idx >= 0) return idx;
    }
    if (Number.isFinite(pos) && sectionCorpus.length) {
      return Math.min(sectionCorpus.length - 1, Math.max(0, Math.floor(pos)));
    }
    return -1;
  }

  function paintThrough(index: number, reorder: boolean): void {
    if (index < 0) return;
    // Include index by expanding (or an initial jump if the window is still the default shell).
    if (index < paintOrigin || index >= paintEnd) {
      const stillShell = paintOrigin === 0 && paintEnd <= 35 && index > paintEnd;
      focusPaintWindow(index, stillShell ? 'jump' : 'expand');
      return;
    }
    const need = Math.min(sectionCorpus.length, index + PAINT_STEP);
    if (need <= paintEnd) return;
    paintEnd = need;
    if (event) publishPainted(event, reorder);
  }

  /**
   * Extend the painted window so `index` is mounted.
   * Reordering inside publishPainted can move `sectionId` past that window;
   * a second pass paints its new corpus index without reordering again.
   */
  function ensurePaintedThrough(index: number, sectionId?: string): void {
    if (index < 0 && !sectionId) return;
    if (index >= 0) paintThrough(index, true);
    if (!sectionId) return;
    const moved = sectionCorpus.findIndex((s) => s.id === sectionId);
    if (moved >= 0 && (moved < paintOrigin || moved >= paintEnd)) paintThrough(moved, false);
  }

  async function fetchSocial(target: Event): Promise<void> {
    const a = eventAddress(target);
    const ratingKeys = publicationRatingATagsForQuery(target);
    const sectionAddrs = target.tags
      .filter((t) => t[0] === 'a' && t[1])
      .flatMap((t) => publicationCoordinateLookupKeys(t[1]!));
    const highlightAddrs = [...new Set([a, ...sectionAddrs, ...publicationCoordinateLookupKeys(a)])];
    const bookKeys = [...new Set(publicationCoordinateLookupKeys(a))];
    const [
      rA,
      rA2,
      threadEvents,
      highlightByBook,
      labelHits,
      bookmarkHits,
      directoryHits,
      readHits,
      readingQueueHits,
      ...highlightBatches
    ] = await Promise.all([
      relayPool.query(socialStack(), [{ kinds: [KIND.RATING], '#a': ratingKeys, limit: 50 }], 5000, 4),
      relayPool.query(socialStack(), [{ kinds: [KIND.RATING], '#A': ratingKeys, limit: 50 }], 5000, 4),
      fetchThreadEvents(target, 80),
      relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#A': bookKeys, limit: 80 }], 5000, 4),
      relayPool.query(socialStack(), [{ kinds: [KIND.LABEL], '#a': bookKeys, limit: 80 }], 5000, 4),
      relayPool.query(socialStack(), [{ kinds: [KIND.BOOKMARK], '#a': bookKeys, limit: 40 }], 5000, 4),
      relayPool.query(documentStack(), [{ kinds: [KIND.DIRECTORY], '#a': bookKeys, limit: 40 }], 5000, 4),
      relayPool.query(
        socialStack(),
        [{ kinds: [KIND.LABEL], '#a': bookKeys, '#l': [NIP32_READ_LABEL], limit: 80 }],
        5000,
        4
      ),
      relayPool.query(
        socialStack(),
        [{ kinds: [KIND.READING_QUEUE], '#a': bookKeys, limit: 40 }],
        5000,
        4
      ),
      ...chunk(highlightAddrs, 20).map((batch) =>
        relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#a': batch, limit: 80 }], 5000, 4)
      )
    ]);
    const ratingById = new Map<string, Event>();
    for (const e of [...rA, ...rA2]) ratingById.set(e.id, e);
    ratings = [...ratingById.values()];
    comments = threadEvents;
    const hById = new Map<string, Event>();
    for (const e of highlightByBook) hById.set(e.id, e);
    for (const batch of highlightBatches) {
      for (const e of batch) hById.set(e.id, e);
    }
    highlights = [...hById.values()];
    editionLabels = labelHits;
    editionBookmarks = bookmarkHits;
    editionDirectories = directoryHits;
    editionReadingQueues = readingQueueHits;
    const readById = new Map<string, Event>();
    for (const e of [...readHits, ...labelHits]) {
      if (e.tags.some((t) => t[0] === 'l' && t[1]?.toLowerCase() === NIP32_READ_LABEL)) {
        readById.set(e.id, e);
      }
    }
    const readCandidates = [...readById.values()];
    try {
      await refreshDeletionsFor(readCandidates);
    } catch {
      /* deletions optional */
    }
    editionReads = filterDeletedEvents(readCandidates);
  }

  function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out.length ? out : [[]];
  }

  async function prefetchTree(target: Event, signal: AbortSignal): Promise<void> {
    try {
      const naddr = naddrFor(target);
      const meta = await mercuryPublicationMeta(naddr, signal);
      if (signal.aborted) return;
      if (isUnreadableMeta(meta) && !hasPublicationSection(target)) {
        textUnavailable = true;
        return;
      }
      // Info-page prefetch: Mercury tree only. Never walk a-tags here — that is for Read
      // (features/reader/read.feature: walk nested indexes when the button is pressed).
      const rawToc = await mercuryPublicationToc(naddr, signal);
      if (signal.aborted) return;
      if (!rawToc) return;
      toc = parseToc(rawToc, target);
      // Do not pull the full /stream on the info page — Bible-sized pubs freeze the tab.
    } catch {
      if (signal.aborted) return;
    }
  }

  /** After header is on screen, warm social + Mercury ToC in parallel (do not block Read). */
  async function afterSocialPrefetchTree(target: Event): Promise<void> {
    cancelPrefetch();
    prefetchAbort = new AbortController();
    const signal = prefetchAbort.signal;
    // Social is best-effort and slow when relays are down — never gate the tree on it.
    void fetchSocial(target).catch(() => {});
    if (signal.aborted || event?.id !== target.id) return;
    // Catalog stubs: ratings/comments only — never hit /meta|/toc|/stream.
    if (textUnavailable || !hasPublicationSection(target)) return;
    void prefetchTree(target, signal);
  }

  /** Prefer a cached stream snapshot, then local seeds, then Mercury /stream, then a-tag walk. */
  async function loadSectionEvents(
    edition: Event,
    signal?: AbortSignal,
    onBatch?: (batch: Event[]) => void
  ): Promise<Event[]> {
    // Scoped editions use fillScopedReading — never paint the whole Bible here.
    if (isIndexScopedEdition(edition)) {
      const seeded = await loadSeedsForEdition(edition, {
        signal,
        onBatch: (batch) => {
          if (batch.some((e) => e.kind === KIND.PUBLICATION)) onBatch?.(batch.filter((e) => e.kind === KIND.PUBLICATION));
        }
      });
      return seeded ?? [];
    }
    const editionAddr = eventAddress(edition);
    const naddr = naddrFor(edition);

    // Instant reopen: we already streamed this book into Cache Storage earlier.
    try {
      const snap = await cacheGetPublicationStreamSnapshot(editionAddr);
      if (signal?.aborted) return [];
      const cached = snap.events;
      const hasLeaves = cached.some((e) => e.kind !== KIND.PUBLICATION);
      if (hasLeaves) {
        rememberEvents(cached);
        onBatch?.(cached);
        // Full snapshot with real leaves → paint from cache.
        if (snap.complete) return cached;
        if (!isMercuryUnavailable() && !isMercuryPublicationMissing(naddr)) {
          try {
            const fresh = await mercuryPublicationStream(
              naddr,
              undefined,
              signal,
              (page) => {
                if (signal?.aborted) return;
                onBatch?.(page);
              },
              { maxEvents: 50_000 }
            );
            if (signal?.aborted) return mergePublicationSections(cached, fresh);
            if (fresh.length) {
              void cachePutPublicationStream(editionAddr, fresh, { complete: true });
              return mergePublicationSections(cached, fresh);
            }
          } catch {
            /* keep cached paint */
          }
        }
        return cached;
      }
      // Indexes-only or empty snapshot: discard sticky complete and re-walk.
      if (cached.length) {
        rememberEvents(cached);
        onBatch?.(cached);
        void cacheClearPublicationStream(editionAddr);
      }
    } catch {
      /* ignore cache errors — fall through to live load */
    }

    // Douay / reading-plan seeds: scoped JSONL before Mercury (on-demand only).
    try {
      const seeded = await loadSeedsForEdition(edition, { signal, onBatch });
      if (signal?.aborted) return seeded ?? [];
      if (seeded && seeded.some((e) => e.kind !== KIND.PUBLICATION)) {
        return seeded;
      }
      // Plan indexes + verses: seeded may be all PUBLICATION plan nodes plus verse leaves.
      if (seeded && seeded.length) return seeded;
    } catch {
      /* seed miss — fall through */
    }

    // Citadel-only trees 404 on Mercury — probe /meta first so we walk relays
    // immediately instead of waiting on /stream body timeouts.
    let streamed: Event[] = [];
    let mercuryHosted = !isMercuryUnavailable() && !isMercuryPublicationMissing(naddr);
    if (mercuryHosted) {
      try {
        const meta = await mercuryPublicationMeta(naddr, signal);
        if (signal?.aborted) return [];
        mercuryHosted = meta != null && !isMercuryPublicationMissing(naddr);
      } catch {
        mercuryHosted = false;
      }
    }
    if (mercuryHosted) {
      try {
        streamed = await mercuryPublicationStream(
          naddr,
          undefined,
          signal,
          (page) => {
            onBatch?.(page);
          },
          // Soft cap so a broken stream cannot grow without bound; Bible is ~30k.
          { maxEvents: 50_000 }
        );
      } catch {
        streamed = [];
      }
    }
    if (signal?.aborted) return streamed;
    if (streamed.some((e) => e.kind !== KIND.PUBLICATION)) {
      // Only mark complete when the stream finished without abort (partial = keep warming).
      void cachePutPublicationStream(editionAddr, streamed, { complete: true });
      return streamed;
    }
    // Structure-only Mercury (e.g. Intro/OT/NT), empty stream, or citadel-only: walk a-tags.
    const walked = await fallbackSections(edition, {
      signal,
      relaysOnly: !mercuryHosted || isMercuryPublicationMissing(naddr),
      onHit: (hit) => onBatch?.([hit])
    });
    if (signal?.aborted) return streamed;
    const merged = mergePublicationSections(streamed, walked);
    if (merged.some((e) => e.kind !== KIND.PUBLICATION)) {
      void cachePutPublicationStream(editionAddr, merged, { complete: true });
    }
    return merged;
  }

  /** Document-stack / memory walk only (features/reader/read.feature fallback). */
  async function fallbackSections(
    target: Event,
    opts?: { onHit?: (event: Event) => void; signal?: AbortSignal; relaysOnly?: boolean }
  ): Promise<Event[]> {
    const onHit = opts?.onHit;
    const signal = opts?.signal;
    const relaysOnly = opts?.relaysOnly === true;
    const out: Event[] = [];
    const seen = new Set<string>();
    const WALK_CONCURRENCY = 6;
    const MAX_EVENTS = 2_500;
    const fetchOpts = relaysOnly ? { relaysOnly: true as const } : undefined;

    function claim(hit: Event): boolean {
      if (seen.has(hit.id)) return false;
      seen.add(hit.id);
      if (hit.id === target.id) return true;
      out.push(hit);
      onHit?.(hit);
      return true;
    }

    async function pushCoord(coord: string): Promise<void> {
      if (signal?.aborted || out.length >= MAX_EVENTS) return;
      const parts = coord.split(':');
      const kind = Number(parts[0]);
      const pubkey = parts[1];
      const d = parts.slice(2).join(':');
      if (!kind || !pubkey || !d) return;
      // Always go through fetchByAddress: memory/cache may hold thin catalog 30040s
      // (no a/e). Short-circuiting on those freezes nested Surahs/Preamble as empty headings.
      const hit = await fetchByAddress(coord, fetchOpts);
      if (!hit || !claim(hit)) return;
      if (hit.kind === KIND.PUBLICATION) await expandChildren(hit);
    }

    async function pushId(id: string): Promise<void> {
      if (signal?.aborted || out.length >= MAX_EVENTS) return;
      const key = id.toLowerCase();
      if (seen.has(key)) return;
      let hit = memoryGetEvent(key) ?? (await fetchById(key));
      if (!hit || !claim(hit)) return;
      if (hit.kind === KIND.PUBLICATION) await expandChildren(hit);
    }

    async function expandChildren(ev: Event): Promise<void> {
      if (signal?.aborted || out.length >= MAX_EVENTS) return;
      const coords: string[] = [];
      const ids: string[] = [];
      for (const tag of ev.tags) {
        const name = tag[0];
        if ((name === 'a' || name === 'A') && tag[1]) coords.push(tag[1]);
        else if ((name === 'e' || name === 'E') && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1]))
          ids.push(tag[1]);
      }
      // Batch-resolve direct children first (one wave) so Koran-sized roots paint ASAP.
      if (coords.length) await poolMap(coords.slice(0, 400), WALK_CONCURRENCY, pushCoord);
      if (ids.length) await poolMap(ids.slice(0, 400), WALK_CONCURRENCY, pushId);
    }

    // Catalog/search may have painted a thin root (ToC from Mercury, no a/e). Refresh
    // before walking or nested Surahs/Preamble never expand.
    let root = target;
    if (publicationSectionCount(target) === 0) {
      const refreshed = await fetchByAddress(eventAddress(target), fetchOpts);
      if (refreshed && publicationSectionCount(refreshed) > 0) {
        root = refreshed;
        rememberEvents([refreshed]);
        onHit?.(refreshed);
      }
    }

    // Root edition is the reading-pane top heading; walk its children (not the root itself).
    seen.add(root.id);
    if (root.id !== target.id) seen.add(target.id);
    await expandChildren(root);
    return out;
  }

  function focusFromUrl(): {
    section: string;
    quote: string;
    comment: string;
    rating: string;
    read: boolean;
    pos: number;
  } {
    const q = new URLSearchParams($querystring ?? '');
    const posRaw = Number(q.get('pos'));
    return {
      section: (q.get('section') ?? '').trim(),
      quote: (q.get('quote') ?? '').trim(),
      comment: (q.get('comment') ?? '').trim().toLowerCase(),
      rating: (q.get('rating') ?? '').trim().toLowerCase(),
      read: q.get('read') === '1',
      pos: Number.isFinite(posRaw) && posRaw >= 0 ? Math.floor(posRaw) : NaN
    };
  }

  function hashPathOnly(): string {
    return window.location.hash.replace(/^#/, '').split('?')[0] || (event ? publicationPath(event) : '');
  }

  /** Sync ?read=1. Turning off also clears section/pos/quote so applyUrlFocus cannot reopen the reader. */
  function setReadQuery(on: boolean): void {
    const q = new URLSearchParams($querystring ?? '');
    if (on) {
      if (q.get('read') === '1') return;
      q.set('read', '1');
    } else {
      const had =
        q.get('read') === '1' || q.has('section') || q.has('pos') || q.has('quote');
      if (!had) return;
      q.delete('read');
      q.delete('section');
      q.delete('pos');
      q.delete('quote');
    }
    const qs = q.toString();
    const path = hashPathOnly();
    replace(qs ? `${path}?${qs}` : path);
  }

  function scrollToHighlightQuote(quote: string, attempts = 40): void {
    const needle = quote.replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();
    if (!needle) return;
    const marks = [...document.querySelectorAll<HTMLElement>('mark.text-highlight')];
    let hit =
      marks.find((m) => (m.textContent ?? '').replace(/\s+/g, ' ').toLowerCase().includes(needle)) ??
      null;
    if (!hit) {
      const nodes = [
        ...document.querySelectorAll<HTMLElement>(
          '.reader-section mark.text-highlight, .reader-section p, .reader-section li, .reader-section blockquote, .reader-section .event-body'
        )
      ];
      hit =
        nodes.find((n) => (n.textContent ?? '').replace(/\s+/g, ' ').toLowerCase().includes(needle)) ??
        null;
    }
    if (hit) {
      hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
      hit.classList.add('highlight-flash');
      window.setTimeout(() => hit?.classList.remove('highlight-flash'), 1600);
      return;
    }
    if (attempts <= 0) return;
    setTimeout(() => scrollToHighlightQuote(quote, attempts - 1), 120);
  }

  function mergeSections(...lists: Event[][]): Event[] {
    return mergePublicationSections(...lists);
  }

  function orderSectionsByToc(list: Event[], entries: TocEntry[], root?: Event | null): Event[] {
    return orderPublicationSections(list, {
      root: root ?? event,
      toc: entries,
      limit: Math.max(paintEnd + 40, paintOrigin + 160, 160)
    });
  }

  function freezeTocFromSections(list: Event[]): void {
    if (toc.length || !list.length) return;
    toc = enrichToc([], list);
  }

  async function ensureToc(edition: Event): Promise<void> {
    if (toc.length) return;
    if (isIndexScopedEdition(edition)) {
      toc = buildIndexScopedToc(edition);
      return;
    }
    try {
      const rawToc = await mercuryPublicationToc(naddrFor(edition));
      toc = parseToc(rawToc, edition);
    } catch {
      toc = parseToc(null, edition);
    }
  }

  /** Prefer a real ToC (Mercury / partition) before inventing one from loaded leaves. */
  function adoptSections(
    list: Event[],
    edition: Event,
    opts?: { expandToc?: boolean }
  ): void {
    if (!toc.length) toc = parseToc(null, edition);
    sectionCorpus = mergePublicationSections(ensureIndexHeadings(list, toc), sectionCorpus);
    if (opts?.expandToc !== false) toc = expandTocFromSections(toc, sectionCorpus);
    if (paintEnd < 35 && sectionCorpus.length) {
      paintEnd = Math.min(35, sectionCorpus.length);
    }
    publishPainted(edition, true);
    freezeTocFromSections(sectionCorpus);
  }

  async function ensureReadingSections(): Promise<boolean> {
    if (!event || unreadable || !canRead) return false;
    reading = true;
    if (sections.length) return true;
    return fillReadingSections(event);
  }

  /** Prefer a real in-memory index over a ToC placeholder with the same address. */
  function liveScopedIndex(index: Event): Event {
    if (!isPlaceholderIndex(index)) {
      const addr = eventAddress(index);
      const parsed = parseAddress(addr);
      if (!parsed) return index;
      return memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d) ?? index;
    }
    const addr = eventAddress(index);
    const parsed = parseAddress(addr);
    if (!parsed) return index;
    return memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d) ?? index;
  }

  /** Replace the pane with one plan day or Douay chapter (and its verses only). */
  async function paintScopedIndex(
    edition: Event,
    index: Event,
    opts?: { network?: boolean }
  ): Promise<void> {
    const gen = ++scopedPaintGen;
    scopedAtEditionTop = false;
    let leaf = liveScopedIndex(index);
    // Incomplete plan seeds leave early days as placeholders — resolve via relays.
    if (isPlaceholderIndex(leaf) && opts?.network === true) {
      const addr = eventAddress(leaf);
      if (addr) {
        const hit = await fetchByAddress(addr);
        if (hit) {
          rememberEvents([hit]);
          leaf = hit;
        }
      }
    }
    const missing = missingPaintAddresses(leaf);
    if (missing.length) {
      // Seeded bibles: never stampede relays for verses — shards fill memory.
      // Reading plans: allow network for seed holes (e.g. days 1–90 missing locally).
      const localOnly = opts?.network !== true;
      await poolMap(missing.slice(0, 120), localOnly ? 8 : 3, (coord) =>
        fetchByAddress(coord, localOnly ? { localOnly: true } : undefined)
      );
    }
    if (event?.id !== edition.id || scopedAtEditionTop || gen !== scopedPaintGen) return;
    leaf = liveScopedIndex(leaf);
    const painted = collectIndexPaintEvents(leaf);
    if (!painted.length) return;
    clearAdoptFlush();
    sectionCorpus = painted;
    corpusCount = painted.length;
    paintOrigin = 0;
    paintEnd = painted.length;
    sections = painted;
    scopedPaintIndex = leaf;
    paintPinId = leaf.id;
    const prog = scopedProgressForIndex(edition, toc, leaf);
    if (prog) {
      readerPos = prog.pos;
      readerSectionId = prog.sectionId;
      saveResume(eventAddress(edition), { pos: prog.pos, sectionId: prog.sectionId });
      void syncReadingProgress({
        publication: edition,
        pos: prog.pos,
        total: prog.total,
        sectionId: prog.sectionId
      });
    }
    void enrichHighlightsFromSections(painted);
    sectionsLoading = false;
    // Day indexes often arrive during paint (seed holes) — refresh ToC titles without a click.
    if (isReadingPlanEdition(edition) && !isPlaceholderIndex(leaf)) {
      toc = buildIndexScopedToc(edition);
    }
  }

  /** Edition root in the pane — cover, authors, summary (Go to top / root ToC). */
  function paintScopedEditionTop(edition: Event): void {
    scopedAtEditionTop = true;
    scopedPaintGen += 1;
    clearAdoptFlush();
    sectionCorpus = [edition];
    corpusCount = 1;
    paintOrigin = 0;
    paintEnd = 1;
    sections = [edition];
    scopedPaintIndex = null;
    paintPinId = edition.id;
    readerPos = 0;
    readerSectionId = edition.id;
    const leaves = listLeafIndexes(edition, toc);
    saveResume(eventAddress(edition), { pos: 0, sectionId: edition.id });
    if (leaves.length) {
      void syncReadingProgress({
        publication: edition,
        pos: 0,
        total: leaves.length,
        sectionId: edition.id
      });
    }
    sectionsLoading = false;
  }

  /**
   * Bible-typed / large / reading-plan editions: keep indexes in memory, paint one leaf.
   * Never adopt the whole tree into the reading pane.
   * Stays on the edition cover until the user picks a ToC entry (or Continue / deep link).
   */
  async function fillScopedReading(edition: Event): Promise<boolean> {
    readingBusy = true;
    sectionsLoading = true;
    scopedPaintIndex = null;
    scopedAtEditionTop = true;
    scopedPaintGen += 1;
    cancelTree();
    treeAbort = new AbortController();
    const signal = treeAbort.signal;
    try {
      toc = buildIndexScopedToc(edition);
      paintScopedEditionTop(edition);
      readingBusy = false;

      const refreshToc = (): void => {
        toc = buildIndexScopedToc(edition);
      };

      try {
        const snap = await cacheGetPublicationStreamSnapshot(eventAddress(edition));
        if (!signal.aborted && snap.events.length) {
          rememberEvents(snap.events);
          refreshToc();
        }
      } catch {
        /* ignore */
      }

      const afterTreeReady = async (allowNetwork: boolean): Promise<void> => {
        if (signal.aborted || event?.id !== edition.id || !reading) return;
        refreshToc();
        // Cover stays until ToC / Continue selects a leaf — only refresh an already-open day.
        if (scopedPaintIndex && !scopedAtEditionTop) {
          await paintScopedIndex(edition, scopedPaintIndex, { network: allowNetwork });
        }
        if (event?.id === edition.id) sectionsLoading = false;
        if (
          event?.id === edition.id &&
          reading &&
          scopedPaintIndex &&
          !scopedAtEditionTop &&
          !sections.some((s) => s.kind === KIND.SECTION) &&
          !listLeafIndexes(edition, toc).length
        ) {
          unreadable = true;
          reading = false;
          setReadQuery(false);
        }
      };

      void (async () => {
        const seeded = await loadSeedsForEdition(edition, {
          signal,
          onBatch: (batch) => {
            if (signal.aborted || event?.id !== edition.id || !reading) return;
            if (batch.some((e) => e.kind === KIND.PUBLICATION)) refreshToc();
            // Verses arrive from Douay deps after the plan indexes — repaint the open day.
            if (scopedPaintIndex && !scopedAtEditionTop && batch.some((e) => e.kind === KIND.SECTION)) {
              void paintScopedIndex(edition, liveScopedIndex(scopedPaintIndex), {
                network: isReadingPlanEdition(edition)
              });
            }
          }
        });
        if (signal.aborted || event?.id !== edition.id) return;
        // Seeded editions / reading plans: never fan out hundreds of relay index
        // fetches (that only loads day headings — verses stay blank).
        const hasSeeds = await editionHasLocalSeeds(edition);
        if (!seeded?.length && !hasSeeds && !isReadingPlanEdition(edition)) {
          await warmIndexTree(edition, (coord) => fetchByAddress(coord), {
            signal,
            onIndex: refreshToc
          });
        } else if (!seeded?.length && (hasSeeds || isReadingPlanEdition(edition))) {
          console.info('[alexandria:seeds] skipping relay index-warm; retrying local seeds', {
            title: firstTag(edition, 'title') ?? firstTag(edition, 'd'),
            hasSeeds,
            plan: isReadingPlanEdition(edition)
          });
          const retry = await loadSeedsForEdition(edition, {
            signal,
            onBatch: (batch) => {
              if (signal.aborted || event?.id !== edition.id || !reading) return;
              if (batch.some((e) => e.kind === KIND.PUBLICATION)) refreshToc();
              if (scopedPaintIndex && !scopedAtEditionTop && batch.some((e) => e.kind === KIND.SECTION)) {
                void paintScopedIndex(edition, liveScopedIndex(scopedPaintIndex), {
                  network: isReadingPlanEdition(edition)
                });
              }
            }
          });
          if (retry?.length) {
            refreshToc();
          }
        }
        // Plans may still need relays for seed holes (bible-in-a-year lacks days 1–90).
        await afterTreeReady(!hasSeeds || isReadingPlanEdition(edition));
        // Fill missing day titles in the background so ToC isn't stuck on "Day 004" stubs.
        if (!signal.aborted && isReadingPlanEdition(edition)) {
          const holes = missingPlanDayAddresses(edition);
          if (holes.length) {
            let filled = 0;
            await poolMap(holes, 3, async (coord) => {
              if (signal.aborted || event?.id !== edition.id) return;
              await fetchByAddress(coord);
              filled += 1;
              if (filled % 12 === 0) refreshToc();
            });
            if (!signal.aborted && event?.id === edition.id) refreshToc();
          }
        }
      })().catch(() => {
        if (event?.id === edition.id) sectionsLoading = false;
      });

      return true;
    } catch {
      if (event?.id === edition.id) sectionsLoading = false;
      return false;
    } finally {
      if (event?.id === edition.id) readingBusy = false;
    }
  }

  /** Load ToC + first heading immediately, then stream/walk sections into the pane. */
  async function fillReadingSections(edition: Event): Promise<boolean> {
    if (isIndexScopedEdition(edition)) return fillScopedReading(edition);
    readingBusy = true;
    sectionsLoading = true;
    scopedPaintIndex = null;
    cancelTree();
    treeAbort = new AbortController();
    const signal = treeAbort.signal;
    try {
      await ensureToc(edition);
      if (event?.id !== edition.id) return false;
      // Always paint the edition shell even if a concurrent abort fired during ensureToc —
      // otherwise read=1 can stick on "Publication is loading..." with an empty pane.
      adoptSections([edition], edition);
      readingBusy = false;

      if (signal.aborted) {
        // Route-effect re-entry aborted the first controller; start a fresh stream.
        treeAbort = new AbortController();
      }
      const streamSignal = treeAbort?.signal;
      if (!streamSignal) {
        sectionsLoading = false;
        return true;
      }

      // Do not await the full Mercury/relay pull — large pubs can stream for a long time.
      void loadSectionEvents(edition, streamSignal, (batch) => {
        if (streamSignal.aborted || event?.id !== edition.id || !reading) return;
        scheduleAdopt(batch, edition);
      }).then(() => {
        if (event?.id === edition.id) sectionsLoading = false;
        if (streamSignal.aborted || event?.id !== edition.id || !reading) return;
        scheduleAdopt([], edition, true);
        if (!sectionCorpus.length) {
          unreadable = true;
          reading = false;
          setReadQuery(false);
        }
      }).catch(() => {
        if (event?.id === edition.id) sectionsLoading = false;
      });
      return true;
    } catch {
      if (event?.id === edition.id) sectionsLoading = false;
      return false;
    } finally {
      if (event?.id === edition.id) readingBusy = false;
    }
  }

  let focusKey = '';


  /** Open reader for a quote with no section (edition-level highlight). */
  async function openQuoteReading(quote: string): Promise<void> {
    const key = `\0${quote}`;
    focusKey = key;
    const ok = await ensureReadingSections();
    if (!ok || focusKey !== key) return;
    queueMicrotask(() => {
      if (focusKey === key && quote) scrollToHighlightQuote(quote);
    });
  }

  async function openFocusedReading(sectionAddr: string, quote: string, resumePos?: number): Promise<void> {
    if (!event || unreadable || !canRead) return;
    const key = `${sectionAddr}\0${quote}`;
    focusKey = key;
    reading = true;
    readingBusy = true;
    sectionsLoading = true;
    const focusAddr = sectionAddr;
    const focusQuote = quote;
    const edition = event;
    if (isIndexScopedEdition(edition)) {
      try {
        setReadQuery(true);
        await fillScopedReading(edition);
        if (focusKey !== key || event !== edition) return;
        let focused: Event | null = null;
        if (/^[0-9a-f]{64}$/i.test(focusAddr)) {
          focused = memoryGetEvent(focusAddr) ?? (await fetchById(focusAddr));
        } else {
          const parsed = parseAddress(focusAddr);
          if (parsed) {
            focused =
              memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d) ??
              (await fetchByAddress(focusAddr));
          }
        }
        if (focusKey !== key || event !== edition) return;
        toc = buildIndexScopedToc(edition);
        const leaf = focused
          ? resolvePaintIndex(focused, edition, toc)
          : pickScopedOpenIndex(edition, toc, {
              pos: resumePos,
              sectionId: focusAddr,
              queueTotal: findQueueEntry($viewerReadingEntries, eventAddress(edition))?.total
            });
        if (leaf) await paintScopedIndex(edition, leaf, { network: isReadingPlanEdition(edition) });
        if (focusQuote) scrollToHighlightQuote(focusQuote);
      } finally {
        if (event?.id === edition.id) {
          readingBusy = false;
          sectionsLoading = false;
        }
      }
      return;
    }
    try {
      // Resolve the focused leaf in parallel so a cache hit paints ASAP.
      const focusedPromise = (async (): Promise<Event | null> => {
        if (/^[0-9a-f]{64}$/i.test(focusAddr)) {
          return memoryGetEvent(focusAddr) ?? (await fetchById(focusAddr));
        }
        const parsed = parseAddress(focusAddr);
        if (!parsed) return null;
        return (
          memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d) ??
          (await fetchByAddress(focusAddr))
        );
      })();

      // Shell first — never leave the reader blank while ToC/stream run.
      adoptSections([edition], edition);
      readingBusy = false;

      const focused = await focusedPromise;
      if (focusKey !== key || event !== edition) return;
      const focusedAddr = focused ? eventAddress(focused) : '';
      if (focused) {
        rememberEvents([focused]);
        paintPinId = focused.id;
        adoptSections([focused], edition);
        void enrichHighlightsFromSections([focused]);
        const earlyPos = indexInCorpus(
          focused.id,
          focusedAddr,
          Number.isFinite(resumePos) ? (resumePos as number) : NaN
        );
        if (earlyPos >= 0) focusPaintWindow(earlyPos, 'jump');
        scrollToSectionRetry(
          earlyPos >= 0 ? earlyPos : 0,
          focused.id,
          focusedAddr || undefined
        );
        if (focusQuote) scrollToHighlightQuote(focusQuote);
        // Pin only until the first paint settles — then allow the window to grow freely.
        window.setTimeout(() => {
          if (paintPinId === focused.id) paintPinId = '';
        }, 2500);
      } else if (Number.isFinite(resumePos) && (resumePos as number) >= 0) {
        paintPinId = '';
        focusPaintWindow(resumePos as number, 'jump');
      }

      // ToC after first paint — never blank the pane waiting on Mercury /toc.
      if (!toc.length) {
        try {
          const rawToc = await mercuryPublicationToc(naddrFor(edition));
          if (focusKey !== key || event !== edition) return;
          toc = parseToc(rawToc, edition);
          adoptSections(sectionCorpus, edition);
        } catch {
          if (focusKey !== key || event !== edition) return;
          if (!toc.length) toc = parseToc(null, edition);
        }
      }

      const entry =
        toc.find((t) => t.address === focusAddr) ??
        toc.find((t) => focused && t.id === focused.id) ??
        toc.find((t) => focusedAddr && t.address === focusedAddr);

      // Full progressive fill from the start (not from resume pos) so earlier
      // chapters exist when scrolling up / opening the ToC.
      cancelTree();
      treeAbort = new AbortController();
      const signal = treeAbort.signal;
      void loadSectionEvents(edition, signal, (page) => {
        if (signal.aborted || focusKey !== key || event !== edition) return;
        scheduleAdopt(page, edition);
      }).then(() => {
        if (event?.id === edition.id) sectionsLoading = false;
        if (signal.aborted || focusKey !== key || event !== edition) return;
        scheduleAdopt([], edition, true);
        if (!sectionCorpus.some((e) => e.kind !== KIND.PUBLICATION) && !focused) {
          unreadable = true;
          reading = false;
          return;
        }
        const scrollId =
          focused?.id ??
          sectionCorpus.find((s) => s.id === focusAddr || eventAddress(s) === focusAddr)?.id;
        const pos =
          Number.isFinite(resumePos) && (resumePos as number) >= 0
            ? (resumePos as number)
            : (entry?.pos ?? indexInCorpus(scrollId, focusedAddr || focusAddr));
        if (scrollId) paintPinId = scrollId;
        if (pos >= 0) {
          focusPaintWindow(pos, 'expand');
          ensurePaintedThrough(pos, scrollId);
        }
        scrollToSectionRetry(
          pos >= 0 ? pos : 0,
          scrollId,
          focusedAddr || focusAddr
        );
        if (focusQuote) scrollToHighlightQuote(focusQuote);
        if (scrollId) {
          window.setTimeout(() => {
            if (paintPinId === scrollId) paintPinId = '';
          }, 2500);
        }
      }).catch(() => {
        if (event?.id === edition.id) sectionsLoading = false;
      });
    } finally {
      if (focusKey === key) readingBusy = false;
    }
  }


  function applyUrlFocus(): void {
    if (!event || loading) return;
    const focus = focusFromUrl();
    // Landing comment / rating deep links stay on the info page, not the reader.
    if (focus.comment || focus.rating) {
      if (reading) reading = false;
      return;
    }
    if (focus.section) {
      const key = `${focus.section}\0${focus.quote}`;
      if (key === focusKey && reading) return;
      if (textUnavailable || unreadable || !canRead) return;
      void openFocusedReading(focus.section, focus.quote, focus.pos);
      return;
    }
    if (focus.quote) {
      const key = `\0${focus.quote}`;
      if (key === focusKey && reading) return;
      if (textUnavailable || unreadable || !canRead) return;
      void openQuoteReading(focus.quote);
      return;
    }
    if (focus.read) {
      // Recover if a prior fill was aborted (route effect cleanup) leaving reading stuck empty.
      if (canRead && !unreadable && !textUnavailable) {
        if (!reading || (!sections.length && !readingBusy)) {
          void startReading({ fromUrl: true });
        }
      }
      return;
    }
    // Plain info URL (title links from landing) — metadata view, forced to top.
    if (reading) reading = false;
    focusKey = '';
    commentFocusApplied = '';
    queueMicrotask(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }

  let commentFocusApplied = $state('');

  $effect(() => {
    if (!event || loading || reading) return;
    void $querystring;
    void comments;
    const id = focusFromUrl().comment;
    if (!id || id === commentFocusApplied) return;
    let attempts = 20;
    let timer = 0;
    const tryScroll = () => {
      if (reading) return;
      const el = document.getElementById(`comment-${id}`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        commentFocusApplied = id;
        return;
      }
      if (attempts-- <= 0) return;
      timer = window.setTimeout(tryScroll, 100);
    };
    const tick = requestAnimationFrame(tryScroll);
    return () => {
      cancelAnimationFrame(tick);
      clearTimeout(timer);
    };
  });

  function decodeParam(raw: string): string {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  function paintEdition(target: Event): void {
    rememberEvents([target]);
    event = target;
    superindexes = [];
    error = false;
    unreadable = false;
    textUnavailable = !hasPublicationSection(target);
    loading = false;
    // Do not cancelTree here — Read may already be streaming for ?read=1.
    cancelPrefetch();
    // Catalog stubs (no section a/e tags) are library cards only — no tree to fetch.
    // Readable editions: social first, then Mercury tree in the background (no a-tag walk).
    void afterSocialPrefetchTree(target);
  }

  $effect(() => {
    const edition = event;
    if (!edition || edition.kind !== KIND.PUBLICATION) {
      superindexes = [];
      return;
    }
    const addr = eventAddress(edition);
    let cancelled = false;
    void fetchSuperindexes(addr).then((parents) => {
      if (cancelled || event?.id !== edition.id) return;
      rememberEvents(parents);
      superindexes = parents;
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    // Prefer router params; fall back to the hash so a stale/empty params object
    // never skips the memory paint and flashes "Publication is loading...".
    const hashPath =
      typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '').split('?')[0] : '';
    const hashDnpub = hashPath.match(/^\/publication\/d\/([^/]+)\/p\/([^/]+)\/?$/);
    const hashDonly = hashPath.match(/^\/publication\/d\/([^/]+)\/?$/);
    const hashPointer = hashPath.match(
      /^\/publication\/(?:(?:naddr|nevent|note)\/)?((?:naddr|nevent|note)1[02-9ac-hj-np-z]+)\/?$/i
    );

    const dTag = decodeParam(params.d || (hashDnpub?.[1] ?? hashDonly?.[1] ?? ''));
    const npubParam = (params.npub || hashDnpub?.[2] || '').split('?')[0];
    const pointerRaw = params.naddr || hashPointer?.[1] || '';
    const pointer = pointerRaw && !dTag ? pointerRaw : '';
    const routeKey = pointer || (dTag && npubParam ? `${dTag}|${npubParam}` : dTag || '');
    let cancelled = false;

    const sameRoute = Boolean(routeKey && routeKey === paintedRouteKey);
    if (!sameRoute) {
      paintedRouteKey = routeKey;
      editions = [];
      reading = false;
      tocOpen = false;
      sections = [];
      sectionCorpus = [];
      sectionReadPos = new Map();
      corpusCount = 0;
      toc = [];
      paintOrigin = 0;
      paintEnd = 35;
      paintPinId = '';
      scopedPaintIndex = null;
      focusKey = '';
      commentFocusApplied = '';
      replyOpenId = null;
      sectionsLoading = false;
      cancelTree();
      cancelPrefetch();
      error = false;
      unreadable = false;
    }

    // Hash navigations keep the previous page's scroll — reset unless a deep-link will re-scroll.
    const q = new URLSearchParams(
      typeof window !== 'undefined' ? (window.location.hash.split('?')[1] ?? '') : ''
    );
    const deep =
      q.has('comment') || q.has('rating') || q.has('section') || q.has('quote') || q.get('read') === '1';
    if (!deep && !sameRoute) {
      queueMicrotask(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    }

    const pubkey = npubParam ? hexFromNpubParam(npubParam) : '';
    const slug = dTag ? normalizeDTag(dTag) || dTag : '';
    const pending = sameRoute ? null : takePendingNavEvent();
    const fromPending =
      pending && pubkey && dTag && eventMatchesPublicationRoute(pending, KIND.PUBLICATION, pubkey, dTag)
        ? pending
        : pending && !dTag && pending.kind === KIND.PUBLICATION
          ? pending
          : null;
    const warm =
      fromPending ??
      (dTag && pubkey ? memoryFindByAddress(KIND.PUBLICATION, pubkey, slug || dTag) : null);

    if (warm) {
      // Already had this event on a shelf/search card — show header before any I/O.
      if (!sameRoute) paintEdition(warm);
    } else if (!sameRoute) {
      event = null;
      textUnavailable = false;
      loading = true;
    }

    if (sameRoute) {
      // Effect re-fired for the same edition — keep header/social/tree; skip I/O restart.
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        if (pointer) {
          const decoded = decodePublicationPointer(pointer);
          if (!decoded) {
            error = true;
            return;
          }
          let fetched: Event | null = null;
          if (decoded.id) {
            fetched = memoryGetEvent(decoded.id) ?? (await fetchById(decoded.id));
          } else if (decoded.pubkey && decoded.d != null) {
            const fromMem = memoryFindByAddress(
              decoded.kind ?? KIND.PUBLICATION,
              decoded.pubkey,
              decoded.d
            );
            if (fromMem) {
              fetched = fromMem;
            } else {
              const filter = {
                kinds: [decoded.kind ?? KIND.PUBLICATION],
                authors: [decoded.pubkey],
                '#d': [decoded.d],
                limit: 1
              };
              fetched =
                (await Promise.all([
                  mercuryFilter(filter),
                  relayPool.query(documentStack(), [filter])
                ]).then(([m, w]) => m[0] ?? w[0] ?? null));
            }
          }
          if (cancelled) return;
          if (!fetched || fetched.kind !== KIND.PUBLICATION) {
            error = true;
            return;
          }
          replace(publicationPath(fetched));
          paintEdition(fetched);
          return;
        }

        if (dTag && !npubParam) {
          const found = (await searchByDTag(dTag)).filter((e) => e.kind === KIND.PUBLICATION);
          const top = found.filter((e) => isTopLevel30040(e, found));
          if (cancelled) return;
          if (!top.length) {
            error = true;
            return;
          }
          rememberEvents(top);
          editions = top;
          return;
        }

        if (dTag && npubParam) {
          // Cover/search/landing already showed this event — paint from memory/cache only.
          // Do not REQ the same 30040 from relays just to render the header.
          if (warm) return;
          // Re-check memory after any await gap (HMR / late rememberEvents).
          const again = memoryFindByAddress(KIND.PUBLICATION, pubkey, slug || dTag);
          if (again) {
            paintEdition(again);
            return;
          }
          const cached = await cacheFindByAddress(KIND.PUBLICATION, pubkey, slug || dTag);
          if (cancelled) return;
          if (cached) {
            paintEdition(cached);
            return;
          }
          const fetched = await fetchPublication(slug || dTag, pubkey);
          if (cancelled) return;
          if (fetched) paintEdition(fetched);
          else error = true;
        }
      } catch {
        if (!cancelled) error = true;
      } finally {
        if (!cancelled) loading = false;
      }
    })();

    return () => {
      cancelled = true;
      // Do not cancelTree here — this effect re-fires when paintedRouteKey / params
      // settle for the same edition and would abort fillReadingSections mid-flight.
    };
  });

  onDestroy(() => {
    cancelTree();
    cancelPrefetch();
    void flushReadingProgress();
  });

  $effect(() => {
    // Re-apply deep links (?section=&quote=, ?comment=, ?rating=, or plain path → top).
    if (!event || loading) return;
    void $querystring;
    applyUrlFocus();
  });

  async function startReading(opts?: {
    fromUrl?: boolean;
    pos?: number;
    sectionId?: string;
  }): Promise<void> {
    if (!event || unreadable || !canRead) return;
    // URL sync can re-enter; ignore if we are already reading with content on screen.
    if (reading && opts?.fromUrl && sections.length) return;
    reading = true;
    if (!opts?.fromUrl) setReadQuery(true);
    if (isIndexScopedEdition(event)) {
      const focus = focusFromUrl();
      const wantLeaf =
        opts?.sectionId != null ||
        opts?.pos != null ||
        (!!focus.section && focus.read) ||
        (Number.isFinite(focus.pos) && focus.read);
      if (!sections.length || readingShellOnly || !scopedPaintIndex) {
        await fillReadingSections(event);
      }
      if (wantLeaf) {
        toc = buildIndexScopedToc(event);
        const open = pickScopedOpenIndex(event, toc, {
          pos: opts?.pos ?? (Number.isFinite(focus.pos) ? focus.pos : undefined),
          sectionId: opts?.sectionId ?? (focus.section || undefined),
          queueTotal: findQueueEntry($viewerReadingEntries, eventAddress(event))?.total
        });
        if (open) await paintScopedIndex(event, open, { network: isReadingPlanEdition(event) });
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }
    if (!sections.length) {
      await fillReadingSections(event);
    } else if (!sections.some((e) => e.kind !== KIND.PUBLICATION)) {
      // Prefetch / first paint may have left indexes-only; fill leaf bodies in the background.
      const edition = event;
      cancelTree();
      treeAbort = new AbortController();
      const signal = treeAbort.signal;
      readingBusy = false;
      void loadSectionEvents(edition, signal, (batch) => {
        if (signal.aborted || event?.id !== edition.id || !reading) return;
        scheduleAdopt(batch, edition);
      }).then(() => {
        if (signal.aborted || event?.id !== edition.id || !reading) return;
        scheduleAdopt([], edition, true);
      });
    }
    const resume = loadResume(eventAddress(event));
    const focus = focusFromUrl();
    const pos =
      opts?.pos !== undefined
        ? opts.pos
        : Number.isFinite(focus.pos)
          ? focus.pos
          : resume?.pos;
    const sectionId =
      opts?.sectionId !== undefined
        ? opts.sectionId
        : focus.section || resume?.sectionId;
    if (sectionId) paintPinId = sectionId;
    if (pos != null && Number.isFinite(pos) && pos >= 0) {
      ensurePaintedThrough(pos, sectionId);
      scrollToSectionRetry(pos, sectionId);
    } else if (sectionId) {
      const idx = indexInCorpus(sectionId);
      if (idx >= 0) ensurePaintedThrough(idx, sectionId);
      scrollToSectionRetry(0, sectionId);
    }
  }

  /** Same target as landing Reading now → Continue (tracked pos/section, else local resume). */
  async function continueReading(): Promise<void> {
    if (!event || !continueTarget) return;
    const { pos, sectionId, tracked } = continueTarget;
    if (tracked) void promoteReadingToFront(eventAddress(event));
    const q = new URLSearchParams($querystring ?? '');
    q.set('read', '1');
    if (sectionId) q.set('section', sectionId);
    else q.delete('section');
    if (Number.isFinite(pos) && pos >= 0) q.set('pos', String(Math.floor(pos)));
    else q.delete('pos');
    // Drop info-page deep links so applyUrlFocus opens the reader, not comments/ratings.
    q.delete('quote');
    q.delete('comment');
    q.delete('rating');
    const qs = q.toString();
    replace(qs ? `${hashPathOnly()}?${qs}` : hashPathOnly());
  }

  let scrollGen = 0;

  /** Retry until the target section is painted (stream may still be filling). */
  function scrollToSectionRetry(pos: number, sectionId?: string, address?: string, attempts = 50): void {
    const gen = scrollGen;
    scrollToSection(pos, sectionId, address);
    const found =
      (sectionId &&
        document.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(sectionId)}"]`)) ||
      (address &&
        document.querySelector<HTMLElement>(`[data-section-addr="${CSS.escape(address)}"]`)) ||
      document.querySelector<HTMLElement>(`[data-read-pos="${CSS.escape(String(pos))}"]`);
    if (found || attempts <= 0) return;
    window.setTimeout(() => {
      if (gen !== scrollGen) return;
      scrollToSectionRetry(pos, sectionId, address, attempts - 1);
    }, 120);
  }

  /** Leave the reader and restore the edition info page (ratings, comments, details). */
  function stopReading(): void {
    if (!reading) return;
    void flushReadingProgress();
    scrollGen += 1;
    focusKey = '';
    reading = false;
    tocOpen = false;
    jumpBusy = false;
    sectionsLoading = false;
    cancelTree();
    setReadQuery(false);
    queueMicrotask(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }

  function scrollToSection(pos: number, sectionId?: string, address?: string): void {
    const idx = indexInCorpus(sectionId, address, pos);
    if (idx >= 0) ensurePaintedThrough(idx, sectionId);

    // Paint updates state synchronously, but the nodes mount on the next flush.
    void tick().then(() => {
      const readPos = indexInCorpus(sectionId, address, pos);
      const posKey = String(readPos >= 0 ? readPos : pos);
      requestAnimationFrame(() => {
        const article =
          (sectionId
            ? document.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(sectionId)}"]`)
            : null) ??
          (address
            ? document.querySelector<HTMLElement>(`[data-section-addr="${CSS.escape(address)}"]`)
            : null) ??
          document.querySelector<HTMLElement>(`[data-read-pos="${CSS.escape(posKey)}"]`);

        const el =
          article?.querySelector<HTMLElement>('.section-hero') ??
          article ??
          (sectionId ? document.getElementById(`section-${sectionId}`) : null) ??
          (address
            ? document.querySelector<HTMLElement>(
                `[data-section-addr="${CSS.escape(address)}"] .section-heading`
              )
            : null) ??
          document.querySelector<HTMLElement>(
            `[data-read-pos="${CSS.escape(posKey)}"] .section-heading`
          );

        if (!el) return;
        const topBar = document.querySelector('.top-bar');
        const barHidden =
          document.documentElement.classList.contains('top-bar-concealed') ||
          topBar?.classList.contains('is-concealed');
        const barH = barHidden ? 0 : (topBar?.getBoundingClientRect().height ?? 72);
        const offset = Math.ceil(barH + 16);
        const top = el.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
      });
    });
  }

  function findLoadedSection(entry: TocEntry): Event | undefined {
    const pool = sectionCorpus.length ? sectionCorpus : sections;
    const matches = pool.filter(
      (s) =>
        (entry.id && s.id === entry.id) ||
        (entry.address != null && entry.address !== '' && eventAddress(s) === entry.address)
    );
    return matches.find((s) => !isPlaceholderIndex(s)) ?? matches[0];
  }

  function tocEntryLoaded(entry: TocEntry): boolean {
    return !!findLoadedSection(entry);
  }

  /** Leaf sections stay disabled until in the pane (real or placeholder); nested 30040s stay jumpable. */
  function tocEntryDisabled(entry: TocEntry): boolean {
    if (jumpBusy) return true;
    if (entry.index) return false;
    return !tocEntryLoaded(entry);
  }

  function toggleTocBranch(key: string): void {
    const entry = readerToc.find((e) => tocEntryKey(e) === key);
    const defaultOpen = (entry?.depth ?? 0) === 0;
    const currently = key in tocExpanded ? !!tocExpanded[key] : defaultOpen;
    tocExpanded = { ...tocExpanded, [key]: !currently };
  }

  async function resolveTocSection(entry: TocEntry): Promise<Event | null> {
    if (entry.event && !isPlaceholderIndex(entry.event)) return entry.event;
    const loaded = findLoadedSection(entry);
    if (loaded && !isPlaceholderIndex(loaded)) return loaded;
    if (entry.address) {
      const parsed = parseAddress(entry.address);
      if (parsed) {
        const mem = memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d);
        if (mem && !isPlaceholderIndex(mem)) return mem;
        // Plan seeds can omit early days — fetch the real index before stubbing.
        const hit = await fetchByAddress(entry.address);
        if (hit) return hit;
        if (event && isIndexScopedEdition(event)) {
          return placeholderIndexEvent(entry);
        }
      }
    }
    if (entry.id) {
      const byId = memoryGetEvent(entry.id);
      if (byId) return byId;
      const fetched = await fetchById(entry.id);
      if (fetched) return fetched;
      if (event && isIndexScopedEdition(event)) {
        return placeholderIndexEvent(entry);
      }
    }
    // Keep an existing placeholder, or synthesize one for true ghost Mercury rows.
    if (loaded) return loaded;
    return placeholderSectionEvent(entry) ?? (entry.index ? placeholderIndexEvent(entry) : null);
  }

  $effect(() => {
    const root = readingPane;
    const q = pageFilter;
    if (!reading || !root) return;
    return pageFind.observe(root, q);
  });

  $effect(() => {
    if (!tocOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') tocOpen = false;
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || !(t instanceof Element)) return;
      if (t.closest('.toc, .toc-fab')) return;
      tocOpen = false;
    };
    window.addEventListener('keydown', onKey);
    // Capture so the close wins before other UI handles the same tap.
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  });

  function highlightContextFromSelection(sel: Selection | null, quote: string): string | undefined {
    try {
      const node = sel?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const block = el?.closest('p, li, blockquote, pre, div.paragraph, article');
      const full = block?.textContent?.trim();
      if (full && full !== quote && full.includes(quote)) return full.slice(0, 500);
    } catch {
      /* ignore */
    }
    return undefined;
  }

  function sectionFromReadingSelection(sel: Selection | null): Event | null {
    if (!sel || !readingPane) return null;
    const node = sel.anchorNode;
    if (!node || !readingPane.contains(node)) return null;
    const el = node instanceof Element ? node : node.parentElement;
    const id = el?.closest('[data-section-id]')?.getAttribute('data-section-id')?.trim();
    if (!id) return null;
    return sectionCorpus.find((s) => s.id === id) ?? sections.find((s) => s.id === id) ?? null;
  }

  function syncReaderHighlightDraft(): void {
    const sel = window.getSelection();
    const quote = sel?.toString().trim() ?? '';
    if (!quote || !sel) {
      if (keepHighlightDraft) {
        keepHighlightDraft = false;
        return;
      }
      readerHighlightDraft = null;
      return;
    }
    const section = sectionFromReadingSelection(sel);
    if (!section || isPlaceholderSection(section)) {
      readerHighlightDraft = null;
      return;
    }
    readerHighlightDraft = {
      section,
      quote,
      context: highlightContextFromSelection(sel, quote)
    };
  }

  $effect(() => {
    if (!reading) {
      readerHighlightDraft = null;
      keepHighlightDraft = false;
      return;
    }
    const onSel = () => syncReaderHighlightDraft();
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      // Opening / using ToC chrome must not drop a captured quote.
      if (t.closest('.toc, .toc-fab')) keepHighlightDraft = true;
    };
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  });

  function cyclePageFind(): void {
    if (readingPane) pageFind.next(readingPane);
  }

  /** Sticky ToC control: jump to the edition root / reading-pane top. */
  async function goToReadingTop(): Promise<void> {
    const root = readerToc.find((e) => e.root) ?? readerToc[0];
    if (root) {
      await jumpTo(root);
      return;
    }
    tocOpen = false;
    if (!event || !canRead) return;
    ensurePaintedThrough(0);
    scrollToSectionRetry(0, event.id, eventAddress(event));
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }

  async function jumpTo(entry: TocEntry): Promise<void> {
    tocOpen = false;
    if (!event || unreadable || !canRead) return;

    if (isIndexScopedEdition(event)) {
      const edition = event;
      const rootAddr = eventAddress(edition).toLowerCase();
      const isRoot =
        !!entry.root ||
        entry.id?.toLowerCase() === edition.id.toLowerCase() ||
        (entry.address ?? '').toLowerCase() === rootAddr;
      if (isRoot) {
        paintScopedEditionTop(edition);
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        return;
      }
      const key = `toc:${entry.address ?? entry.id ?? entry.pos}`;
      focusKey = key;
      jumpLabel = entry.title;
      jumpBusy = true;
      readingBusy = true;
      try {
        if (!reading) {
          reading = true;
          setReadQuery(true);
        }
        const focused = await resolveTocSection(entry);
        if (focusKey !== key || event !== edition || !focused) return;
        rememberEvents([focused]);
        toc = buildIndexScopedToc(edition);
        const leaf = resolvePaintIndex(focused, edition, toc);
        if (!leaf) return;
        await paintScopedIndex(edition, leaf, { network: isReadingPlanEdition(edition) });
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      } finally {
        if (focusKey === key) {
          jumpBusy = false;
          readingBusy = false;
        }
      }
      return;
    }

    const existing = findLoadedSection(entry);
    if (existing && !isPlaceholderSection(existing)) {
      scrollToSection(entry.pos, existing.id, eventAddress(existing));
      saveResume(eventAddress(event), { pos: entry.pos, sectionId: existing.id });
      return;
    }

    const edition = event;
    const key = `toc:${entry.address ?? entry.id ?? entry.pos}`;
    focusKey = key;
    jumpLabel = entry.title;
    jumpBusy = true;
    readingBusy = true;
    try {
      const focused = await resolveTocSection(entry);
      if (focusKey !== key || event !== edition) return;

      if (focused) {
        if (!isPlaceholderSection(focused)) rememberEvents([focused]);
        adoptSections(mergeSections(sections, [focused]), edition);
        void enrichHighlightsFromSections([focused]);
        jumpBusy = false;
        readingBusy = false;
        queueMicrotask(() => {
          if (focusKey !== key) return;
          scrollToSection(entry.pos, focused.id, eventAddress(focused));
        });
        saveResume(eventAddress(edition), { pos: entry.pos, sectionId: focused.id });
      }

      let streamed: Event[] = [];
      const naddr = naddrFor(edition);
      const skipMercury =
        isMercuryUnavailable() || isMercuryPublicationMissing(naddr);
      try {
        if (!skipMercury) {
          if (Number.isFinite(entry.pos)) {
            streamed = await mercuryPublicationStream(naddr, entry.pos);
          }
          if (!streamed.length) {
            streamed = await mercuryPublicationStream(naddr);
          }
        }
      } catch {
        streamed = [];
      }
      if (focusKey !== key || event !== edition) return;
      if (!streamed.some((e) => e.kind !== KIND.PUBLICATION)) {
        streamed = mergeSections(
          streamed,
          await fallbackSections(edition, {
            relaysOnly: skipMercury || isMercuryPublicationMissing(naddr),
            onHit: (hit) => {
              if (focusKey !== key || event !== edition) return;
              adoptSections(mergeSections(sections, [hit]), edition);
            }
          })
        );
      }
      if (focusKey !== key || event !== edition) return;

      if (streamed.length || focused) {
        adoptSections(mergeSections(sections, streamed), edition);
        void enrichHighlightsFromSections(sections);
        queueMicrotask(() => {
          if (focusKey !== key) return;
          const scrollId = focused?.id ?? findLoadedSection(entry)?.id;
          scrollToSection(entry.pos, scrollId, entry.address);
        });
      } else if (!sections.length) {
        unreadable = true;
        reading = false;
      }
    } finally {
      if (focusKey === key) {
        jumpBusy = false;
        readingBusy = false;
      }
    }
  }

  async function loadSectionComments(section: Event): Promise<void> {
    const a = eventAddress(section);
    if (sectionComments[a]) return;
    sectionComments = { ...sectionComments, [a]: await fetchThreadEvents(section, 40) };
  }

  function rememberPos(pos: number, section: Event): void {
    if (!event) return;
    if (isIndexScopedEdition(event) && scopedPaintIndex) {
      const prog = scopedProgressForIndex(event, toc, scopedPaintIndex);
      if (!prog) return;
      // Always persist the painted leaf — do not advance resume/queue to the next
      // day/chapter just because the user scrolled to the last section on screen.
      const prev = readerPos;
      const prevId = readerSectionId;
      readerPos = prog.pos;
      readerSectionId = prog.sectionId;
      saveResume(eventAddress(event), { pos: prog.pos, sectionId: prog.sectionId });
      if (prog.pos !== prev || prog.sectionId !== prevId) {
        sectionTick = true;
        window.setTimeout(() => {
          sectionTick = false;
        }, 600);
        void syncReadingProgress({
          publication: event,
          pos: prog.pos,
          total: prog.total,
          sectionId: prog.sectionId
        });
      }
      return;
    }
    // Prefer corpus index for this section so progress uses document order, not a
    // painted-prefix / readerGroups fallback that may have drifted.
    const corpusPos = indexInCorpus(section.id);
    const resolvedPos = corpusPos >= 0 ? corpusPos : pos;
    saveResume(eventAddress(event), { pos: resolvedPos, sectionId: section.id });
    const prev = readerPos;
    readerPos = resolvedPos;
    readerSectionId = section.id;
    if (resolvedPos !== prev) {
      sectionTick = true;
      window.setTimeout(() => {
        sectionTick = false;
      }, 600);
      void syncReadingProgress({
        publication: event,
        pos: resolvedPos,
        total: Math.max(corpusCount, sectionCorpus.length, 1),
        sectionId: section.id
      });
    }
  }

  /** Resume tracking without a11y listeners on non-interactive verse/section markup. */
  $effect(() => {
    const root = readingPane;
    if (!reading || !root) return;
    const onScroll = () => {
      const room = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      if (room < 4000) extendPaint();
      if (window.scrollY < 900 && paintOrigin > 0) extendPaintBackward();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  });

  /**
   * Keep growing the painted window until the whole corpus is mounted.
   * First paint stays small for speed; idle ticks finish the book without requiring
   * the reader to reach the bottom / mash "Show more".
   * Douay / reading plans paint one index only — never grow into the full Bible.
   */
  $effect(() => {
    if (!reading || !event) return;
    if (isIndexScopedEdition(event)) return;
    void corpusCount;
    void paintEnd;
    if (paintEnd >= corpusCount || corpusCount <= 0) return;
    let cancelled = false;
    const schedule =
      typeof requestIdleCallback === 'function'
        ? (fn: () => void) => requestIdleCallback(fn, { timeout: 600 })
        : (fn: () => void) => window.setTimeout(fn, 120);
    const cancel =
      typeof cancelIdleCallback === 'function'
        ? (id: number) => cancelIdleCallback(id)
        : (id: number) => clearTimeout(id);
    let handle = 0;
    const tick = () => {
      handle = 0;
      if (cancelled || !reading) return;
      if (paintEnd < sectionCorpus.length) {
        extendPaint();
        handle = schedule(tick) as number;
      }
    };
    handle = schedule(tick) as number;
    return () => {
      cancelled = true;
      if (handle) cancel(handle);
    };
  });

  /** Advance tracked pos when a section crosses the reading line (not only on click). */
  $effect(() => {
    const root = readingPane;
    if (!reading || !root) return;
    void paintedSections.length;
    let raf = 0;
    let lastPos = -1;
    const pickVisible = () => {
      raf = 0;
      const nodes = root.querySelectorAll<HTMLElement>('[data-read-pos][data-section-id]');
      if (!nodes.length) return;
      const line = window.innerHeight * 0.35;
      let chosen: HTMLElement | null = null;
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        if (rect.top <= line && rect.bottom > 64) chosen = node;
      }
      if (!chosen) {
        for (const node of nodes) {
          const rect = node.getBoundingClientRect();
          if (rect.bottom > 64) {
            chosen = node;
            break;
          }
        }
      }
      if (!chosen) return;
      const pos = Number(chosen.dataset.readPos);
      const id = chosen.dataset.sectionId;
      if (!Number.isFinite(pos) || !id || pos === lastPos) return;
      lastPos = pos;
      const section =
        sections.find((s) => s.id === id) ??
        untrack(() => sectionCorpus.find((s) => s.id === id));
      if (section) rememberPos(pos, section);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(pickVisible);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushReadingProgressOnHide();
      else flushReadingProgressOnVisible();
    };
    const onPageHide = () => flushReadingProgressOnHide();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    // Delay first pick so initial layout/scroll-to-resume does not spam relay publishes.
    const boot = window.setTimeout(pickVisible, 400);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.clearTimeout(boot);
      if (raf) cancelAnimationFrame(raf);
      // Do not flush here — this effect rebinds when more sections paint.
    };
  });

  $effect(() => {
    const root = readingPane;
    if (!root) return;
    const onUp = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(
        '[data-read-pos][data-section-id]'
      ) as HTMLElement | null;
      if (!el || !root.contains(el)) return;
      const pos = Number(el.dataset.readPos);
      const id = el.dataset.sectionId;
      if (!Number.isFinite(pos) || !id) return;
      const section = sections.find((s) => s.id === id);
      if (section) rememberPos(pos, section);
    };
    root.addEventListener('mouseup', onUp);
    return () => root.removeEventListener('mouseup', onUp);
  });

  async function postComment(): Promise<void> {
    if (!event) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    if (!commentText.trim()) return;
    const signed = await signAndPublish(commentDraft(event, commentText.trim()));
    if (signed) {
      comments = [...comments, signed];
      commentText = '';
    }
  }

  async function postSectionComment(section: Event): Promise<void> {
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    const a = eventAddress(section);
    const text = (sectionCommentText[a] ?? '').trim();
    if (!text) return;
    const signed = await signAndPublish(commentDraft(section, text));
    if (signed) {
      sectionComments = {
        ...sectionComments,
        [a]: [...(sectionComments[a] ?? []), signed]
      };
      sectionCommentText = { ...sectionCommentText, [a]: '' };
    }
  }

  async function saveHighlight(
    section: Event,
    preset?: { quote: string; context?: string }
  ): Promise<void> {
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    const sel = window.getSelection();
    const quote = preset?.quote ?? sel?.toString().trim() ?? '';
    if (!quote) return;
    const context = preset?.context ?? highlightContextFromSelection(sel, quote);
    if (!event) return;
    const signed = await signAndPublish(highlightDraft(event, section, quote, context));
    if (signed) {
      const mine = session
        .getMetadata()
        .find((e) => e.kind === KIND.METADATA && e.pubkey.toLowerCase() === signed.pubkey.toLowerCase());
      seedHighlightProfile(signed.pubkey, mine ?? null);
      highlights = [signed, ...highlights.filter((h) => h.id !== signed.id)];
      void ingestLocalLandingHighlight(signed, event);
      window.getSelection()?.removeAllRanges();
      readerHighlightDraft = null;
      keepHighlightDraft = false;
    }
  }

  async function createHighlightFromReaderSelection(): Promise<void> {
    const draft = readerHighlightDraft;
    if (!draft) return;
    tocOpen = false;
    await saveHighlight(draft.section, { quote: draft.quote, context: draft.context });
  }

  function quotesFor(section: Event): TextHighlight[] {
    const a = eventAddress(section);
    const keys = new Set(publicationCoordinateLookupKeys(a));
    const forSection = mutedHighlights.filter(
      (h) =>
        h.tags.some((t) => t[0] === 'a' && t[1] && keys.has(t[1])) ||
        h.tags.some((t) => t[0] === 'e' && t[1]?.toLowerCase() === section.id.toLowerCase())
    );
    const fromEvents = textHighlightsFromEvents(forSection);
    // Deep-link ?quote= from landing: mark even before the kind-9802 event is fetched.
    if (
      urlFocusQuote &&
      !fromEvents.some((h) => h.quote.replace(/\s+/g, ' ').toLowerCase().includes(urlFocusQuote.slice(0, 80).toLowerCase()))
    ) {
      const body = section.content.replace(/\s+/g, ' ').toLowerCase();
      if (body.includes(urlFocusQuote.slice(0, 80).toLowerCase())) {
        return [...fromEvents, { quote: urlFocusQuote, pubkey: '' }];
      }
    }
    return fromEvents;
  }

  async function enrichHighlightsFromSections(secs: Event[]): Promise<void> {
    if (!secs.length) return;
    const ids = secs.map((s) => s.id.toLowerCase()).slice(0, 40);
    const addrs = secs.flatMap((s) => publicationCoordinateLookupKeys(eventAddress(s)));
    const [byE, ...byA] = await Promise.all([
      relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#e': ids, limit: 80 }]),
      ...chunk([...new Set(addrs)], 20).map((batch) =>
        relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#a': batch, limit: 80 }])
      )
    ]);
    const byId = new Map(highlights.map((h) => [h.id, h]));
    for (const e of byE) byId.set(e.id, e);
    for (const batch of byA) for (const e of batch) byId.set(e.id, e);
    highlights = [...byId.values()];
  }
</script>

<TopBar autoHideOnScroll={reading} />
<main class="shell">
  {#if error}
    <ErrorPage title="Edition not found" />
  {:else if unreadable}
    <ErrorPage title="This edition cannot be read" message="The library has no readable copy of this edition." />
  {:else if editions.length}
    <h1>Editions</h1>
    <PageFilter bind:value={pageFilter} />
    <div class="card-grid card-grid-results">
      {#each visibleEditions as edition (edition.id)}
        <div>
          {#if isLibraryCopyPubkey(edition.pubkey)}
            <p class="muted">Library copy</p>
          {/if}
          <PublicationCard event={edition} />
        </div>
      {/each}
    </div>
  {:else if event}
    {#if !reading}
      <PageFilter bind:value={pageFilter} />
      <header class="card edition-page-card" style="margin-bottom:1.5rem">
        <div class="edition-page-read">
          <ReadButton publication={event} readEvents={editionReads} />
        </div>
        <EditionHeader {event} {sections} />
        <EditionSuperindexes parents={superindexes} />
        <div class="edition-actions">
          <ShelfActions publication={event} />
          {#if canRead}
            {#if canContinue}
              <button class="btn btn-primary" type="button" onclick={() => void continueReading()}
                >Continue reading</button
              >
            {:else}
              <button class="btn btn-primary" type="button" onclick={() => void startReading()}
                >Read the publication</button
              >
            {/if}
          {/if}
        </div>
        {#if !canRead}
          <p class="muted edition-unavailable">
            Catalog entry only — the full text is not available in the library (often a copyrighted work we cannot publish).
          </p>
        {/if}
        <DetailsPanel {event} />
      </header>

      <EditionPeople
        publication={event}
        labels={editionLabels}
        bookmarks={editionBookmarks}
        highlights={mutedHighlights}
        directories={editionDirectories}
        readingQueues={editionReadingQueues}
      />

      <RatingPanel
        ratings={visibleRatings}
        publication={event}
        focusId={(new URLSearchParams($querystring ?? '').get('rating') ?? '').trim().toLowerCase()}
      />

      <section class="card reading-width" style="margin-bottom:1rem">
        <h2>Comments</h2>
        {#if thread.length}
          <ul class="thread-list">
            {#each thread as node (threadNodeKey(node))}
              <CommentThread {node} target={event} bind:replyOpenId focusId={urlFocusComment} />
            {/each}
          </ul>
        {:else}
          <p class="muted">No comments yet.</p>
        {/if}
        {#if $session.pubkey && !replyOpenId}
          <form class="compose" onsubmit={(e) => { e.preventDefault(); void postComment(); }}>
            <textarea bind:value={commentText} rows="3" placeholder="Write a comment"></textarea>
            <button class="btn btn-primary" type="submit" disabled={!commentText.trim()}>Post</button>
          </form>
        {:else if !$session.pubkey}
          <button class="btn" type="button" onclick={() => openLoginDialog()}>Sign in to comment</button>
        {/if}
      </section>
    {:else}
      <div class="reader-layout">
        {#if readerToc.length}
          <nav class="toc card" class:toc-open={tocOpen} aria-label="Table of contents">
            <div class="toc-chrome">
              <h2>Contents</h2>
              <div class="toc-chrome-actions">
                {#if readerHighlightDraft}
                  <button
                    class="toc-create-highlight"
                    type="button"
                    title="Create a highlight from the selected text"
                    onpointerdown={(e) => e.preventDefault()}
                    onclick={() => void createHighlightFromReaderSelection()}
                  >
                    Create highlight
                  </button>
                {/if}
                <button
                  class="toc-goto-top"
                  type="button"
                  title="Jump to the start of this publication"
                  onclick={() => void goToReadingTop()}
                >
                  Go to top
                </button>
              </div>
            </div>
            <div class="toc-scroll">
              <TocPanel
                nodes={tocTree}
                expanded={tocExpanded}
                activeKey={activeTocKey}
                isLoaded={tocEntryLoaded}
                isDisabled={tocEntryDisabled}
                onToggle={toggleTocBranch}
                onJump={(entry) => void jumpTo(entry)}
              />
            </div>
          </nav>
          <button
            class="toc-fab"
            type="button"
            aria-label={tocOpen ? 'Close table of contents' : 'Open table of contents'}
            aria-expanded={tocOpen}
            onclick={() => (tocOpen = !tocOpen)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                fill="currentColor"
                d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"
              />
            </svg>
          </button>
        {/if}
        {#if jumpBusy}
          <p class="jump-busy-toast" aria-live="polite">
            <span class="jump-busy-spinner" aria-hidden="true"></span>
            Opening “{jumpLabel || 'section'}”…
          </p>
        {/if}
        <div class="reading-body" bind:this={readingPane}>
          <PageFilter
            bind:value={pageFilter}
            placeholder="Find in this publication…"
            onEnter={cyclePageFind}
          />
          {#if jumpBusy && !paintedSections.length}
            <p class="loading-hint jump-busy" aria-hidden="true">
              <span class="jump-busy-spinner" aria-hidden="true"></span>
              Opening “{jumpLabel || 'section'}”…
            </p>
          {:else if !paintedSections.length && (readingBusy || !sections.length)}
            <p class="loading-hint">Publication is loading...</p>
          {/if}
          {#each readerGroups as group (group.kind === 'bible' ? `bible-${group.verses[0]?.id}` : group.event.id)}
            {#if group.kind === 'bible'}
              {@const verses = group.verses}
              <div class="bible-flow">
                {#each verses as verse (verse.id)}
                  {@const sectionKey = eventAddress(verse)}
                  {@const disp = bibleDisplay(verse)}
                  {@const pos = sectionReadPos.get(verse.id) ?? 0}
                  {#if disp.kind === 'heading'}
                    <h3
                      class="bible-run-heading"
                      id={`section-${verse.id}`}
                      data-section-id={verse.id}
                      data-section-addr={sectionKey}
                      data-read-pos={pos}
                    >
                      {disp.title}
                    </h3>
                    <p class="bible-run-text">{verse.content}</p>
                  {:else}
                    <span
                      class="bible-verse"
                      id={`section-${verse.id}`}
                      data-section-id={verse.id}
                      data-section-addr={sectionKey}
                      data-read-pos={pos}
                    >
                      <CopyPointerButton event={verse} class="bible-verse-menu" preferStart={false}>
                        {#snippet trigger()}
                          <span class="bible-verse-num" title={disp.label}>{disp.verse}</span>
                        {/snippet}
                        {#snippet before()}
                          <li role="none">
                            {#if $session.pubkey}
                              <button
                                class="menu-item"
                                type="button"
                                role="menuitem"
                                onclick={() => {
                                  void saveHighlight(verse);
                                }}
                              >
                                Save highlight
                              </button>
                            {:else}
                              <button
                                class="menu-item"
                                type="button"
                                role="menuitem"
                                onclick={() => {
                                  openLoginDialog();
                                }}
                              >
                                Sign in to highlight
                              </button>
                            {/if}
                          </li>
                        {/snippet}
                        {#snippet after()}
                          <li role="none">
                            <button
                              class="menu-item"
                              type="button"
                              role="menuitem"
                              onclick={() => {
                                const open = !sectionCommentsOpen[sectionKey];
                                sectionCommentsOpen = { ...sectionCommentsOpen, [sectionKey]: open };
                                if (open) void loadSectionComments(verse);
                              }}
                            >
                              {sectionCommentsOpen[sectionKey] ? 'Hide comments' : 'Comments'}
                            </button>
                          </li>
                        {/snippet}
                      </CopyPointerButton>
                      <span class="bible-verse-text">{verse.content}</span>
                    </span>
                    {#if sectionCommentsOpen[sectionKey]}
                      <div class="section-comments bible-verse-comments">
                        {#if sectionComments[sectionKey]?.length}
                          <ul class="thread-list">
                            {#each nestComments(filterMuted(sectionComments[sectionKey] ?? [], $muteState), $muteState, [verse.id]) as node (threadNodeKey(node))}
                              <CommentThread {node} target={verse} bind:replyOpenId />
                            {/each}
                          </ul>
                        {:else}
                          <p class="muted">No comments yet.</p>
                        {/if}
                      </div>
                    {/if}
                  {/if}
                {/each}
              </div>
            {:else}
              {@const section = group.event}
              {@const sectionKey = eventAddress(section)}
              {@const isIndex = section.kind === KIND.PUBLICATION}
              {@const missing = isPlaceholderSection(section)}
              {@const heroUrl = readerSectionHeroUrl(section, event)}
              {@const pos = sectionReadPos.get(section.id) ?? 0}
              <article
                class="reader-section"
                class:reader-index={isIndex}
                class:reader-edition={!!event && section.id === event.id}
                class:reader-section-missing={missing}
                data-read-pos={pos}
                data-section-addr={sectionKey}
                data-section-id={section.id}
              >
                {#if heroUrl && isAllowedMediaUrl(heroUrl)}
                  <figure class="section-hero">
                    <img src={heroUrl} alt="" loading="lazy" />
                  </figure>
                {/if}
                <h2 class="section-heading" id={`section-${section.id}`}>{sectionHeading(section)}</h2>
                {#if isIndex}
                  {#if event && section.id === event.id}
                    <EditionReaderMeta event={section} {sections} />
                    <div class="reading-track-panel" class:reading-section-tick={sectionTick}>
                      <TrackReadingButton
                        publication={event}
                        total={corpusCount}
                        pos={readerPos}
                        sectionId={readerSectionId}
                        readLabels={editionReads}
                      />
                    </div>
                    <div class="edition-actions reader-info-actions">
                      <button class="btn btn-primary" type="button" onclick={stopReading}
                        >Publication info</button
                      >
                    </div>
                  {/if}
                  <!-- Nested index stubs keep the title heading only (Mercury row with no event). -->
                {:else if missing}
                  <p class="muted missing-section-hint">This section is unavailable.</p>
                {:else if isMarkupKind(section.kind)}
                  <div>
                    <EventBody event={section} quotes={quotesFor(section)} />
                  </div>
                {:else}
                  <EventCard event={section} />
                {/if}
                {#if (!isIndex || missing) && !(event && section.id === event.id)}
                <div class="section-toolbar">
                  <CopyPointerButton event={section}>
                    {#snippet before()}
                      {#if !missing}
                      <li role="none">
                        {#if $session.pubkey}
                          <button
                            class="menu-item"
                            type="button"
                            role="menuitem"
                            onclick={() => {
                              void saveHighlight(section);
                            }}
                          >
                            Save highlight
                          </button>
                        {:else}
                          <button
                            class="menu-item"
                            type="button"
                            role="menuitem"
                            onclick={() => {
                              openLoginDialog();
                            }}
                          >
                            Sign in to highlight
                          </button>
                        {/if}
                      </li>
                      {/if}
                    {/snippet}
                    {#snippet after()}
                      <li role="none">
                        <button
                          class="menu-item"
                          type="button"
                          role="menuitem"
                          onclick={() => {
                            const open = !sectionCommentsOpen[sectionKey];
                            sectionCommentsOpen = { ...sectionCommentsOpen, [sectionKey]: open };
                            if (open) void loadSectionComments(section);
                          }}
                        >
                          {sectionCommentsOpen[sectionKey] ? 'Hide comments' : 'Comments'}
                        </button>
                      </li>
                    {/snippet}
                  </CopyPointerButton>
                </div>
                {#if sectionCommentsOpen[sectionKey]}
                  <div class="section-comments">
                    {#if sectionComments[sectionKey]?.length}
                      <ul class="thread-list">
                        {#each nestComments(filterMuted(sectionComments[sectionKey] ?? [], $muteState), $muteState, [section.id]) as node (threadNodeKey(node))}
                          <CommentThread {node} target={section} bind:replyOpenId />
                        {/each}
                      </ul>
                    {:else}
                      <p class="muted">No comments yet.</p>
                    {/if}
                    {#if $session.pubkey && !replyOpenId}
                      <form
                        class="compose"
                        onsubmit={(e) => {
                          e.preventDefault();
                          void postSectionComment(section);
                        }}
                      >
                        <textarea
                          value={sectionCommentText[sectionKey] ?? ''}
                          oninput={(e) => {
                            sectionCommentText = {
                              ...sectionCommentText,
                              [sectionKey]: (e.currentTarget as HTMLTextAreaElement).value
                            };
                          }}
                          rows="3"
                          placeholder="Write a comment on this section"
                        ></textarea>
                        <button
                          class="btn btn-primary"
                          type="submit"
                          disabled={!(sectionCommentText[sectionKey] ?? '').trim()}
                          >Post</button
                        >
                      </form>
                    {:else if !$session.pubkey}
                      <button class="btn" type="button" onclick={() => openLoginDialog()}
                        >Sign in to comment</button
                      >
                    {/if}
                  </div>
                {/if}
                {/if}
              </article>
            {/if}
          {/each}
          {#if moreToPaint}
            <div class="reader-paint-more">
              <p class="muted">
                Loading sections… {paintedSections.length} of {corpusCount} ready
              </p>
              <button class="btn" type="button" onclick={extendPaint}>Show more</button>
            </div>
          {:else if sectionsLoading && !(event && isIndexScopedEdition(event) && !readingShellOnly)}
            <p class="loading-hint" aria-live="polite">
              <span class="jump-busy-spinner" aria-hidden="true"></span>
              {readingShellOnly ? 'Loading sections…' : 'Loading more sections…'}
            </p>
          {/if}
        </div>
      </div>
    {/if}
  {:else if loading}
    <p class="loading-hint">Publication is loading...</p>
  {/if}
</main>
<ReadingFinishModal
  onRate={() => {
    if (reading) stopReading();
    queueMicrotask(() => {
      document.querySelector('.rating-panel')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  }}
/>
