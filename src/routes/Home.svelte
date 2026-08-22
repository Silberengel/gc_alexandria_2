<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import { KIND } from '$lib/constants';
  import { mercuryPublicationSearch } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { documentStack, socialStack } from '$lib/nostr/selector';
  import { link } from 'svelte-spa-router';
  import type { Event } from 'nostr-tools';

  let publications = $state<Event[]>([]);
  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let subjects = $state<string[]>([]);
  let labels = $state<string[]>([]);

  onMount(async () => {
    publications = await mercuryPublicationSearch({ limit: 50 });
    const commentFilter = { kinds: [KIND.COMMENT], limit: 200 };
    comments = (await relayPool.query(socialStack(), [commentFilter])).sort(
      (a, b) => b.created_at - a.created_at
    ).slice(0, 200);

    const highlightFilter = { kinds: [KIND.HIGHLIGHT], limit: 200 };
    highlights = (await relayPool.query(documentStack(), [highlightFilter]))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 50);

    const subjectCounts = new Map<string, number>();
    for (const p of publications) {
      for (const t of p.tags.filter((x) => x[0] === 't' && x[1])) {
        subjectCounts.set(t[1]!, (subjectCounts.get(t[1]!) ?? 0) + 1);
      }
    }
    subjects = [...subjectCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([t]) => t);
  });
</script>

<TopBar showSearch />

<main class="shell">
  <h1 class="section-title">Library of Alexandria</h1>

  {#if publications.length}
    <section>
      <h2 class="section-title">Bookshelves</h2>
      <div class="shelf-bar">
        {#each publications.slice(0, 50) as pub}
          <a class="cover" href={`#/publication/d/${pub.tags.find((t) => t[0] === 'd')?.[1] ?? ''}/p/${pub.pubkey}`} use:link>
            {#if pub.tags.find((t) => t[0] === 'image')?.[1]}
              <img src={pub.tags.find((t) => t[0] === 'image')?.[1]} alt="" loading="lazy" />
            {:else}
              <span class="cover-placeholder">No cover</span>
            {/if}
          </a>
        {/each}
      </div>
      <div class="card-grid">
        {#each publications.slice(0, 25) as pub}
          <PublicationCard event={pub} />
        {/each}
      </div>
    </section>
  {/if}

  {#if highlights.length}
    <section>
      <h2 class="section-title">Highlights</h2>
      <ul>
        {#each highlights.slice(0, 50) as h}
          <li class="muted" style="margin-bottom:0.5rem">{h.content.slice(0, 120)}</li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if comments.length}
    <section>
      <h2 class="section-title">What we are discussing</h2>
      <ul>
        {#each comments.slice(0, 200) as c}
          <li style="margin-bottom:0.75rem">{c.content.slice(0, 160)}</li>
        {/each}
      </ul>
    </section>
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
