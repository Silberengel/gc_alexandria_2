<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import Cover from '$lib/components/Cover.svelte';
  import LandingRefRow from '$lib/components/LandingRefRow.svelte';
  import LandingRatingRow from '$lib/components/LandingRatingRow.svelte';
  import ListingViewToggle from '$lib/components/ListingViewToggle.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import EventsTable from '$lib/components/EventsTable.svelte';
  import {
    LANDING_FEED_LIMIT,
    loadCachedLanding,
    loadViewerShelves,
    mergeLandingShelves,
    orderShelfCovers,
    refreshLanding,
    type LandingView
  } from '$lib/landing';
  import { warmNavEvent } from '$lib/nav-warm';
  import { publicationPath } from '$lib/metadata';
  import { session } from '$lib/stores/session';
  import { listingDensity } from '$lib/stores/listing-density';
  import { get } from 'svelte/store';
  import { muteState, filterMuted } from '$lib/mute';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import { isViewerBoundShelfId } from '$lib/shelves';
  import { coverImageUrl } from '$lib/cover';
  import { prefetchImages } from '$lib/image-cache';
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import type { LandingShelfSnap } from '$lib/nostr/cache';
  import ReadingNowPanel from '$lib/components/ReadingNowPanel.svelte';
  import { KIND } from '$lib/constants';

  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let ratings = $state<Event[]>([]);
  let referenced = $state<Event[]>([]);
  let subjects = $state<string[]>([]);
  let shelves = $state<LandingShelfSnap[]>([]);
  let labels = $state<string[]>([]);
  const shelfSeed = Math.floor(Date.now() / 1000);

  const visibleShelves = $derived(
    shelves
      .map((s) => {
        // Curated shelves keep their covers; mute only drops authors on open network rows.
        if (s.id === 'network') {
          return { ...s, events: filterMuted(s.events, $muteState) };
        }
        return s;
      })
      .filter((s) => s.events.length)
  );
  const visibleHighlights = $derived(filterMuted(highlights, $muteState).slice(0, LANDING_FEED_LIMIT));
  const visibleComments = $derived(filterMuted(comments, $muteState).slice(0, LANDING_FEED_LIMIT));
  const visibleRatings = $derived(filterMuted(ratings, $muteState).slice(0, LANDING_FEED_LIMIT));
  const visibleSubjects = $derived(subjects);
  const visibleLabels = $derived(labels);

  /** All shelf publications in priority order, deduped — used by table view. */
  const allShelfEvents = $derived.by(() => {
    const seen = new Set<string>();
    const out: Event[] = [];
    for (const shelf of visibleShelves) {
      for (const event of shelf.events) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        out.push(event);
      }
    }
    return out;
  });

  function apply(view: LandingView, replaceShelves = false): void {
    // Progressive onUpdate paints must not clobber warm content with empty arrays.
    if (view.comments.length || replaceShelves) comments = view.comments;
    if (view.highlights.length || replaceShelves) highlights = view.highlights;
    if ((view.ratings?.length ?? 0) || replaceShelves) ratings = view.ratings ?? [];
    if ((view.referenced?.length ?? 0) || replaceShelves) referenced = view.referenced ?? [];
    if (view.subjects.length || replaceShelves) subjects = view.subjects;
    const nextShelves = view.shelves ?? [];
    const nextHasCovers = nextShelves.some((s) => s.events.length);
    // Never wipe painted covers with an empty final pack (relay starvation used to do that).
    if (replaceShelves && nextHasCovers) {
      shelves = nextShelves;
    } else {
      shelves = mergeLandingShelves(shelves, nextShelves);
    }
    if (view.labels?.length || replaceShelves) labels = view.labels ?? [];
    rememberEvents([
      ...view.publications,
      ...(view.referenced ?? []),
      ...(view.shelves ?? []).flatMap((s) => s.events),
      ...(view.ratings ?? [])
    ]);
    const coverUrls = [
      ...(view.shelves ?? []).flatMap((s) => s.events),
      ...(view.publications ?? [])
    ]
      .map((e) => coverImageUrl(e))
      .filter((u): u is string => !!u);
    prefetchImages(coverUrls);
  }

  /** Drop identity-bound rows and label chips; keep GitCitadel/network while the next load runs. */
  function clearIdentityShelves(): void {
    shelves = shelves.filter((s) => !isViewerBoundShelfId(s.id));
    // Labels can include the previous viewer's 1985s via session metadata — clear until reload.
    labels = [];
  }

  let loadInFlight = false;
  let loadAgain = false;

  async function mergeViewerShelves(): Promise<void> {
    if (!session.getPubkey() || !session.getMetadata().length) return;
    try {
      const known = [
        ...shelves.flatMap((s) => s.events),
        ...ratings,
        ...highlights,
        ...comments
      ];
      const pack = await loadViewerShelves(known);
      if (!pack.shelves.some((s) => s.events.length) && !pack.labels.length) return;
      shelves = mergeLandingShelves(shelves, pack.shelves);
      if (pack.labels.length) labels = pack.labels;
      rememberEvents(pack.shelves.flatMap((s) => s.events));
      prefetchImages(
        pack.shelves
          .flatMap((s) => s.events)
          .map((e) => coverImageUrl(e))
          .filter((u): u is string => !!u)
      );
    } catch {
      /* soft-fail — full landing reload may still fill shelves */
    }
  }

  async function loadLanding(): Promise<void> {
    // Coalesce overlapping loads (login pubkey + metadata + loading flag) into a trailing
    // reload — but never abandon an in-flight refresh's progressive shelf paints mid-way
    // by bumping a generation counter (that left the UI on ratings-only forever).
    if (loadInFlight) {
      loadAgain = true;
      return;
    }
    loadInFlight = true;
    loadAgain = false;
    const identity = session.getPubkey();
    const replaceFromCache = shelves.length === 0;
    try {
      const cached = await loadCachedLanding();
      if (cached) apply(cached, replaceFromCache);
      const live = await refreshLanding(cached, (view) => {
        // Drop updates only when the viewer identity changed under us.
        if (session.getPubkey() !== identity) return;
        apply(view, false);
      });
      if (session.getPubkey() === identity) apply(live, true);
      // Metadata often arrives during refreshLanding — fold My shelf in once more.
      if (session.getPubkey() === identity) await mergeViewerShelves();
    } catch {
      /* network/cache failures must not leave home stuck blank forever */
    } finally {
      loadInFlight = false;
      if (loadAgain) {
        loadAgain = false;
        void loadLanding();
      }
    }
  }

  onMount(() => {
    // Seed so the initial session.subscribe callback does not double-fetch.
    let lastPk: string | null | undefined = get(session).pubkey;
    let lastMetaKey: string | undefined;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    function scheduleLoad(): void {
      if (debounce) clearTimeout(debounce);
      // Coalesce sign-in (pubkey + metadata clear + metadata fill) into one refresh.
      debounce = setTimeout(() => {
        debounce = null;
        void loadLanding();
      }, 400);
    }

    // Paint from Cache API immediately — do not wait on session debounce / relays.
    void loadLanding();

    const unsubSession = session.subscribe(($s) => {
      if ($s.pubkey === lastPk) return;
      lastPk = $s.pubkey;
      lastMetaKey = undefined;
      clearIdentityShelves();
      scheduleLoad();
    });
    const unsubMeta = session.metadata.subscribe((events) => {
      const pk = session.getPubkey();
      if (!pk) {
        lastMetaKey = undefined;
        return;
      }
      const key = events
        .filter(
          (e) =>
            e.kind === KIND.CONTACT_LIST ||
            e.kind === KIND.BOOKMARK ||
            e.kind === KIND.LABEL ||
            e.kind === KIND.DIRECTORY ||
            e.kind === KIND.READING_QUEUE
        )
        .map((e) => e.id)
        .sort()
        .join(',');
      if (key === lastMetaKey) return;
      lastMetaKey = key;
      // Immediately fold My shelf / folders from login lists — do not wait for loading=false
      // or a full landing round-trip (that raced and left only "From the network").
      if (key) void mergeViewerShelves();
      if (!get(session).loading) scheduleLoad();
    });
    // When metadata load finishes (even with empty lists), refresh once for My shelf.
    let wasLoading = get(session).loading;
    const unsubLoading = session.subscribe(($s) => {
      if (wasLoading && !$s.loading && $s.pubkey) {
        void mergeViewerShelves();
        scheduleLoad();
      }
      wasLoading = $s.loading;
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      unsubSession();
      unsubMeta();
      unsubLoading();
    };
  });
</script>

<TopBar showSearch />

<main class="shell landing-page">
  <header class="landing-hero">
    <div class="landing-hero-media">
      <img src="/screenshots/old_books.jpg" alt="" />
    </div>
    <div class="landing-hero-copy">
      <p class="landing-hero-eyebrow">GitCitadel</p>
      <h1>Library of Alexandria</h1>
      <p class="landing-hero-lede muted">
        A calm shelf of publications, reviews, and quotes from the Nostr library.
      </p>
    </div>
  </header>

  <ReadingNowPanel />

  {#if visibleShelves.length}
    <div class="listing-toolbar">
      <ListingViewToggle label="Shelves" />
    </div>
  {/if}

  {#if $listingDensity === 'table'}
    {#if allShelfEvents.length}
      <EventsTable events={allShelfEvents} />
    {/if}
  {:else}
    {#each visibleShelves as shelf (shelf.id)}
      <section class="landing-section">
        <h2 class="section-title">
          {#if shelf.href}
            <a href={`#${shelf.href}`} use:link>{shelf.title}</a>
          {:else}
            {shelf.title}
          {/if}
        </h2>
        {#if $listingDensity === 'list'}
          <div class="listing-list">
            {#each orderShelfCovers(shelf.events, shelfSeed).slice(0, 50) as pub (pub.id)}
              <PublicationCard event={pub} variant="row" />
            {/each}
          </div>
        {:else}
          <div class="shelf-bar">
            {#each orderShelfCovers(shelf.events, shelfSeed).slice(0, 50) as pub (pub.id)}
              <a
                class="cover"
                href={`#${publicationPath(pub)}`}
                use:link
                onpointerdown={() => warmNavEvent(pub)}
                onclick={() => warmNavEvent(pub)}
              >
                <Cover event={pub} />
              </a>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  {/if}

  {#if visibleRatings.length}
    <section class="landing-section">
      <h2 class="section-title">Ratings</h2>
      <ul class="landing-review-grid">
        {#each visibleRatings as r (r.id)}
          <LandingRatingRow event={r} {referenced} />
        {/each}
      </ul>
    </section>
  {/if}

  {#if visibleHighlights.length || visibleComments.length}
    <div class="landing-feeds">
      {#if visibleHighlights.length}
        <section class="landing-section">
          <h2 class="section-title">Highlights</h2>
          <ul class="landing-ref-list">
            {#each visibleHighlights as h (h.id)}
              <LandingRefRow event={h} {referenced} />
            {/each}
          </ul>
        </section>
      {/if}

      {#if visibleComments.length}
        <section class="landing-section">
          <h2 class="section-title">What we are discussing</h2>
          <ul class="landing-ref-list">
            {#each visibleComments as c (c.id)}
              <LandingRefRow event={c} {referenced} />
            {/each}
          </ul>
        </section>
      {/if}
    </div>
  {/if}

  {#if visibleSubjects.length}
    <section class="landing-section">
      <h2 class="section-title">Subjects</h2>
      <div class="chip-row">
        {#each visibleSubjects as subject}
          <a class="chip" href={`#/search?subject=${encodeURIComponent(subject)}`} use:link>{subject}</a>
        {/each}
      </div>
    </section>
  {/if}

  {#if visibleLabels.length}
    <section class="landing-section">
      <h2 class="section-title">Labels</h2>
      <div class="chip-row">
        {#each visibleLabels as label}
          <a class="chip" href={`#/search?label=${encodeURIComponent(label)}`} use:link>{label}</a>
        {/each}
      </div>
    </section>
  {/if}
</main>
