<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import Cover from '$lib/components/Cover.svelte';
  import LandingRefRow from '$lib/components/LandingRefRow.svelte';
  import { LANDING_FEED_LIMIT, loadCachedLanding, orderShelfCovers, refreshLanding, type LandingView } from '$lib/landing';
  import { publicationPath } from '$lib/metadata';
  import { session } from '$lib/stores/session';
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';

  let publications = $state<Event[]>([]);
  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let referenced = $state<Event[]>([]);
  let subjects = $state<string[]>([]);
  const shelfSeed = Math.floor(Date.now() / 1000);
  const shelfPubs = $derived(orderShelfCovers(publications, shelfSeed).slice(0, 50));

  function apply(view: LandingView): void {
    publications = view.publications;
    comments = view.comments;
    highlights = view.highlights;
    referenced = view.referenced ?? [];
    subjects = view.subjects;
  }

  async function loadLanding(): Promise<void> {
    const cached = await loadCachedLanding();
    if (cached) apply(cached);
    apply(await refreshLanding(cached, apply));
  }

  onMount(() => {
    let lastPk: string | null | undefined;
    const unsub = session.subscribe(($s) => {
      if ($s.pubkey === lastPk && lastPk !== undefined) return;
      lastPk = $s.pubkey;
      void loadLanding();
    });
    return unsub;
  });
</script>

<TopBar showSearch />

<main class="shell">
  <header class="landing-hero">
    <img src="/screenshots/old_books.jpg" alt="" />
    <h1>Library of Alexandria</h1>
  </header>

  {#if publications.length}
    <section>
      <h2 class="section-title">Bookshelves</h2>
      <div class="shelf-bar">
        {#each shelfPubs as pub}
          <a class="cover" href={`#${publicationPath(pub)}`} use:link>
            <Cover event={pub} />
          </a>
        {/each}
      </div>
    </section>
  {/if}

  {#if highlights.length || comments.length}
    <div class="landing-feeds">
      {#if highlights.length}
        <section>
          <h2 class="section-title">Highlights</h2>
          <ul class="landing-ref-list">
            {#each highlights.slice(0, LANDING_FEED_LIMIT) as h (h.id)}
              <LandingRefRow event={h} {referenced} />
            {/each}
          </ul>
        </section>
      {/if}

      {#if comments.length}
        <section>
          <h2 class="section-title">What we are discussing</h2>
          <ul class="landing-ref-list">
            {#each comments.slice(0, LANDING_FEED_LIMIT) as c (c.id)}
              <LandingRefRow event={c} {referenced} />
            {/each}
          </ul>
        </section>
      {/if}
    </div>
  {/if}

  {#if subjects.length}
    <section>
      <h2 class="section-title">Subjects</h2>
      <div class="chip-row">
        {#each subjects as subject}
          <a class="chip" href={`#/search?subject=${encodeURIComponent(subject)}`} use:link>{subject}</a>
        {/each}
      </div>
    </section>
  {/if}
</main>
