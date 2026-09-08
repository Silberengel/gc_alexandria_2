<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import Cover from '$lib/components/Cover.svelte';
  import LandingRefRow from '$lib/components/LandingRefRow.svelte';
  import { LANDING_FEED_LIMIT, loadCachedLanding, orderShelfCovers, refreshLanding, type LandingView } from '$lib/landing';
  import { publicationPath } from '$lib/metadata';
  import { session } from '$lib/stores/session';
  import { muteState, filterMuted } from '$lib/mute';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';
  import type { LandingShelfSnap } from '$lib/nostr/cache';

  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
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
  const visibleSubjects = $derived(subjects);
  const visibleLabels = $derived(labels);

  function apply(view: LandingView): void {
    comments = view.comments;
    highlights = view.highlights;
    referenced = view.referenced ?? [];
    subjects = view.subjects;
    shelves = view.shelves ?? [];
    labels = view.labels ?? [];
    rememberEvents([
      ...view.publications,
      ...(view.referenced ?? []),
      ...(view.shelves ?? []).flatMap((s) => s.events)
    ]);
  }

  function clearIdentityShelves(): void {
    shelves = [];
    labels = [];
  }

  async function loadLanding(): Promise<void> {
    const gen = ++loadGen;
    clearIdentityShelves();
    const cached = await loadCachedLanding();
    if (gen !== loadGen) return;
    if (cached) apply(cached);
    const live = await refreshLanding(cached, (view) => {
      if (gen === loadGen) apply(view);
    });
    if (gen !== loadGen) return;
    apply(live);
  }

  onMount(() => {
    let lastPk: string | null | undefined;
    let lastMetaKey = '';
    const unsubSession = session.subscribe(($s) => {
      if ($s.pubkey === lastPk && lastPk !== undefined) return;
      lastPk = $s.pubkey;
      lastMetaKey = '';
      void loadLanding();
    });
    // Sign-in sets pubkey before metadata finishes; membership lists arrive later.
    const unsubMeta = session.metadata.subscribe((events) => {
      const pk = session.getPubkey();
      if (!pk) {
        lastMetaKey = '';
        return;
      }
      const key = events
        .filter((e) => e.kind === 3 || e.kind === 10003 || e.kind === 1985 || e.kind === 30045)
        .map((e) => e.id)
        .sort()
        .join(',');
      if (key === lastMetaKey) return;
      lastMetaKey = key;
      void loadLanding();
    });
    return () => {
      unsubSession();
      unsubMeta();
    };
  });
</script>

<TopBar showSearch />

<main class="shell">
  <header class="landing-hero">
    <img src="/screenshots/old_books.jpg" alt="" />
    <h1>Library of Alexandria</h1>
  </header>

  {#each visibleShelves as shelf (shelf.id)}
    <section>
      <h2 class="section-title">
        {#if shelf.href}
          <a href={`#${shelf.href}`} use:link>{shelf.title}</a>
        {:else}
          {shelf.title}
        {/if}
      </h2>
      <div class="shelf-bar">
        {#each orderShelfCovers(shelf.events, shelfSeed).slice(0, 50) as pub (pub.id)}
          <a class="cover" href={`#${publicationPath(pub)}`} use:link>
            <Cover event={pub} />
          </a>
        {/each}
      </div>
    </section>
  {/each}

  {#if visibleHighlights.length || visibleComments.length}
    <div class="landing-feeds">
      {#if visibleHighlights.length}
        <section>
          <h2 class="section-title">Highlights</h2>
          <ul class="landing-ref-list">
            {#each visibleHighlights as h (h.id)}
              <LandingRefRow event={h} {referenced} />
            {/each}
          </ul>
        </section>
      {/if}

      {#if visibleComments.length}
        <section>
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
    <section>
      <h2 class="section-title">Subjects</h2>
      <div class="chip-row">
        {#each visibleSubjects as subject}
          <a class="chip" href={`#/search?subject=${encodeURIComponent(subject)}`} use:link>{subject}</a>
        {/each}
      </div>
    </section>
  {/if}

  {#if visibleLabels.length}
    <section>
      <h2 class="section-title">Labels</h2>
      <div class="chip-row">
        {#each visibleLabels as label}
          <a class="chip" href={`#/search?label=${encodeURIComponent(label)}`} use:link>{label}</a>
        {/each}
      </div>
    </section>
  {/if}
</main>
