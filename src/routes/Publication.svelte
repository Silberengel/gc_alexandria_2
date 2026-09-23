<script lang="ts">
  import { onDestroy, tick } from 'svelte';
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
  import EditionReaderMeta from '$lib/components/EditionReaderMeta.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import CopyPointerButton from '$lib/components/CopyPointerButton.svelte';
  import { KIND, NIP32_READ_LABEL } from '$lib/constants';
  import { publicationPath, hasPublicationSection } from '$lib/metadata';
  import { muteState, filterMuted } from '$lib/mute';
  import { filterDeletedEvents, refreshDeletionsFor } from '$lib/deletions';
  import { createPageFindController, filterPageEvents } from '$lib/page-filter';
  import {
    isMercuryUnavailable,
    mercuryFilter,
    mercuryPublicationMeta,
    mercuryPublicationStream,
    mercuryPublicationToc
  } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { documentStack, socialStack } from '$lib/nostr/selector';
  import { eventAddress, isTopLevel30040 } from '$lib/nostr/verify';
  import { fetchById, fetchPublication, fetchByAddress, poolMap } from '$lib/nostr/fetch';
  import { cacheFindByAddress } from '$lib/nostr/cache';
  import { memoryFindByAddress, memoryGetEvent, rememberEvents } from '$lib/nostr/event-memory';
  import { nestComments, fetchThreadEvents, threadNodeKey } from '$lib/comments';
  import { newestRatingPerAuthor, publicationRatingATagsForQuery } from '$lib/ratings';
  import { commentDraft, highlightDraft } from '$lib/drafts';
  import { publicationCoordinateLookupKeys } from '$lib/publication-coordinate';
  import { textHighlightsFromEvents, seedHighlightProfile, type TextHighlight } from '$lib/text-highlights';
  import { ingestLocalLandingHighlight } from '$lib/landing';
  import { signAndPublish } from '$lib/sign';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { loadResume, saveResume } from '$lib/resume';
  import { isLibraryCopyPubkey } from '$lib/hex';
  import { readerSectionHeroUrl } from '$lib/cover';
  import { bibleDisplay, groupReaderSections } from '$lib/bible-verse';
  import { verseStyling } from '$lib/stores/verse-styling';
  import { isAllowedMediaUrl } from '$lib/markup';
  import {
    decodePublicationPointer,
    enrichToc,
    buildTocTree,
    ensureIndexHeadings,
    expandTocFromSections,
    hexFromNpubParam,
    isPlaceholderIndex,
    isUnreadableMeta,
    mergePublicationSections,
    orderPublicationSections,
    naddrFor,
    parseToc,
    placeholderIndexEvent,
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
  let reading = $state(false);
  let sections = $state<Event[]>([]);
  /** Full loaded corpus — not reactive, so ingesting stream pages does not remount the pane. */
  let sectionCorpus: Event[] = [];
  /** Reactive length for “Show more” UI (corpus itself stays non-reactive). */
  let corpusCount = $state(0);
  let toc = $state<TocEntry[]>([]);
  /** How many ordered sections to mount in the reading pane (grows on scroll / jump). */
  let paintLimit = $state(100);
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
  /** Avoid tearing down a warm paint when the route effect re-fires for the same edition. */
  let paintedRouteKey = '';
  let pageFilter = $state('');
  let readingBusy = $state(false);
  /** ToC jump to a section that is not in the pane yet. */
  let jumpBusy = $state(false);
  let jumpLabel = $state('');
  let tocOpen = $state(false);
  /** Expand/collapse state for nested ToC branches (default: top-level open). */
  let tocExpanded = $state<Record<string, boolean>>({});
  let readingPane = $state<HTMLElement | undefined>();
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
  /**
   * Document-order index in `sectionCorpus`.
   * `sections` is only the painted prefix, and painting can reorder the corpus,
   * so `data-read-pos` must follow the corpus index `scrollToSection` queries.
   */
  const sectionReadPos = $derived.by(() => {
    // `sections` is the reactive signal publishPainted updates with the corpus.
    const painted = sections;
    const corpus = sectionCorpus.length ? sectionCorpus : painted;
    const map = new Map<string, number>();
    for (let i = 0; i < corpus.length; i++) map.set(corpus[i]!.id, i);
    return map;
  });
  const paintedSections = $derived(sections);
  const readerGroups = $derived(
    $verseStyling
      ? groupReaderSections(paintedSections)
      : paintedSections.map((ev) => ({ kind: 'block' as const, event: ev }))
  );
  const moreToPaint = $derived(paintLimit < corpusCount);
  const canRead = $derived(!!event && hasPublicationSection(event) && !textUnavailable);
  const urlFocusQuote = $derived((new URLSearchParams($querystring ?? '').get('quote') ?? '').trim());
  const urlFocusComment = $derived(
    (new URLSearchParams($querystring ?? '').get('comment') ?? '').trim().toLowerCase()
  );

  function cancelTree(): void {
    treeAbort?.abort();
    treeAbort = null;
    clearAdoptFlush();
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
    if (!toc.length || !sectionCorpus.length) return;
    // Indexes only — never walk tens of thousands of verse leaves into the ToC.
    const indexes: Event[] = [];
    for (const e of sectionCorpus) {
      if (e.kind === KIND.PUBLICATION) indexes.push(e);
    }
    if (!indexes.length) return;
    toc = expandTocFromSections(toc, indexes);
  }

  function publishPainted(edition: Event, reorder: boolean): void {
    if (reorder && sectionCorpus.length > 1) {
      // Cap DFS work: only walk far enough for the painted window.
      sectionCorpus = orderPublicationSections(sectionCorpus, {
        root: edition,
        toc,
        limit: Math.max(paintLimit + 40, 160)
      });
    }
    corpusCount = sectionCorpus.length;
    sections = sectionCorpus.slice(0, Math.min(paintLimit, sectionCorpus.length));
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
      publishPainted(ed, doReorder);
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

  const PAINT_STEP = 80;

  function extendPaint(): void {
    if (paintLimit >= sectionCorpus.length) return;
    paintLimit = Math.min(sectionCorpus.length, paintLimit + PAINT_STEP);
    if (event) publishPainted(event, true);
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
    const need = Math.min(sectionCorpus.length, index + PAINT_STEP);
    if (need <= paintLimit) return;
    paintLimit = need;
    if (event) publishPainted(event, reorder);
  }

  /**
   * Extend the painted prefix so `index` is mounted.
   * Reordering inside publishPainted can move `sectionId` past that prefix;
   * a second pass paints its new corpus index without reordering again.
   */
  function ensurePaintedThrough(index: number, sectionId?: string): void {
    if (index < 0 && !sectionId) return;
    paintThrough(index, true);
    if (!sectionId) return;
    const moved = sectionCorpus.findIndex((s) => s.id === sectionId);
    if (moved >= paintLimit) paintThrough(moved, false);
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

  /** After header + social are on screen, warm Mercury /meta → /toc → /stream (cancellable). */
  async function afterSocialPrefetchTree(target: Event): Promise<void> {
    cancelTree();
    treeAbort = new AbortController();
    const signal = treeAbort.signal;
    try {
      await fetchSocial(target);
    } catch {
      /* social is best-effort */
    }
    if (signal.aborted || event?.id !== target.id) return;
    // Catalog stubs: ratings/comments only — never hit /meta|/toc|/stream.
    if (textUnavailable || !hasPublicationSection(target)) return;
    void prefetchTree(target, signal);
  }

  /** Mercury /stream often omits leaves; fall back to a document-stack a-tag walk when the
   * stream is empty. Never walk after a wide index-only Mercury result — Bible-sized
   * trees stampede relays and freeze the reader for minutes. */
  async function loadSectionEvents(
    edition: Event,
    signal?: AbortSignal,
    onBatch?: (batch: Event[]) => void
  ): Promise<Event[]> {
    let streamed: Event[] = [];
    if (!isMercuryUnavailable()) {
      try {
        streamed = await mercuryPublicationStream(
          naddrFor(edition),
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
    if (streamed.some((e) => e.kind !== KIND.PUBLICATION)) return streamed;
    const indexCount = streamed.filter((e) => e.kind === KIND.PUBLICATION).length;
    // Mercury returned structure only (e.g. Intro/OT/NT). ToC jump loads leaves on demand.
    if (indexCount >= 3) return streamed;
    const walked = await fallbackSections(edition, {
      signal,
      onHit: (hit) => onBatch?.([hit])
    });
    if (signal?.aborted) return streamed;
    return mergePublicationSections(streamed, walked);
  }

  /** Document-stack / memory walk only (features/reader/read.feature fallback). */
  async function fallbackSections(
    target: Event,
    opts?: { onHit?: (event: Event) => void; signal?: AbortSignal }
  ): Promise<Event[]> {
    const onHit = opts?.onHit;
    const signal = opts?.signal;
    const out: Event[] = [];
    const seen = new Set<string>();
    const WALK_CONCURRENCY = 4;
    const MAX_EVENTS = 2_500;

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
      let hit = memoryFindByAddress(kind, pubkey, d);
      if (!hit) {
        const w = await relayPool.query(
          documentStack(),
          [{ kinds: [kind], authors: [pubkey], '#d': [d], limit: 1 }],
          8_000,
          3
        );
        hit = w[0] ?? null;
      }
      if (!hit || !claim(hit)) return;
      if (hit.kind === KIND.PUBLICATION) await expandChildren(hit);
    }

    async function pushId(id: string): Promise<void> {
      if (signal?.aborted || out.length >= MAX_EVENTS) return;
      const key = id.toLowerCase();
      if (seen.has(key)) return;
      let hit = memoryGetEvent(key);
      if (!hit) {
        const w = await relayPool.query(documentStack(), [{ ids: [key], limit: 1 }], 8_000, 3);
        hit = w[0] ?? null;
      }
      if (!hit || !claim(hit)) return;
      if (hit.kind === KIND.PUBLICATION) await expandChildren(hit);
    }

    async function expandChildren(ev: Event): Promise<void> {
      if (signal?.aborted || out.length >= MAX_EVENTS) return;
      const coords: string[] = [];
      const ids: string[] = [];
      for (const tag of ev.tags) {
        if (tag[0] === 'a' && tag[1]) coords.push(tag[1]);
        else if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) ids.push(tag[1]);
      }
      if (coords.length) await poolMap(coords.slice(0, 400), WALK_CONCURRENCY, pushCoord);
      if (ids.length) await poolMap(ids.slice(0, 400), WALK_CONCURRENCY, pushId);
    }

    // Root edition is the reading-pane top heading; walk its children (not the root itself).
    seen.add(target.id);
    await expandChildren(target);
    return out;
  }

  function focusFromUrl(): {
    section: string;
    quote: string;
    comment: string;
    rating: string;
    read: boolean;
  } {
    const q = new URLSearchParams($querystring ?? '');
    return {
      section: (q.get('section') ?? '').trim(),
      quote: (q.get('quote') ?? '').trim(),
      comment: (q.get('comment') ?? '').trim().toLowerCase(),
      rating: (q.get('rating') ?? '').trim().toLowerCase(),
      read: q.get('read') === '1'
    };
  }

  function hashPathOnly(): string {
    return window.location.hash.replace(/^#/, '').split('?')[0] || (event ? publicationPath(event) : '');
  }

  /** Sync ?read=1 without clobbering other deep-link params. */
  function setReadQuery(on: boolean): void {
    const q = new URLSearchParams($querystring ?? '');
    const has = q.get('read') === '1';
    if (on === has) return;
    if (on) q.set('read', '1');
    else q.delete('read');
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
      limit: Math.max(paintLimit + 40, 160)
    });
  }

  function freezeTocFromSections(list: Event[]): void {
    if (toc.length || !list.length) return;
    toc = enrichToc([], list);
  }

  async function ensureToc(edition: Event): Promise<void> {
    if (toc.length) return;
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
    if (paintLimit < 100 && sectionCorpus.length) {
      paintLimit = Math.min(100, sectionCorpus.length);
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

  /** Load ToC + first heading immediately, then stream/walk sections into the pane. */
  async function fillReadingSections(edition: Event): Promise<boolean> {
    readingBusy = true;
    cancelTree();
    treeAbort = new AbortController();
    const signal = treeAbort.signal;
    try {
      await ensureToc(edition);
      if (signal.aborted || event?.id !== edition.id) return false;
      // First viewport: edition heading + ToC shell (readable without the entire book).
      adoptSections([edition], edition);
      readingBusy = false;

      // Do not await the full Mercury/relay pull — large pubs can stream for a long time.
      void loadSectionEvents(edition, signal, (batch) => {
        if (signal.aborted || event?.id !== edition.id || !reading) return;
        scheduleAdopt(batch, edition);
      }).then(() => {
        if (signal.aborted || event?.id !== edition.id || !reading) return;
        scheduleAdopt([], edition, true);
        if (!sectionCorpus.length) {
          unreadable = true;
          reading = false;
          setReadQuery(false);
        }
      });
      return true;
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

  async function openFocusedReading(sectionAddr: string, quote: string): Promise<void> {
    if (!event || unreadable || !canRead) return;
    const key = `${sectionAddr}\0${quote}`;
    focusKey = key;
    reading = true;
    readingBusy = true;
    const focusAddr = sectionAddr;
    const focusQuote = quote;
    const edition = event;
    try {
      const parsed = parseAddress(focusAddr);
      let focused: Event | null = null;
      if (parsed) {
        focused =
          memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d) ??
          (await fetchByAddress(focusAddr));
      }
      if (focusKey !== key || event !== edition) return;

      if (!toc.length) {
        try {
          const rawToc = await mercuryPublicationToc(naddrFor(edition));
          if (focusKey !== key || event !== edition) return;
          toc = parseToc(rawToc, edition);
        } catch {
          if (focusKey !== key || event !== edition) return;
          toc = parseToc(null, edition);
        }
      }

      if (focused) {
        rememberEvents([focused]);
        adoptSections([focused], edition);
        void enrichHighlightsFromSections([focused]);
        readingBusy = false;
        queueMicrotask(() => {
          scrollToSection(0, focused!.id, eventAddress(focused!));
          if (focusQuote) scrollToHighlightQuote(focusQuote);
        });
      }

      const entry = toc.find((t) => t.address === focusAddr);
      let streamed: Event[] = [];
      try {
        if (entry && Number.isFinite(entry.pos)) {
          streamed = await mercuryPublicationStream(naddrFor(edition), entry.pos);
        }
        if (!streamed.length) {
          streamed = await mercuryPublicationStream(naddrFor(edition));
        }
      } catch {
        streamed = [];
      }
      if (focusKey !== key || event !== edition) return;
      if (!streamed.some((e) => e.kind !== KIND.PUBLICATION)) {
        streamed = mergeSections(
          streamed,
          await fallbackSections(edition, {
            onHit: (hit) => {
              if (focusKey !== key || event !== edition) return;
              adoptSections(mergeSections(sections, [hit]), edition);
            }
          })
        );
      }
      if (focusKey !== key || event !== edition) return;
      if (streamed.length) {
        adoptSections(mergeSections(focused ? [focused] : [], streamed), edition);
        void enrichHighlightsFromSections(sections);
      } else if (focused) {
        adoptSections([focused], edition);
      }

      if (focused || sections.length) {
        queueMicrotask(() => {
          const scrollId = focused?.id ?? sections.find((s) => eventAddress(s) === focusAddr)?.id;
          scrollToSection(entry?.pos ?? 0, scrollId, focusAddr);
          if (focusQuote) scrollToHighlightQuote(focusQuote);
        });
      } else {
        unreadable = true;
        reading = false;
      }
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
      void openFocusedReading(focus.section, focus.quote);
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
      if (!reading && canRead && !unreadable && !textUnavailable) {
        void startReading({ fromUrl: true });
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
    error = false;
    unreadable = false;
    textUnavailable = !hasPublicationSection(target);
    loading = false;
    cancelTree();
    // Catalog stubs (no section a/e tags) are library cards only — no tree to fetch.
    // Readable editions: social first, then Mercury tree in the background (no a-tag walk).
    void afterSocialPrefetchTree(target);
  }

  $effect(() => {
    // Prefer router params; fall back to the hash so a stale/empty params object
    // never skips the memory paint and flashes "Publication is loading...".
    const hashPath =
      typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '').split('?')[0] : '';
    const hashDnpub = hashPath.match(/^\/publication\/d\/([^/]+)\/p\/([^/]+)\/?$/);
    const hashDonly = hashPath.match(/^\/publication\/d\/([^/]+)\/?$/);
    const hashPointer = hashPath.match(
      /^\/publication\/((?:naddr|nevent|note)1[02-9ac-hj-np-z]+)\/?$/i
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
      corpusCount = 0;
      toc = [];
      paintLimit = 100;
      focusKey = '';
      commentFocusApplied = '';
      replyOpenId = null;
      cancelTree();
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
      cancelTree();
    };
  });

  onDestroy(() => cancelTree());

  $effect(() => {
    // Re-apply deep links (?section=&quote=, ?comment=, ?rating=, or plain path → top).
    if (!event || loading) return;
    void $querystring;
    applyUrlFocus();
  });

  async function startReading(opts?: { fromUrl?: boolean }): Promise<void> {
    if (!event || unreadable || !canRead) return;
    // URL sync can re-enter; ignore if we are already in (or entering) the reader.
    if (reading && opts?.fromUrl) return;
    reading = true;
    if (!opts?.fromUrl) setReadQuery(true);
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
    if (resume) {
      queueMicrotask(() => scrollToSection(resume.pos, resume.sectionId));
    }
  }

  /** Leave the reader and restore the edition info page (ratings, comments, details). */
  function stopReading(): void {
    if (!reading) return;
    reading = false;
    tocOpen = false;
    jumpBusy = false;
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
        const offset = Math.ceil((topBar?.getBoundingClientRect().height ?? 72) + 16);
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
    const hit = findLoadedSection(entry);
    return !!hit && !isPlaceholderIndex(hit);
  }

  /** Leaf sections stay disabled until in the pane; nested 30040 headings stay jumpable. */
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
    const loaded = findLoadedSection(entry);
    if (loaded && !isPlaceholderIndex(loaded)) return loaded;
    if (entry.address) {
      const parsed = parseAddress(entry.address);
      if (parsed) {
        const hit =
          memoryFindByAddress(parsed.kind, parsed.pubkey, parsed.d) ??
          (await fetchByAddress(entry.address));
        if (hit) return hit;
      }
    }
    if (entry.id) {
      const byId = memoryGetEvent(entry.id) ?? (await fetchById(entry.id));
      if (byId) return byId;
    }
    // Keep an existing placeholder, or synthesize one for true ghost Mercury rows.
    if (loaded) return loaded;
    if (entry.index) return placeholderIndexEvent(entry);
    return null;
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function cyclePageFind(): void {
    if (readingPane) pageFind.next(readingPane);
  }

  async function jumpTo(entry: TocEntry): Promise<void> {
    tocOpen = false;
    if (!event || unreadable || !canRead) return;

    const existing = findLoadedSection(entry);
    if (existing) {
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
        rememberEvents([focused]);
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
      try {
        if (Number.isFinite(entry.pos)) {
          streamed = await mercuryPublicationStream(naddrFor(edition), entry.pos);
        }
        if (!streamed.length) {
          streamed = await mercuryPublicationStream(naddrFor(edition));
        }
      } catch {
        streamed = [];
      }
      if (focusKey !== key || event !== edition) return;
      if (!streamed.some((e) => e.kind !== KIND.PUBLICATION)) {
        streamed = mergeSections(
          streamed,
          await fallbackSections(edition, {
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
    saveResume(eventAddress(event), { pos, sectionId: section.id });
  }

  /** Resume tracking without a11y listeners on non-interactive verse/section markup. */
  $effect(() => {
    const root = readingPane;
    if (!reading || !root || !moreToPaint) return;
    const onScroll = () => {
      const room = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      if (room < 1200) extendPaint();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
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

  async function saveHighlight(section: Event): Promise<void> {
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    const sel = window.getSelection();
    const quote = sel?.toString().trim() ?? '';
    if (!quote) return;
    let context: string | undefined;
    try {
      const node = sel?.anchorNode;
      const el =
        node instanceof Element ? node : node?.parentElement;
      const block = el?.closest('p, li, blockquote, pre, div.paragraph, article');
      const full = block?.textContent?.trim();
      if (full && full !== quote && full.includes(quote)) context = full.slice(0, 500);
    } catch {
      /* ignore */
    }
    if (!event) return;
    const signed = await signAndPublish(highlightDraft(event, section, quote, context));
    if (signed) {
      const mine = session
        .getMetadata()
        .find((e) => e.kind === KIND.METADATA && e.pubkey.toLowerCase() === signed.pubkey.toLowerCase());
      seedHighlightProfile(signed.pubkey, mine ?? null);
      highlights = [signed, ...highlights.filter((h) => h.id !== signed.id)];
      void ingestLocalLandingHighlight(signed, event);
    }
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

<TopBar />
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
        <div class="edition-actions">
          <ShelfActions publication={event} />
          {#if canRead}
            <button class="btn btn-primary" type="button" onclick={() => void startReading()}
              >Read the publication</button
            >
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
            <h2>Contents</h2>
            <TocPanel
              nodes={tocTree}
              expanded={tocExpanded}
              isLoaded={tocEntryLoaded}
              isDisabled={tocEntryDisabled}
              onToggle={toggleTocBranch}
              onJump={(entry) => void jumpTo(entry)}
            />
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
          {#each readerGroups as group, gi (group.kind === 'bible' ? `bible-${group.verses[0]?.id}` : group.event.id)}
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
              {@const heroUrl = readerSectionHeroUrl(section, event)}
              {@const pos = sectionReadPos.get(section.id) ?? gi}
              <article
                class="reader-section"
                class:reader-index={isIndex}
                class:reader-edition={!!event && section.id === event.id}
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
                    <div class="edition-actions reader-info-actions">
                      <button class="btn btn-primary" type="button" onclick={stopReading}
                        >Publication info</button
                      >
                    </div>
                  {/if}
                {:else if isMarkupKind(section.kind)}
                  <div>
                    <EventBody event={section} quotes={quotesFor(section)} />
                  </div>
                {:else}
                  <EventCard event={section} />
                {/if}
                {#if !isIndex}
                <div class="section-toolbar">
                  <CopyPointerButton event={section}>
                    {#snippet before()}
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
                Showing {paintedSections.length} of {corpusCount} sections
              </p>
              <button class="btn" type="button" onclick={extendPaint}>Show more</button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {:else if loading}
    <p class="loading-hint">Publication is loading...</p>
  {/if}
</main>
