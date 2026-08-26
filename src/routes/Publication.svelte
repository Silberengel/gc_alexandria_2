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
  import CardMeta from '$lib/components/CardMeta.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import { KIND } from '$lib/constants';
  import { displayTitle, publicationPath, cardMeta } from '$lib/metadata';
  import { muteState, filterMuted } from '$lib/mute';
  import { createPageFindController, filterPageEvents } from '$lib/page-filter';
  import { mercuryFilter, mercuryPublicationMeta, mercuryPublicationStream, mercuryPublicationToc } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { documentStack, socialStack } from '$lib/nostr/selector';
  import { eventAddress, isTopLevel30040 } from '$lib/nostr/verify';
  import { fetchById } from '$lib/nostr/fetch';
  import { nestComments } from '$lib/comments';
  import { newestRatingPerAuthor } from '$lib/ratings';
  import { commentDraft, highlightDraft } from '$lib/drafts';
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
  let unreadable = $state(false);
  let loading = $state(true);
  let commentText = $state('');
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
  const headerMeta = $derived(event ? cardMeta(event) : null);
  const readerToc = $derived(enrichToc(toc, sections));

  function cancelTree(): void {
    treeAbort?.abort();
    treeAbort = null;
  }

  async function fetchSocial(target: Event): Promise<void> {
    const a = eventAddress(target);
    const [r, cA, cA2, h] = await Promise.all([
      relayPool.query(socialStack(), [{ kinds: [KIND.RATING], '#a': [a], limit: 50 }]),
      relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#A': [a], limit: 80 }]),
      relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#a': [a], limit: 80 }]),
      relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#a': [a], limit: 50 }])
    ]);
    ratings = r;
    const byId = new Map<string, Event>();
    for (const e of [...cA, ...cA2]) byId.set(e.id, e);
    comments = [...byId.values()];
    highlights = h;
  }

  async function prefetchTree(target: Event, signal: AbortSignal): Promise<void> {
    try {
      const naddr = naddrFor(target);
      const meta = await mercuryPublicationMeta(naddr, signal);
      if (signal.aborted) return;
      if (isUnreadableMeta(meta)) {
        unreadable = true;
        return;
      }
      const rawToc = await mercuryPublicationToc(naddr, signal);
      if (signal.aborted) return;
      toc = parseToc(rawToc, target);
      const streamed = await mercuryPublicationStream(naddr, undefined, signal);
      if (signal.aborted) return;
      if (streamed.length) sections = streamed;
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
      const [m, w] = await Promise.all([
        mercuryFilter({ kinds: [kind], authors: [pubkey], '#d': [d], limit: 1 }),
        relayPool.query(documentStack(), [{ kinds: [kind], authors: [pubkey], '#d': [d], limit: 1 }])
      ]);
      const hit = m[0] ?? w[0];
      if (hit) out.push(hit);
    }
    return out;
  }

  async function loadEdition(target: Event): Promise<void> {
    event = target;
    error = false;
    unreadable = false;
    await fetchSocial(target);
    cancelTree();
    treeAbort = new AbortController();
    void prefetchTree(target, treeAbort.signal);
  }

  $effect(() => {
    const dTag = params.d;
    const npubParam = params.npub;
    const pointer = params.naddr;
    let cancelled = false;
    loading = true;
    error = false;
    unreadable = false;
    event = null;
    editions = [];
    reading = false;
    tocOpen = false;
    sections = [];
    toc = [];
    cancelTree();

    void (async () => {
      try {
        if (pointer) {
          const decoded = decodePublicationPointer(pointer);
          if (!decoded) {
            error = true;
            return;
          }
          let fetched: Event | null = null;
          if (decoded.id) fetched = await fetchById(decoded.id);
          else if (decoded.pubkey && decoded.d != null) {
            const filter = {
              kinds: [decoded.kind ?? KIND.PUBLICATION],
              authors: [decoded.pubkey],
              '#d': [decoded.d],
              limit: 1
            };
            fetched =
              (await mercuryFilter(filter))[0] ??
              (await relayPool.query(documentStack(), [filter]))[0] ??
              null;
          }
          if (cancelled) return;
          if (!fetched || fetched.kind !== KIND.PUBLICATION) {
            error = true;
            return;
          }
          replace(publicationPath(fetched));
          await loadEdition(fetched);
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
          editions = top;
          return;
        }

        if (dTag && npubParam) {
          const pubkey = hexFromNpubParam(npubParam);
          const filter = { kinds: [KIND.PUBLICATION], authors: [pubkey], '#d': [dTag], limit: 1 };
          const fetched =
            (await mercuryFilter(filter))[0] ??
            (await relayPool.query(documentStack(), [filter]))[0] ??
            null;
          if (cancelled) return;
          if (!fetched) {
            error = true;
            return;
          }
          await loadEdition(fetched);
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
    if (!event || unreadable) return;
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

  async function saveHighlight(section: Event): Promise<void> {
    if (!$session.pubkey) {
      await session.signIn();
      return;
    }
    const sel = window.getSelection()?.toString().trim() ?? '';
    if (!sel) return;
    const signed = await signAndPublish(highlightDraft(section, sel));
    if (signed) highlights = [...highlights, signed];
  }

  function quotesFor(section: Event): string[] {
    const a = eventAddress(section);
    return mutedHighlights
      .filter((h) => h.tags.some((t) => t[0] === 'a' && t[1] === a))
      .map((h) => h.content);
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
        <h1>
          {#if headerMeta?.titles.length}
            {#each headerMeta.titles as name, i}
              {#if i > 0}<span> · </span>{/if}
              <a href={`#/search?title=${encodeURIComponent(name)}`}>{name}</a>
            {/each}
          {:else}
            {displayTitle(event)}
          {/if}
        </h1>
        {#if headerMeta}
          <CardMeta {event} showIdentifier showTitles={false} />
        {/if}
        {#if isLibraryCopyPubkey(event.pubkey)}
          <p class="muted">Library copy</p>
        {/if}
        <ShelfActions publication={event} />
        <button class="btn btn-primary" type="button" onclick={() => void startReading()}>Read the publication</button>
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
