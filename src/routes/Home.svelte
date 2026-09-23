<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import Cover from '$lib/components/Cover.svelte';
  import LandingRefRow from '$lib/components/LandingRefRow.svelte';
  import LandingRatingRow from '$lib/components/LandingRatingRow.svelte';
  import ListingViewToggle from '$lib/components/ListingViewToggle.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import EventsTable from '$lib/components/EventsTable.svelte';
  import { LANDING_FEED_LIMIT, loadCachedLanding, mergeLandingShelves, orderShelfCovers, refreshLanding, type LandingView } from '$lib/landing';
  import { publicationPath } from '$lib/metadata';
  import { session } from '$lib/stores/session';
  import { listingDensity } from '$lib/stores/listing-density';
  import { get } from 'svelte/store';
  import { muteState, filterMuted } from '$lib/mute';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import { isViewerBoundShelfId } from '$lib/shelves';
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import type { LandingShelfSnap } from '$lib/nostr/cache';

  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let ratings = $state<Event[]>([]);
  let referenced = $state<Event[]>([]);
  let subjects = $state<string[]>([]);
  let shelves = $state<LandingShelfSnap[]>([]);
  let labels = $state<string[]>([]);
  const shelfSeed = Math.floor(Date.now() / 1000);
  let loadGen = 0;

  const visibleShelves = $derived(
    shelves
      .map((s) => ({ ...s, events: filterMuted(s.events, $muteState) }))
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
    comments = view.comments;
    highlights = view.highlights;
    ratings = view.ratings ?? [];
    referenced = view.referenced ?? [];
    subjects = view.subjects;
    const nextShelves = view.shelves ?? [];
    shelves = replaceShelves ? nextShelves : mergeLandingShelves(shelves, nextShelves);
    labels = view.labels ?? [];
    rememberEvents([
      ...view.publications,
      ...(view.referenced ?? []),
      ...(view.shelves ?? []).flatMap((s) => s.events),
      ...(view.ratings ?? [])
    ]);
  }

  /** Drop identity-bound rows and label chips; keep GitCitadel/network while the next load runs. */
  function clearIdentityShelves(): void {
    shelves = shelves.filter((s) => !isViewerBoundShelfId(s.id));
    // Labels can include the previous viewer's 1985s via session metadata — clear until reload.
    labels = [];
  }

  async function loadLanding(): Promise<void> {
    const gen = ++loadGen;
    const replaceFromCache = shelves.length === 0;
    try {
      const cached = await loadCachedLanding();
      if (gen !== loadGen) return;
      if (cached) apply(cached, replaceFromCache);
      const live = await refreshLanding(cached, (view) => {
        if (gen === loadGen) apply(view, false);
      });
      if (gen !== loadGen) return;
      apply(live, true);
    } catch {
      /* network/cache failures must not leave home stuck blank forever */
    }
  }

  onMount(() => {
    let lastPk: string | null | undefined;
    let lastMetaKey: string | undefined;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    function scheduleLoad(): void {
      if (debounce) clearTimeout(debounce);
      // Coalesce sign-in (pubkey + metadata clear + metadata fill) into one refresh.
      debounce = setTimeout(() => {
        debounce = null;
        void loadLanding();
      }, 250);
    }

    const unsubSession = session.subscribe(($s) => {
      if ($s.pubkey === lastPk && lastPk !== undefined) return;
      lastPk = $s.pubkey;
      lastMetaKey = undefined;
      clearIdentityShelves();
      // Always refresh public feeds/shelves — do not wait on mute decrypt / login metadata.
      // My shelf still fills in when metadata arrives (see unsubMeta / unsubLoading).
      scheduleLoad();
    });
    const unsubMeta = session.metadata.subscribe((events) => {
      const pk = session.getPubkey();
      if (!pk) {
        lastMetaKey = undefined;
        return;
      }
      // Still fetching login lists — skip the empty clear from applyPubkey.
      if (get(session).loading) return;
      const key = events
        .filter((e) => e.kind === 3 || e.kind === 10003 || e.kind === 1985 || e.kind === 30045)
        .map((e) => e.id)
        .sort()
        .join(',');
      if (key === lastMetaKey) return;
      lastMetaKey = key;
      scheduleLoad();
    });
    // When metadata load finishes (even with empty lists), refresh once for My shelf.
    let wasLoading = false;
    const unsubLoading = session.subscribe(($s) => {
      if (wasLoading && !$s.loading && $s.pubkey) scheduleLoad();
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
              <a class="cover" href={`#${publicationPath(pub)}`} use:link>
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
