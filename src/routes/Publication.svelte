<script lang="ts">
  import { onDestroy } from 'svelte';
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
  import EditionHeader from '$lib/components/EditionHeader.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import { KIND } from '$lib/constants';
  import { publicationPath, hasPublicationSection } from '$lib/metadata';
  import { muteState, filterMuted } from '$lib/mute';
  import { createPageFindController, filterPageEvents } from '$lib/page-filter';
  import { mercuryFilter, mercuryPublicationMeta, mercuryPublicationStream, mercuryPublicationToc } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { documentStack, socialStack } from '$lib/nostr/selector';
  import { eventAddress, isTopLevel30040 } from '$lib/nostr/verify';
  import { fetchById, fetchPublication, fetchByAddress } from '$lib/nostr/fetch';
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
  import { loadResume, saveResume } from '$lib/resume';
  import { isLibraryCopyPubkey } from '$lib/hex';
  import {
    decodePublicationPointer,
    enrichToc,
    hexFromNpubParam,
    isUnreadableMeta,
    naddrFor,
    parseToc,
    sectionHeading,
    type TocEntry
  } from '$lib/publication-load';
  import { searchByDTag } from '$lib/search';
  import { normalizeDTag } from '$lib/dtag';
  import { parseAddress } from '$lib/library-scope';

  interface Props {
    params?: { d?: string; npub?: string; naddr?: string };
  }

  let { params = {} }: Props = $props();

  let event = $state<Event | null>(null);
  let editions = $state<Event[]>([]);
  let ratings = $state<Event[]>([]);
  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let reading = $state(false);
  let sections = $state<Event[]>([]);
  let toc = $state<TocEntry[]>([]);
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
  let sectionMenuOpen = $state<string | null>(null);
  let sectionCommentsOpen = $state<Record<string, boolean>>({});
  let treeAbort: AbortController | null = null;
  let pageFilter = $state('');
  let readingBusy = $state(false);
  /** ToC jump to a section that is not in the pane yet. */
  let jumpBusy = $state(false);
  let jumpLabel = $state('');
  let tocOpen = $state(false);
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
  const canRead = $derived(!!event && hasPublicationSection(event) && !textUnavailable);
  const urlFocusQuote = $derived((new URLSearchParams($querystring ?? '').get('quote') ?? '').trim());
  const urlFocusComment = $derived(
    (new URLSearchParams($querystring ?? '').get('comment') ?? '').trim().toLowerCase()
  );

  function cancelTree(): void {
    treeAbort?.abort();
    treeAbort = null;
  }

  async function fetchSocial(target: Event): Promise<void> {
    const a = eventAddress(target);
    const ratingKeys = publicationRatingATagsForQuery(target);
    const sectionAddrs = target.tags
      .filter((t) => t[0] === 'a' && t[1])
      .flatMap((t) => publicationCoordinateLookupKeys(t[1]!));
    const highlightAddrs = [...new Set([a, ...sectionAddrs, ...publicationCoordinateLookupKeys(a)])];
    const [rA, rA2, threadEvents, ...highlightBatches] = await Promise.all([
      relayPool.query(socialStack(), [{ kinds: [KIND.RATING], '#a': ratingKeys, limit: 50 }]),
      relayPool.query(socialStack(), [{ kinds: [KIND.RATING], '#A': ratingKeys, limit: 50 }]),
      fetchThreadEvents(target, 80),
      ...chunk(highlightAddrs, 20).map((batch) =>
        relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#a': batch, limit: 80 }])
      )
    ]);
    const ratingById = new Map<string, Event>();
    for (const e of [...rA, ...rA2]) ratingById.set(e.id, e);
    ratings = [...ratingById.values()];
    comments = threadEvents;
    const hById = new Map<string, Event>();
    for (const batch of highlightBatches) {
      for (const e of batch) hById.set(e.id, e);
    }
    highlights = [...hById.values()];
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
      if (isUnreadableMeta(meta)) {
        // Index meta can mark a tree missing; keep Read when the 30040 itself lists sections.
        if (!hasPublicationSection(target)) textUnavailable = true;
        return;
      }
      const rawToc = await mercuryPublicationToc(naddr, signal);
      if (signal.aborted) return;
      toc = parseToc(rawToc, target);
      const streamed = await mercuryPublicationStream(naddr, undefined, signal);
      if (signal.aborted) return;
      if (streamed.length) {
        sections = streamed;
        freezeTocFromSections(streamed);
        void enrichHighlightsFromSections(streamed);
      }
    } catch {
      if (signal.aborted) return;
    }
  }

  async function fallbackSections(target: Event): Promise<Event[]> {
    const out: Event[] = [];
    const seen = new Set<string>();

    async function pushCoord(coord: string): Promise<void> {
      const parts = coord.split(':');
      const kind = Number(parts[0]);
      const pubkey = parts[1];
      const d = parts.slice(2).join(':');
      if (!kind || !pubkey || !d) return;
      // Nested 30040 indexes are walked for their children, not shown as bodies.
      if (kind === KIND.PUBLICATION) {
        const [m, w] = await Promise.all([
          mercuryFilter({ kinds: [kind], authors: [pubkey], '#d': [d], limit: 1 }),
          relayPool.query(documentStack(), [{ kinds: [kind], authors: [pubkey], '#d': [d], limit: 1 }])
        ]);
        const nested = m[0] ?? w[0];
        if (!nested || seen.has(nested.id)) return;
        seen.add(nested.id);
        for (const tag of nested.tags) {
          if (tag[0] === 'a' && tag[1]) await pushCoord(tag[1]);
          else if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) await pushId(tag[1]);
        }
        return;
      }
      const [m, w] = await Promise.all([
        mercuryFilter({ kinds: [kind], authors: [pubkey], '#d': [d], limit: 1 }),
        relayPool.query(documentStack(), [{ kinds: [kind], authors: [pubkey], '#d': [d], limit: 1 }])
      ]);
      const hit = m[0] ?? w[0];
      if (!hit || seen.has(hit.id)) return;
      seen.add(hit.id);
      out.push(hit);
    }

    async function pushId(id: string): Promise<void> {
      const key = id.toLowerCase();
      if (seen.has(key)) return;
      const hit = memoryGetEvent(key) ?? (await fetchById(key));
      if (!hit || seen.has(hit.id)) return;
      seen.add(hit.id);
      if (hit.kind === KIND.PUBLICATION) {
        for (const tag of hit.tags) {
          if (tag[0] === 'a' && tag[1]) await pushCoord(tag[1]);
          else if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) await pushId(tag[1]);
        }
        return;
      }
      out.push(hit);
    }

    let n = 0;
    for (const tag of target.tags) {
      if (n >= 80) break;
      if (tag[0] === 'a' && tag[1]) {
        await pushCoord(tag[1]);
        n += 1;
      } else if (tag[0] === 'e' && tag[1] && /^[0-9a-f]{64}$/i.test(tag[1])) {
        await pushId(tag[1]);
        n += 1;
      }
    }
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

  function mergeSections(primary: Event[], rest: Event[]): Event[] {
    const byId = new Map<string, Event>();
    for (const e of [...primary, ...rest]) byId.set(e.id, e);
    return [...byId.values()];
  }

  function orderSectionsByToc(list: Event[], entries: TocEntry[]): Event[] {
    if (list.length < 2) return list;
    const rank = new Map<string, number>();
    for (const e of entries) {
      if (e.address) rank.set(e.address.toLowerCase(), e.pos);
      if (e.id) rank.set(e.id.toLowerCase(), e.pos);
    }
    // Stable: unranked leaves keep stream order (important when /toc is index-only).
    return [...list]
      .map((event, i) => ({
        event,
        i,
        r:
          rank.get(eventAddress(event).toLowerCase()) ??
          rank.get(event.id.toLowerCase()) ??
          1_000_000_000 + i
      }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((row) => row.event);
  }

  function freezeTocFromSections(list: Event[]): void {
    if (toc.length || !list.length) return;
    toc = enrichToc([], list);
  }

  let focusKey = '';

  async function ensureReadingSections(): Promise<boolean> {
    if (!event || unreadable || !canRead) return false;
    reading = true;
    if (sections.length) return true;
    readingBusy = true;
    try {
      try {
        sections = await mercuryPublicationStream(naddrFor(event));
      } catch {
        sections = [];
      }
      if (!sections.length) sections = await fallbackSections(event);
      if (sections.length) {
        freezeTocFromSections(sections);
        void enrichHighlightsFromSections(sections);
      }
      if (!toc.length) toc = parseToc(null, event);
      freezeTocFromSections(sections);
      if (!sections.length) {
        unreadable = true;
        reading = false;
        return false;
      }
      return true;
    } finally {
      readingBusy = false;
    }
  }

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
      if (focused) {
        rememberEvents([focused]);
        sections = [focused];
        freezeTocFromSections(sections);
        void enrichHighlightsFromSections([focused]);
        readingBusy = false;
        queueMicrotask(() => {
          scrollToSection(0, focused!.id, eventAddress(focused!));
          if (focusQuote) scrollToHighlightQuote(focusQuote);
        });
      }

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
      if (!streamed.length) streamed = await fallbackSections(edition);
      if (focusKey !== key || event !== edition) return;
      if (streamed.length) {
        sections = orderSectionsByToc(mergeSections(focused ? [focused] : [], streamed), toc);
        freezeTocFromSections(sections);
        void enrichHighlightsFromSections(sections);
      }
      if (!toc.length) toc = parseToc(null, edition);
      freezeTocFromSections(sections);

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

  function paintEdition(target: Event): void {
    rememberEvents([target]);
    event = target;
    error = false;
    unreadable = false;
    textUnavailable = !hasPublicationSection(target);
    loading = false;
    void fetchSocial(target);
    cancelTree();
    // Catalog stubs (no section a/e tags) are library cards only — no tree to fetch.
    if (textUnavailable) return;
    treeAbort = new AbortController();
    void prefetchTree(target, treeAbort.signal);
  }

  $effect(() => {
    const dTag = params.d;
    const npubParam = params.npub;
    const pointer = params.naddr;
    let cancelled = false;

    editions = [];
    reading = false;
    tocOpen = false;
    sections = [];
    toc = [];
    focusKey = '';
    commentFocusApplied = '';
    replyOpenId = null;
    cancelTree();
    error = false;
    unreadable = false;

    // Hash navigations keep the previous page's scroll — reset unless a deep-link will re-scroll.
    const q = new URLSearchParams(
      typeof window !== 'undefined' ? (window.location.hash.split('?')[1] ?? '') : ''
    );
    const deep =
      q.has('comment') || q.has('rating') || q.has('section') || q.has('quote') || q.get('read') === '1';
    if (!deep) {
      queueMicrotask(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    }

    const pubkey = npubParam ? hexFromNpubParam(npubParam) : '';
    const slug = dTag ? normalizeDTag(dTag) || dTag : '';
    const warm =
      dTag && npubParam && pubkey
        ? memoryFindByAddress(KIND.PUBLICATION, pubkey, slug)
        : null;

    if (warm) {
      // Already had this event on a shelf/search card — show header before any I/O.
      paintEdition(warm);
    } else {
      event = null;
      textUnavailable = false;
      loading = true;
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
          // Cover/search already showed this event — paint from memory/cache only.
          // Do not REQ the same 30040 from relays just to render the header.
          const cached = warm ?? (await cacheFindByAddress(KIND.PUBLICATION, pubkey, slug));
          if (cancelled) return;
          if (cached) {
            if (!warm || cached.created_at > warm.created_at) paintEdition(cached);
            return;
          }
          const fetched = await fetchPublication(slug, pubkey);
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
      readingBusy = true;
      try {
        try {
          sections = await mercuryPublicationStream(naddrFor(event));
        } catch {
          sections = [];
        }
        if (!sections.length) sections = await fallbackSections(event);
        if (sections.length) {
          freezeTocFromSections(sections);
          void enrichHighlightsFromSections(sections);
        }
        if (!toc.length) toc = parseToc(null, event);
        freezeTocFromSections(sections);
        if (!sections.length) {
          unreadable = true;
          reading = false;
          setReadQuery(false);
          return;
        }
      } finally {
        readingBusy = false;
      }
    }
    const resume = loadResume(eventAddress(event));
    if (resume) {
      queueMicrotask(() => scrollToSection(resume.pos, resume.sectionId));
    }
  }

  function scrollToSection(pos: number, sectionId?: string, address?: string): void {
    const el =
      (sectionId ? document.getElementById(`section-${sectionId}`) : null) ??
      (address
        ? document.querySelector(`[data-section-addr="${CSS.escape(address)}"] .section-heading`) ??
          document.querySelector(`[data-section-addr="${CSS.escape(address)}"]`)
        : null) ??
      document.querySelector(`[data-read-pos="${pos}"] .section-heading`) ??
      document.querySelector(`[data-read-pos="${pos}"]`);
    if (!el) return;
    const topBar = document.querySelector('.top-bar');
    const offset = Math.ceil((topBar?.getBoundingClientRect().height ?? 72) + 16);
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  }

  function findLoadedSection(entry: TocEntry): Event | undefined {
    return sections.find(
      (s) =>
        (entry.id && s.id === entry.id) ||
        (entry.address != null && entry.address !== '' && eventAddress(s) === entry.address)
    );
  }

  function tocEntryLoaded(entry: TocEntry): boolean {
    return !!findLoadedSection(entry);
  }

  /** Leaf sections stay disabled until in the pane; nested 30040 headings stay jumpable. */
  function tocEntryDisabled(entry: TocEntry): boolean {
    if (jumpBusy) return true;
    if (entry.index) return false;
    return !tocEntryLoaded(entry);
  }

  async function resolveTocSection(entry: TocEntry): Promise<Event | null> {
    const loaded = findLoadedSection(entry);
    if (loaded) return loaded;
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
      return memoryGetEvent(entry.id) ?? (await fetchById(entry.id));
    }
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
        const merged = mergeSections(sections, [focused]);
        sections = orderSectionsByToc(merged, toc);
        freezeTocFromSections(sections);
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
      if (!streamed.length && !focused) {
        streamed = await fallbackSections(edition);
      }
      if (focusKey !== key || event !== edition) return;

      if (streamed.length || focused) {
        const merged = mergeSections(sections, streamed);
        sections = orderSectionsByToc(merged, toc);
        freezeTocFromSections(sections);
        void enrichHighlightsFromSections(sections);
        if (!toc.length) toc = parseToc(null, edition);
        freezeTocFromSections(sections);
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

  function rememberPos(pos: number, section: Event): void {
    if (!event) return;
    saveResume(eventAddress(event), { pos, sectionId: section.id });
  }

  async function loadSectionComments(section: Event): Promise<void> {
    const a = eventAddress(section);
    if (sectionComments[a]) return;
    sectionComments = { ...sectionComments, [a]: await fetchThreadEvents(section, 40) };
  }

  async function postComment(): Promise<void> {
    if (!event) return;
    if (!$session.pubkey) {
      await session.signIn();
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
      await session.signIn();
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
      await session.signIn();
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
    const signed = await signAndPublish(highlightDraft(section, quote, context));
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
        <EditionHeader {event} />
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

      <RatingPanel
        ratings={visibleRatings}
        publication={event}
        focusId={(new URLSearchParams($querystring ?? '').get('rating') ?? '').trim().toLowerCase()}
      />

      <section class="card" style="margin-bottom:1rem">
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
          <button class="btn" type="button" onclick={() => session.signIn()}>Sign in to comment</button>
        {/if}
      </section>
    {:else}
      <div class="reader-layout">
        {#if readerToc.length}
          <nav class="toc card" class:toc-open={tocOpen}>
            <h2>Contents</h2>
            <ul>
              {#each readerToc as entry}
                {@const loaded = tocEntryLoaded(entry)}
                {@const unavailable = tocEntryDisabled(entry)}
                <li
                  class:toc-index={!!entry.index}
                  class:toc-unloaded={!loaded}
                  style={entry.depth ? `padding-left: ${entry.depth * 0.85}rem` : undefined}
                >
                  <button
                    class="btn"
                    class:toc-index-btn={!!entry.index}
                    type="button"
                    disabled={unavailable}
                    title={loaded ? undefined : entry.index ? 'Open this part' : 'Not loaded yet'}
                    onclick={() => void jumpTo(entry)}>{entry.title}</button
                  >
                </li>
              {/each}
            </ul>
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
          {#if jumpBusy && !sections.length}
            <p class="loading-hint jump-busy" aria-hidden="true">
              <span class="jump-busy-spinner" aria-hidden="true"></span>
              Opening “{jumpLabel || 'section'}”…
            </p>
          {:else if readingBusy || !sections.length}
            <p class="loading-hint">Publication is loading...</p>
          {/if}
          {#each sections as section, i (section.id)}
            {@const sectionKey = eventAddress(section)}
            {@const pos =
              readerToc.find((e) => e.id === section.id || e.address === sectionKey)?.pos ?? i}
            <article
              class="reader-section"
              data-read-pos={pos}
              data-section-addr={sectionKey}
              data-section-id={section.id}
            >
              <h2 class="section-heading" id={`section-${section.id}`}>{sectionHeading(section)}</h2>
              {#if isMarkupKind(section.kind)}
                <div
                  role="presentation"
                  onmouseup={() => rememberPos(pos, section)}
                >
                  <EventBody event={section} quotes={quotesFor(section)} />
                </div>
              {:else}
                <EventCard event={section} />
              {/if}
              <div class="section-toolbar">
                <div class="menu-wrap">
                  <button
                    class="btn btn-icon"
                    type="button"
                    aria-label="Section actions"
                    aria-expanded={sectionMenuOpen === sectionKey}
                    title="More"
                    onclick={() => {
                      sectionMenuOpen = sectionMenuOpen === sectionKey ? null : sectionKey;
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="5" cy="12" r="1.75" />
                      <circle cx="12" cy="12" r="1.75" />
                      <circle cx="19" cy="12" r="1.75" />
                    </svg>
                  </button>
                  {#if sectionMenuOpen === sectionKey}
                    <ul class="menu-panel menu-panel-end" role="menu">
                      <li>
                        {#if $session.pubkey}
                          <button
                            class="menu-item"
                            type="button"
                            onclick={() => {
                              sectionMenuOpen = null;
                              void saveHighlight(section);
                            }}
                          >
                            Save highlight
                          </button>
                        {:else}
                          <button
                            class="menu-item"
                            type="button"
                            onclick={() => {
                              sectionMenuOpen = null;
                              void session.signIn();
                            }}
                          >
                            Sign in to highlight
                          </button>
                        {/if}
                      </li>
                      <li>
                        <button
                          class="menu-item"
                          type="button"
                          onclick={() => {
                            sectionMenuOpen = null;
                            const open = !sectionCommentsOpen[sectionKey];
                            sectionCommentsOpen = { ...sectionCommentsOpen, [sectionKey]: open };
                            if (open) void loadSectionComments(section);
                          }}
                        >
                          {sectionCommentsOpen[sectionKey] ? 'Hide comments' : 'Comments'}
                        </button>
                      </li>
                    </ul>
                  {/if}
                </div>
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
                    <button class="btn" type="button" onclick={() => session.signIn()}
                      >Sign in to comment</button
                    >
                  {/if}
                </div>
              {/if}
            </article>
          {/each}
        </div>
      </div>
    {/if}
  {:else if loading}
    <p class="loading-hint">Publication is loading...</p>
  {/if}
</main>
