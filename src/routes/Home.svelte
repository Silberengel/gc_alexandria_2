<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import Cover from '$lib/components/Cover.svelte';
  import LandingRefRow from '$lib/components/LandingRefRow.svelte';
  import LandingRatingRow from '$lib/components/LandingRatingRow.svelte';
  import ListingViewToggle from '$lib/components/ListingViewToggle.svelte';
  import EventsTable from '$lib/components/EventsTable.svelte';
  import { LISTING_PAGE_SIZE_FULL } from '$lib/listing-table';
  import {
    LANDING_FEED_LIMIT,
    clearWarmLandingVisit,
    isWarmLandingRevisit,
    landingCoverSeed,
    landingRefHasRenderableTarget,
    loadCachedLanding,
    loadViewerShelves,
    mergeLandingShelves,
    orderShelfCovers,
    recordWarmLandingVisit,
    refreshLanding,
    type LandingView
  } from '$lib/landing';
  import { warmNavEvent } from '$lib/nav-warm';
  import { shelfWheel } from '$lib/shelf-wheel';
  import { publicationPath } from '$lib/metadata';
  import { session } from '$lib/stores/session';
  import { listingDensity } from '$lib/stores/listing-density';
  import { get } from 'svelte/store';
  import { muteState, filterMuted } from '$lib/mute';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import { isViewerBoundShelfId, orderLandingShelves, dedupeLandingShelfEvents } from '$lib/shelves';
  import { coverImageUrl } from '$lib/cover';
  import { coverAuthor, coverTitle } from '$lib/cover-fallback';
  import { prefetchImages } from '$lib/image-cache';
  import { link } from 'svelte-spa-router';
  import { nip19, type Event } from 'nostr-tools';
  import { cachePutEvent, type LandingShelfSnap } from '$lib/nostr/cache';
  import { KIND } from '$lib/constants';
  import {
    defaultStarterGuideChips,
    loadStarterGuideChips,
    type StarterGuideChip
  } from '$lib/starter-guides';
  import { viewerReadingEntries } from '$lib/viewer-reading-queue';
  import { readingPrefs } from '$lib/stores/reading-prefs';
  import {
    activeReadingEntries,
    findQueueEntry,
    readingProgressPercent,
    waitingReadingEntries,
    type ReadingQueueEntry
  } from '$lib/reading-queue';
  import { warmReadingQueueCache } from '$lib/reading-queue-cache';
  import { fetchByAddress } from '$lib/nostr/fetch';
  import { eventAddress } from '$lib/nostr/verify';
  import { MY_BOOK_COLLECTION_D_TAG } from '$lib/bookshelf';
  import LandingFollowsReading from '$lib/components/LandingFollowsReading.svelte';

  const LOG = '[alexandria:landing]';

  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let ratings = $state<Event[]>([]);
  let referenced = $state<Event[]>([]);
  let subjects = $state<string[]>([]);
  let shelves = $state<LandingShelfSnap[]>([]);
  let labels = $state<string[]>([]);
  let guideChips = $state<StarterGuideChip[]>(defaultStarterGuideChips());
  let landingBusy = $state(true);
  let landingStatus = $state('Starting…');
  let shelfBusy = $state(false);
  /** Stable for this SPA session (module seed) so covers reshuffle only on full reload. */
  const shelfSeed = landingCoverSeed();
  /** Resolved edition events for the viewer's reading queue (Reading now shelf). */
  let readingEditions = $state<Map<string, Event>>(new Map());

  const readingQueue = $derived($viewerReadingEntries);
  const readingShelfEntries = $derived([
    ...activeReadingEntries(readingQueue, $readingPrefs.concurrent),
    ...waitingReadingEntries(readingQueue, $readingPrefs.concurrent)
  ]);

  const readingNowShelf = $derived.by((): LandingShelfSnap | null => {
    if (!$session.pubkey) return null;
    const events: Event[] = [];
    const seen = new Set<string>();
    for (const entry of readingShelfEntries) {
      const hit = readingEditions.get(entry.a);
      if (!hit) continue;
      const key = eventAddress(hit) || hit.id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(hit);
    }
    if (!events.length) return null;
    return { id: 'reading-now', title: 'Reading now', events };
  });

  const visibleShelves = $derived(
    dedupeLandingShelfEvents(
      orderLandingShelves(
        [
          ...(readingNowShelf ? [readingNowShelf] : []),
          ...shelves.map((s) => {
            // Curated shelves keep their covers; mute only drops authors on open network rows.
            if (s.id === 'network') {
              return { ...s, events: filterMuted(s.events, $muteState) };
            }
            return s;
          })
        ].filter((s) => s.events.length)
      )
    )
  );
  const hasViewerShelves = $derived(
    visibleShelves.some((s) => isViewerBoundShelfId(s.id))
  );
  const showLandingSpinner = $derived(landingBusy || shelfBusy || $session.loading);
  const visibleHighlights = $derived(
    filterMuted(highlights, $muteState)
      .filter((e) => landingRefHasRenderableTarget(e, referenced))
      .slice(0, LANDING_FEED_LIMIT)
  );
  const visibleComments = $derived(
    filterMuted(comments, $muteState)
      .filter((e) => landingRefHasRenderableTarget(e, referenced))
      .slice(0, LANDING_FEED_LIMIT)
  );
  const visibleRatings = $derived(
    filterMuted(ratings, $muteState)
      .filter((e) => landingRefHasRenderableTarget(e, referenced))
      .slice(0, LANDING_FEED_LIMIT)
  );
  const visibleSubjects = $derived(subjects);
  const visibleLabels = $derived(labels);
  const visibleGuides = $derived(guideChips);

  function shelfCoverEvents(shelf: LandingShelfSnap): Event[] {
    // Keep reading-queue order; other shelves still shuffle for variety.
    if (shelf.id === 'reading-now') return shelf.events;
    return orderShelfCovers(shelf.events, shelfSeed);
  }

  function continueReadingHref(entry: ReadingQueueEntry, edition: Event): string {
    const base = `#${publicationPath(edition)}`;
    const q = new URLSearchParams();
    q.set('read', '1');
    const sid = (entry.sectionId ?? '').trim();
    if (sid) q.set('section', sid);
    if (Number.isFinite(entry.pos) && entry.pos >= 0) q.set('pos', String(Math.floor(entry.pos)));
    return `${base}?${q.toString()}`;
  }

  function shelfCoverHref(shelf: LandingShelfSnap, pub: Event): string {
    if (shelf.id === 'reading-now') {
      const entry = findQueueEntry(readingQueue, eventAddress(pub));
      if (entry) return continueReadingHref(entry, pub);
    }
    return `#${publicationPath(pub)}`;
  }

  /** Search URL for a landing shelf heading (replaces the old “Full shelf →” link). */
  function shelfHeadingHref(shelf: LandingShelfSnap): string | null {
    if (shelf.href) {
      return shelf.href.startsWith('#') ? shelf.href : `#${shelf.href}`;
    }
    const pk = $session.pubkey;
    if (!pk) return null;
    let npub = '';
    try {
      npub = nip19.npubEncode(pk);
    } catch {
      return null;
    }
    if (shelf.id === 'reading-now') {
      return `#/search?queue=${encodeURIComponent(npub)}`;
    }
    if (shelf.id === 'mine') {
      return `#/search?bookshelf=${encodeURIComponent(MY_BOOK_COLLECTION_D_TAG)}&npub=${encodeURIComponent(npub)}`;
    }
    return null;
  }

  /** All shelf publications in priority order, deduped — used by table view. */
  const allShelfEvents = $derived.by(() => {
    const seen = new Set<string>();
    const out: Event[] = [];
    for (const shelf of visibleShelves) {
      for (const event of shelfCoverEvents(shelf)) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        out.push(event);
      }
    }
    return out;
  });

  let loadInFlight = false;
  let loadAgain = false;
  let mergeInFlight = false;
  let mergeAgain = false;
  /**
   * Metadata id-key for which My shelf was last successfully folded.
   * `null` = never folded this session; `''` = folded when the viewer had no
   * bookmark/label/directory/contact events (empty fingerprint is still valid).
   */
  let lastFoldedMetaKey: string | null = null;

  $effect(() => {
    if (!$session.pubkey) return;
    const queue = readingShelfEntries;
    let cancelled = false;
    for (const entry of queue) {
      if (readingEditions.has(entry.a)) continue;
      const addr = entry.a;
      void (async () => {
        const hit = await fetchByAddress(addr);
        if (cancelled || !hit) return;
        if (!readingShelfEntries.some((e) => e.a === addr)) return;
        rememberEvents([hit]);
        void cachePutEvent(hit);
        readingEditions = new Map(readingEditions).set(addr, hit);
      })();
    }
    // Heavy seed Cache Storage (e.g. Chronological Bible) waits until landing/merge idle
    // (see maybeWarmReadingQueue from load/merge finally).
    maybeWarmReadingQueue();
    return () => {
      cancelled = true;
    };
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
    // Union into whatever is already painted — including network. Filtering to
    // viewer-bound rows only used to drop curated shelves when the live pack timed out thin.
    if (nextHasCovers || !shelves.some((s) => s.events.length)) {
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
    markViewerShelvesFoldedIfReady();
  }

  /** Drop identity-bound rows and label chips; keep network while the next load runs. */
  function clearIdentityShelves(): void {
    shelves = shelves.filter((s) => !isViewerBoundShelfId(s.id));
    // Labels can include the previous viewer's 1985s via session metadata — clear until reload.
    labels = [];
    lastFoldedMetaKey = null;
    clearWarmLandingVisit();
  }

  function shelfMetaKey(events: Event[]): string {
    return events
      .filter(
        (e) =>
          e.kind === KIND.CONTACT_LIST ||
          e.kind === KIND.BOOKMARK ||
          e.kind === KIND.LABEL ||
          e.kind === KIND.DIRECTORY
      )
      .map((e) => e.id)
      .sort()
      .join(',');
  }

  function hasViewerBoundCovers(rows: LandingShelfSnap[] = shelves): boolean {
    return rows.some((s) => isViewerBoundShelfId(s.id) && s.events.length);
  }

  /** Cache/refresh already painted My shelf — skip a redundant merge fold for this metadata. */
  function markViewerShelvesFoldedIfReady(): void {
    if (!hasViewerBoundCovers()) return;
    const meta = session.getMetadata();
    if (!meta.length) return;
    // Empty key is valid when metadata has no list kinds — still mark folded.
    lastFoldedMetaKey = shelfMetaKey(meta);
  }

  function maybeWarmReadingQueue(): void {
    if (loadInFlight || mergeInFlight) return;
    if (!session.getPubkey()) return;
    warmReadingQueueCache(readingShelfEntries);
  }

  async function mergeViewerShelves(): Promise<void> {
    // Claim the mutex first so overlapping metadata + loading callbacks cannot dual-start.
    if (mergeInFlight) {
      mergeAgain = true;
      console.info(LOG, 'mergeViewerShelves coalesced');
      return;
    }
    // Do not compete with refreshLanding for relay slots — that stalled every page.
    if (loadInFlight) {
      mergeAgain = true;
      console.info(LOG, 'mergeViewerShelves deferred until landing idle');
      return;
    }
    const pk = session.getPubkey();
    const meta = session.getMetadata();
    if (!pk) {
      console.info(LOG, 'mergeViewerShelves skip: not signed in');
      return;
    }
    if (!meta.length) {
      console.info(LOG, 'mergeViewerShelves skip: metadata empty (login lists not ready)');
      landingStatus = 'Waiting for your login lists…';
      return;
    }
    const foldKey = shelfMetaKey(meta);
    if (
      lastFoldedMetaKey !== null &&
      foldKey === lastFoldedMetaKey &&
      hasViewerBoundCovers()
    ) {
      console.info(LOG, 'mergeViewerShelves skip: My shelf already folded for this metadata');
      return;
    }
    mergeInFlight = true;
    const kindCounts: Record<string, number> = {};
    for (const e of meta) {
      const k = String(e.kind);
      kindCounts[k] = (kindCounts[k] ?? 0) + 1;
    }
    console.info(LOG, 'mergeViewerShelves start', {
      pubkey: pk.slice(0, 8),
      metaEvents: meta.length,
      bookmarks: kindCounts[String(KIND.BOOKMARK)] ?? 0,
      labels: kindCounts[String(KIND.LABEL)] ?? 0,
      directories: kindCounts[String(KIND.DIRECTORY)] ?? 0,
      kindCounts
    });
    shelfBusy = true;
    landingStatus = 'Loading your shelves…';
    let timeoutId: ReturnType<typeof setTimeout> | 0 = 0;
    try {
      const known = [
        ...shelves.flatMap((s) => s.events),
        ...ratings,
        ...highlights,
        ...comments
      ];
      let raceDone = false;
      const pack = await Promise.race([
        loadViewerShelves(known, (progress) => {
          // Parent-enrichment rematch after the first fold — keep progressive paint.
          if (!progress.shelves.some((s) => s.events.length) && !progress.labels.length) return;
          shelves = mergeLandingShelves(shelves, progress.shelves);
          if (progress.labels.length) labels = progress.labels;
          if (hasViewerBoundCovers()) {
            lastFoldedMetaKey = foldKey;
            landingStatus = 'Your shelves are ready';
          }
        }).then((value) => {
          raceDone = true;
          if (timeoutId) clearTimeout(timeoutId);
          return value;
        }),
        new Promise<{ shelves: LandingShelfSnap[]; labels: string[] }>((resolve) => {
          timeoutId = setTimeout(() => {
            if (raceDone) return;
            raceDone = true;
            console.warn(LOG, 'mergeViewerShelves timed out after 8s');
            resolve({ shelves: [], labels: [] });
          }, 8_000);
        })
      ]);
      const summary = pack.shelves.map((s) => `${s.id}:${s.events.length}`).join(', ') || '(none)';
      console.info(LOG, 'mergeViewerShelves result', {
        shelfRows: summary,
        labelChips: pack.labels.length
      });
      const packEmpty = !pack.shelves.some((s) => s.events.length) && !pack.labels.length;
      if (packEmpty) {
        // Soft race often returns empty while cache/refresh already painted My shelf.
        if (hasViewerBoundCovers()) {
          lastFoldedMetaKey = foldKey;
          recordWarmLandingVisit(pk, foldKey);
          landingStatus = 'Your shelves are ready';
          console.info(LOG, 'mergeViewerShelves kept cached shelves (empty race result)');
          return;
        }
        landingStatus = 'No personal shelf lists found on relays yet';
        return;
      }
      shelves = mergeLandingShelves(shelves, pack.shelves);
      if (pack.labels.length) labels = pack.labels;
      rememberEvents(pack.shelves.flatMap((s) => s.events));
      prefetchImages(
        pack.shelves
          .flatMap((s) => s.events)
          .map((e) => coverImageUrl(e))
          .filter((u): u is string => !!u)
      );
      if (pack.shelves.some((s) => isViewerBoundShelfId(s.id) && s.events.length)) {
        lastFoldedMetaKey = foldKey;
        recordWarmLandingVisit(pk, foldKey);
        landingStatus = 'Your shelves are ready';
      } else if (hasViewerBoundCovers()) {
        lastFoldedMetaKey = foldKey;
        recordWarmLandingVisit(pk, foldKey);
        landingStatus = 'Your shelves are ready';
      } else {
        landingStatus = 'Shelves updated (no My shelf covers resolved yet)';
      }
    } catch (err) {
      console.warn(LOG, 'mergeViewerShelves failed', err);
      landingStatus = 'Could not load your shelves (see console)';
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      mergeInFlight = false;
      shelfBusy = false;
      maybeWarmReadingQueue();
      if (mergeAgain && !loadInFlight) {
        mergeAgain = false;
        // Trailing rematch is only needed when My shelf never painted.
        if (!hasViewerBoundCovers()) void mergeViewerShelves();
        else console.info(LOG, 'mergeViewerShelves skip trailing rematch (My shelf already painted)');
      }
    }
  }

  async function loadLanding(): Promise<void> {
    // Coalesce overlapping loads (login pubkey + metadata + loading flag) into a trailing
    // reload — but never abandon an in-flight refresh's progressive shelf paints mid-way
    // by bumping a generation counter (that left the UI on ratings-only forever).
    if (loadInFlight) {
      loadAgain = true;
      console.info(LOG, 'loadLanding coalesced (already in flight)');
      return;
    }
    loadInFlight = true;
    loadAgain = false;
    landingBusy = true;
    const identity = session.getPubkey();
    const replaceFromCache = shelves.length === 0;
    console.info(LOG, 'loadLanding start', { identity: identity?.slice(0, 8) ?? null });
    // Guides first (top of page): already painted from defaults; refine in parallel.
    void loadStarterGuideChips()
      .then((chips) => {
        if (session.getPubkey() !== identity) return;
        if (chips.length) guideChips = chips;
      })
      .catch(() => {});
    try {
      landingStatus = 'Loading cached landing…';
      const cached = await loadCachedLanding();
      console.info(LOG, 'cache', {
        hit: !!cached,
        shelves: cached?.shelves?.map((s) => `${s.id}:${s.events.length}`).join(', ') ?? ''
      });
      if (cached) apply(cached, replaceFromCache);
      const metaKey = shelfMetaKey(session.getMetadata());
      // Same SPA session, same lists, cache still has My shelf — do not re-stampede relays
      // (Booklists → Home remount used to start a second full refreshLanding).
      if (isWarmLandingRevisit(identity, metaKey, cached)) {
        console.info(LOG, 'warm revisit — skip refreshLanding', {
          identity: identity?.slice(0, 8) ?? null,
          metaEvents: metaKey ? metaKey.split(',').length : 0
        });
        markViewerShelvesFoldedIfReady();
        recordWarmLandingVisit(identity, metaKey);
        landingStatus = '';
        return;
      }
      landingStatus = 'Refreshing shelves and feeds…';
      const live = await refreshLanding(cached, (view) => {
        // Drop updates only when the viewer identity changed under us.
        if (session.getPubkey() !== identity) return;
        apply(view, false);
      });
      console.info(LOG, 'refreshLanding done', {
        shelves: live.shelves.map((s) => `${s.id}:${s.events.length}`).join(', '),
        ratings: live.ratings?.length ?? 0
      });
      if (session.getPubkey() === identity) apply(live, true);
      markViewerShelvesFoldedIfReady();
      if (hasViewerBoundCovers() || (!identity && shelves.some((s) => s.events.length))) {
        recordWarmLandingVisit(identity, shelfMetaKey(session.getMetadata()));
      }
      landingStatus = '';
    } catch (err) {
      console.warn(LOG, 'loadLanding failed', err);
      landingStatus = 'Landing refresh failed (see console)';
    } finally {
      loadInFlight = false;
      landingBusy = false;
      // Fold My shelf only when still missing — cache/refresh often already painted it.
      // Clear coalesced merge requests so a deferred merge during landing does not re-stampede.
      if (session.getPubkey() && !hasViewerBoundCovers()) {
        mergeAgain = false;
        void mergeViewerShelves();
      } else if (session.getPubkey()) {
        mergeAgain = false;
        markViewerShelvesFoldedIfReady();
        console.info(LOG, 'mergeViewerShelves skip after landing (My shelf already painted)');
      }
      maybeWarmReadingQueue();
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
      // Coalesce sign-in (pubkey change) into one refresh.
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
            e.kind === KIND.DIRECTORY
        )
        .map((e) => e.id)
        .sort()
        .join(',');
      if (key === lastMetaKey) return;
      lastMetaKey = key;
      console.info(LOG, 'metadata changed — folding shelves', {
        keyEvents: key ? key.split(',').length : 0,
        sessionLoading: get(session).loading
      });
      // Fold My shelf from login lists only — do NOT scheduleLoad here.
      if (key) void mergeViewerShelves();
    });
    let wasLoading = get(session).loading;
    const unsubLoading = session.subscribe(($s) => {
      if (wasLoading && !$s.loading && $s.pubkey) {
        console.info(LOG, 'session loading finished — folding shelves');
        void mergeViewerShelves();
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

<TopBar />

<main class="shell shell-wide landing-page">
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
      <div class="landing-hero-footer">
        {#if showLandingSpinner || landingStatus}
          <p class="loading-hint landing-status landing-hero-status" class:landing-status-busy={showLandingSpinner}>
            {#if showLandingSpinner}
              <span class="landing-status-dot" aria-hidden="true"></span>
            {/if}
            {#if $session.loading}
              Signing in and fetching your lists…
            {:else if landingStatus}
              {landingStatus}
            {:else}
              Loading library…
            {/if}
          </p>
        {:else if $session.pubkey && !hasViewerShelves}
          <p class="muted landing-status landing-hero-status">
            Signed in, but My shelf / folders did not load. Open the browser console and filter for
            <code>alexandria:landing</code>.
          </p>
        {:else}
          <span class="landing-hero-status-spacer" aria-hidden="true"></span>
        {/if}
      </div>
    </div>
  </header>

  {#if visibleGuides.length}
    <section class="landing-section landing-guides">
      <div class="landing-section-heading">
        <h2 class="section-title">Guides</h2>
        <p class="landing-section-hint">Curated bookshelves and topical-library clients from GitCitadel</p>
      </div>
      <nav class="guide-links" aria-label="Starter guides">
        {#each visibleGuides as guide, i (guide.d)}
          {#if i > 0}<span class="guide-links-sep" aria-hidden="true">·</span>{/if}
          <a href={guide.href} use:link>{guide.title}</a>
        {/each}
        <span class="guide-links-sep" aria-hidden="true">·</span>
        <a
          class="guide-links-external"
          href="https://biblestr.imwald.eu/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img class="guide-links-icon" src="/biblestr-icon.png" alt="" width="16" height="16" />
          Biblestr
        </a>
      </nav>
    </section>
  {/if}

  {#if visibleLabels.length}
    <section class="landing-section landing-booklists">
      <div class="landing-section-heading">
        <h2 class="section-title">Booklists</h2>
        <a class="landing-browse-link" href="#/booklists" use:link>Browse the booklists</a>
      </div>
      <nav class="guide-links guide-links-clamp" aria-label="Booklists">
        {#each visibleLabels as label, i}
          {#if i > 0}<span class="guide-links-sep" aria-hidden="true">·</span>{/if}
          <a href={`#/search?label=${encodeURIComponent(label)}`} use:link>{label}</a>
        {/each}
      </nav>
    </section>
  {/if}

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
      {@const headingHref = shelfHeadingHref(shelf)}
      {#if shelf.id === 'reading-now'}
        <div class="landing-reading-row">
          <section class="landing-section landing-shelf landing-shelf-reading">
            <div class="shelf-heading">
              <h2 class="section-title">
                {#if headingHref}
                  <a href={headingHref} use:link>{shelf.title}</a>
                {:else}
                  {shelf.title}
                {/if}
              </h2>
            </div>
            <div class="shelf-track shelf-track-reading" use:shelfWheel>
                <div class="shelf-bar">
                  {#each shelfCoverEvents(shelf).slice(0, LISTING_PAGE_SIZE_FULL) as pub (pub.id)}
                    {@const tipTitle = coverTitle(pub)}
                    {@const tipAuthor = coverAuthor(pub)}
                    {@const tip = tipAuthor ? `${tipTitle} — ${tipAuthor}` : tipTitle}
                    {@const queueEntry = findQueueEntry(readingQueue, eventAddress(pub))}
                    {@const pct = queueEntry ? readingProgressPercent(queueEntry) : 0}
                    <a
                      class="cover"
                      href={shelfCoverHref(shelf, pub)}
                      use:link
                      title={tip}
                      aria-label={`${tip} — ${pct}% read`}
                      onpointerdown={() => warmNavEvent(pub)}
                      onclick={() => warmNavEvent(pub)}
                    >
                      <Cover event={pub} />
                    </a>
                  {/each}
                </div>
                <div class="shelf-reading-captions">
                  {#each shelfCoverEvents(shelf).slice(0, LISTING_PAGE_SIZE_FULL) as pub (pub.id)}
                    {@const tipTitle = coverTitle(pub)}
                    {@const tipAuthor = coverAuthor(pub)}
                    {@const queueEntry = findQueueEntry(readingQueue, eventAddress(pub))}
                    {@const pct = queueEntry ? readingProgressPercent(queueEntry) : 0}
                    <div class="shelf-reading-caption">
                      <span class="shelf-reading-caption-title">{tipTitle}</span>
                      {#if tipAuthor}
                        <span class="shelf-reading-caption-author">{tipAuthor}</span>
                      {/if}
                      <div
                        class="shelf-reading-progress"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-label={`${pct}% read`}
                      >
                        <span class="shelf-reading-progress-fill" style={`width:${pct}%`}></span>
                      </div>
                      <span class="shelf-reading-caption-pct">{pct}%</span>
                    </div>
                  {/each}
                </div>
              </div>
          </section>
          <LandingFollowsReading />
        </div>
      {:else}
      <section
        class="landing-section landing-shelf"
      >
        <div class="shelf-heading">
          <h2 class="section-title">
            {#if headingHref}
              <a href={headingHref} use:link>{shelf.title}</a>
            {:else}
              {shelf.title}
            {/if}
          </h2>
        </div>
          <div class="shelf-track" use:shelfWheel>
            <div class="shelf-bar">
              {#each shelfCoverEvents(shelf).slice(0, LISTING_PAGE_SIZE_FULL) as pub (pub.id)}
                {@const tipTitle = coverTitle(pub)}
                {@const tipAuthor = coverAuthor(pub)}
                {@const tip = tipAuthor ? `${tipTitle} — ${tipAuthor}` : tipTitle}
                <a
                  class="cover"
                  href={shelfCoverHref(shelf, pub)}
                  use:link
                  title={tip}
                  aria-label={tip}
                  onpointerdown={() => warmNavEvent(pub)}
                  onclick={() => warmNavEvent(pub)}
                >
                  <Cover event={pub} captionOnHover />
                </a>
              {/each}
            </div>
          </div>
      </section>
      {/if}
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
        <section class="landing-section landing-section-highlights">
          <h2 class="section-title">Highlights</h2>
          <ul class="landing-ref-list">
            {#each visibleHighlights as h (h.id)}
              <LandingRefRow event={h} {referenced} variant="highlight" />
            {/each}
          </ul>
        </section>
      {/if}

      {#if visibleComments.length}
        <section class="landing-section landing-section-discuss">
          <h2 class="section-title">What we are discussing</h2>
          <ul class="landing-ref-list">
            {#each visibleComments as c (c.id)}
              <LandingRefRow event={c} {referenced} variant="discussion" />
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
</main>
