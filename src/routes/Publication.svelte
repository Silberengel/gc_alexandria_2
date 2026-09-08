<script lang="ts">
  import { onDestroy } from 'svelte';
  import { replace } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import TopBar from '$lib/components/TopBar.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
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
  import { fetchById, fetchPublication } from '$lib/nostr/fetch';
  import { cacheFindByAddress } from '$lib/nostr/cache';
  import { memoryFindByAddress, memoryGetEvent, rememberEvents } from '$lib/nostr/event-memory';
  import { nestComments } from '$lib/comments';
  import { newestRatingPerAuthor, publicationRatingATagsForQuery } from '$lib/ratings';
  import { commentDraft, highlightDraft } from '$lib/drafts';
  import { publicationCoordinateLookupKeys } from '$lib/publication-coordinate';
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
  let sectionCommentText = $state<Record<string, string>>({});
  let sectionComments = $state<Record<string, Event[]>>({});
  let treeAbort: AbortController | null = null;
  let pageFilter = $state('');
  let readingBusy = $state(false);
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
  const visibleHighlights = $derived(filterPageEvents(mutedHighlights, pageFilter));
  const visibleEditions = $derived(filterPageEvents(editions, pageFilter));
  const thread = $derived(nestComments(visibleComments, $muteState));
  const readerToc = $derived(enrichToc(toc, sections));
  const canRead = $derived(!!event && hasPublicationSection(event) && !textUnavailable);

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
    const [rA, rA2, cA, cA2, ...highlightBatches] = await Promise.all([
      relayPool.query(socialStack(), [{ kinds: [KIND.RATING], '#a': ratingKeys, limit: 50 }]),
      relayPool.query(socialStack(), [{ kinds: [KIND.RATING], '#A': ratingKeys, limit: 50 }]),
      relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#A': [a], limit: 80 }]),
      relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#a': [a], limit: 80 }]),
      ...chunk(highlightAddrs, 20).map((batch) =>
        relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#a': batch, limit: 80 }])
      )
    ]);
    const ratingById = new Map<string, Event>();
    for (const e of [...rA, ...rA2]) ratingById.set(e.id, e);
    ratings = [...ratingById.values()];
    const byId = new Map<string, Event>();
    for (const e of [...cA, ...cA2]) byId.set(e.id, e);
    comments = [...byId.values()];
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
        void enrichHighlightsFromSections(streamed);
      }
    } catch {
      if (signal.aborted) return;
    }
  }

  async function fallbackSections(target: Event): Promise<Event[]> {
    const aTags = target.tags.filter((t) => t[0] === 'a' && t[1]).map((t) => t[1]!);
    const out: Event[] = [];
    for (const coord of aTags.slice(0, 40)) {
      const parts = coord.split(':');
      const kind = Number(parts[0]);
      const pubkey = parts[1];
      const d = parts.slice(2).join(':');
      if (!kind || !pubkey || !d) continue;
      // Nested 30040 indexes are editions, not readable sections.
      if (kind === KIND.PUBLICATION) continue;
      const [m, w] = await Promise.all([
        mercuryFilter({ kinds: [kind], authors: [pubkey], '#d': [d], limit: 1 }),
        relayPool.query(documentStack(), [{ kinds: [kind], authors: [pubkey], '#d': [d], limit: 1 }])
      ]);
      const hit = m[0] ?? w[0];
      if (hit) out.push(hit);
    }
    return out;
  }

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
    cancelTree();
    error = false;
    unreadable = false;

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

  async function startReading(): Promise<void> {
    if (!event || unreadable || !canRead) return;
    reading = true;
    if (!sections.length) {
      readingBusy = true;
      try {
        try {
          sections = await mercuryPublicationStream(naddrFor(event));
        } catch {
          sections = [];
        }
        if (!sections.length) sections = await fallbackSections(event);
        if (sections.length) void enrichHighlightsFromSections(sections);
        if (!toc.length) toc = parseToc(null, event);
        if (!sections.length) {
          unreadable = true;
          reading = false;
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
      (address ? document.querySelector(`[data-section-addr="${address}"]`) : null) ??
      document.querySelector(`[data-read-pos="${pos}"]`);
    el?.scrollIntoView({ block: 'start' });
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

  function jumpTo(entry: TocEntry): void {
    tocOpen = false;
    scrollToSection(entry.pos, entry.id, entry.address);
    if (event) saveResume(eventAddress(event), { pos: entry.pos, sectionId: entry.id });
  }

  function rememberPos(pos: number, section: Event): void {
    if (!event) return;
    saveResume(eventAddress(event), { pos, sectionId: section.id });
  }

  async function loadSectionComments(section: Event): Promise<void> {
    const a = eventAddress(section);
    if (sectionComments[a]) return;
    const [cA, ca] = await Promise.all([
      relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#A': [a], limit: 40 }]),
      relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#a': [a], limit: 40 }])
    ]);
    const byId = new Map<string, Event>();
    for (const e of [...cA, ...ca]) byId.set(e.id, e);
    sectionComments = { ...sectionComments, [a]: [...byId.values()] };
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
    if (signed) highlights = [...highlights, signed];
  }

  function quotesFor(section: Event): string[] {
    const a = eventAddress(section);
    const keys = new Set(publicationCoordinateLookupKeys(a));
    return mutedHighlights
      .filter(
        (h) =>
          h.tags.some((t) => t[0] === 'a' && t[1] && keys.has(t[1])) ||
          h.tags.some((t) => t[0] === 'e' && t[1]?.toLowerCase() === section.id.toLowerCase())
      )
      .map((h) => h.content);
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
      <header class="card" style="margin-bottom:1.5rem">
        <EditionHeader {event} />
        <ShelfActions publication={event} />
        {#if canRead}
          <button class="btn btn-primary" type="button" onclick={() => void startReading()}>Read the publication</button>
        {:else}
          <p class="muted">
            Catalog entry only — the full text is not available in the library (often a copyrighted work we cannot publish).
          </p>
        {/if}
        <DetailsPanel {event} />
      </header>

      <RatingPanel ratings={visibleRatings} publication={event} />

      {#if visibleHighlights.length}
        <section class="card" style="margin-bottom:1rem">
          <h2>Highlights</h2>
          {#each visibleHighlights as h (h.id)}
            <p>
              <UserBadge pubkey={h.pubkey} />
            </p>
            <EventBody event={h} />
          {/each}
        </section>
      {/if}

      <section class="card" style="margin-bottom:1rem">
        <h2>Comments</h2>
        {#if thread.length}
          <ul class="thread-list">
            {#each thread as node (node.event?.id ?? node.placeholder)}
              <CommentThread {node} target={event} />
            {/each}
          </ul>
        {:else}
          <p class="muted">No comments yet.</p>
        {/if}
        {#if $session.pubkey}
          <form class="compose" onsubmit={(e) => { e.preventDefault(); void postComment(); }}>
            <textarea bind:value={commentText} rows="3" placeholder="Write a comment"></textarea>
            <button class="btn btn-primary" type="submit" disabled={!commentText.trim()}>Post</button>
          </form>
        {:else}
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
                <li>
                  <button class="btn" type="button" onclick={() => jumpTo(entry)}>{entry.title}</button>
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
        <div class="reading-body" bind:this={readingPane}>
          <PageFilter
            bind:value={pageFilter}
            placeholder="Find in this publication…"
            onEnter={cyclePageFind}
          />
          {#if readingBusy || !sections.length}
            <p class="loading-hint">Publication is loading...</p>
          {/if}
          {#each sections as section, i (section.id)}
            {@const pos = readerToc.find((e) => e.id === section.id)?.pos ?? readerToc[i]?.pos ?? i}
            <article
              class="reader-section"
              data-read-pos={pos}
              data-section-addr={eventAddress(section)}
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
              {#if $session.pubkey}
                <button class="btn" type="button" onclick={() => void saveHighlight(section)}>Save highlight</button>
              {:else}
                <button class="btn" type="button" onclick={() => session.signIn()}>Sign in to highlight</button>
              {/if}
              <details
                class="accordion"
                ontoggle={(e) => {
                  if ((e.currentTarget as HTMLDetailsElement).open) void loadSectionComments(section);
                }}
              >
                <summary>Comments for this section</summary>
                {#if sectionComments[eventAddress(section)]?.length}
                  <ul class="thread-list">
                    {#each nestComments(filterMuted(sectionComments[eventAddress(section)] ?? [], $muteState), $muteState) as node}
                      <CommentThread {node} target={section} />
                    {/each}
                  </ul>
                {:else}
                  <p class="muted">No comments yet.</p>
                {/if}
                {#if $session.pubkey}
                  <form
                    class="compose"
                    onsubmit={(e) => {
                      e.preventDefault();
                      void postSectionComment(section);
                    }}
                  >
                    <textarea
                      value={sectionCommentText[eventAddress(section)] ?? ''}
                      oninput={(e) => {
                        sectionCommentText = {
                          ...sectionCommentText,
                          [eventAddress(section)]: (e.currentTarget as HTMLTextAreaElement).value
                        };
                      }}
                      rows="3"
                      placeholder="Write a comment on this section"
                    ></textarea>
                    <button
                      class="btn btn-primary"
                      type="submit"
                      disabled={!(sectionCommentText[eventAddress(section)] ?? '').trim()}
                      >Post</button
                    >
                  </form>
                {:else}
                  <button class="btn" type="button" onclick={() => session.signIn()}
                    >Sign in to comment</button
                  >
                {/if}
              </details>
            </article>
          {/each}
        </div>
      </div>
    {/if}
  {:else if loading}
    <p class="loading-hint">Publication is loading...</p>
  {/if}
</main>
