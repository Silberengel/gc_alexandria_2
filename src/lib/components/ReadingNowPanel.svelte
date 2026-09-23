<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import Cover from './Cover.svelte';
  import { KIND } from '$lib/constants';
  import { session } from '$lib/stores/session';
  import { readingPrefs } from '$lib/stores/reading-prefs';
  import {
    activeReadingEntries,
    readingProgressPercent,
    readingQueueFromMetadata,
    waitingReadingEntries,
    type ReadingQueueEntry
  } from '$lib/reading-queue';
  import { promoteReadingToFront } from '$lib/reading-queue-actions';
  import { cardBlurb, blurbMarkupForKind } from '$lib/card-blurb';
  import { editionMetadata } from '$lib/publication-metadata';
  import { publicationPath } from '$lib/metadata';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { rememberEvents } from '$lib/nostr/event-memory';
  import { firstTag } from '$lib/nostr/verify';

  let metaEvents = $state<Event[]>([]);
  let editions = $state<Map<string, Event>>(new Map());
  /** Keyed by `${a}\\0${pos}\\0${sectionId}` so advances refresh the card. */
  let excerpts = $state<Map<string, string>>(new Map());
  let titles = $state<Map<string, string>>(new Map());
  let busyAddr = $state<string | null>(null);
  let resolving = $state<Set<string>>(new Set());

  $effect(() => {
    const unsub = session.metadata.subscribe((events) => {
      metaEvents = events;
    });
    return unsub;
  });

  const entries = $derived(readingQueueFromMetadata(metaEvents));
  const concurrent = $derived($readingPrefs.concurrent);
  const active = $derived(activeReadingEntries(entries, concurrent));
  const waiting = $derived(waitingReadingEntries(entries, concurrent));
  const signedIn = $derived(!!$session.pubkey);

  function excerptKey(entry: ReadingQueueEntry): string {
    return `${entry.a}\0${entry.pos}\0${entry.sectionId ?? ''}`;
  }

  async function loadSectionEvent(sectionId: string): Promise<Event | null> {
    const id = sectionId.trim();
    if (!id) return null;
    if (/^[0-9a-f]{64}$/i.test(id)) {
      const byId = await fetchById(id);
      if (byId) return byId;
    }
    if (/^\d+:[0-9a-f]{64}:/i.test(id)) {
      return (await fetchByAddress(id)) ?? null;
    }
    return null;
  }

  /** Prefer a leaf body; if `section` is an index heading, try its first `a` child. */
  async function excerptEvent(section: Event | null): Promise<Event | null> {
    if (!section) return null;
    const body = section.content?.trim() ?? '';
    if (section.kind !== KIND.PUBLICATION && body) return section;
    const childAddr = firstTag(section, 'a');
    if (childAddr) {
      const child = await fetchByAddress(childAddr);
      if (child) {
        rememberEvents([child]);
        if ((child.content?.trim() ?? '') || child.kind !== KIND.PUBLICATION) return child;
      }
    }
    return body ? section : null;
  }

  async function resolveEntry(entry: ReadingQueueEntry): Promise<void> {
    const key = excerptKey(entry);
    if (excerpts.has(key) && editions.has(entry.a)) return;
    if (resolving.has(key)) return;
    resolving = new Set(resolving).add(key);
    try {
      const hit = editions.get(entry.a) ?? (await fetchByAddress(entry.a));
      if (!hit) return;
      rememberEvents([hit]);
      editions = new Map(editions).set(entry.a, hit);
      const meta = editionMetadata(hit);
      titles = new Map(titles).set(entry.a, meta.titles[0] || 'Untitled');

      let section: Event | null = null;
      if (entry.sectionId) section = await loadSectionEvent(entry.sectionId);
      if (section) rememberEvents([section]);
      const leaf = await excerptEvent(section);
      if (leaf) {
        const text = cardBlurb(leaf.content, {
          markup: blurbMarkupForKind(leaf.kind),
          max: 520
        });
        excerpts = new Map(excerpts).set(key, text || '');
        return;
      }
      const text = meta.summary || cardBlurb(hit.content, { markup: 'asciidoc', max: 480 });
      excerpts = new Map(excerpts).set(key, text || '');
    } finally {
      const next = new Set(resolving);
      next.delete(key);
      resolving = next;
    }
  }

  $effect(() => {
    if (!signedIn) return;
    for (const e of [...active, ...waiting.slice(0, 8)]) {
      void resolveEntry(e);
    }
  });

  function continueHref(entry: ReadingQueueEntry, edition: Event | undefined): string {
    if (!edition) return '#/';
    const base = `#${publicationPath(edition)}`;
    if (entry.sectionId && /^[0-9a-f]{64}$/i.test(entry.sectionId)) {
      return `${base}?section=${entry.sectionId}&read=1`;
    }
    return `${base}?read=1`;
  }

  async function readNow(entry: ReadingQueueEntry): Promise<void> {
    if (busyAddr) return;
    busyAddr = entry.a;
    try {
      await promoteReadingToFront(entry.a);
      const edition = editions.get(entry.a) ?? (await fetchByAddress(entry.a));
      if (edition) {
        editions = new Map(editions).set(entry.a, edition);
        const href = continueHref(entry, edition);
        window.location.hash = href.startsWith('#') ? href.slice(1) : href;
      }
    } finally {
      busyAddr = null;
    }
  }
</script>

{#if signedIn}
  <section class="landing-block reading-now-block">
    <h2>Reading now</h2>
    {#if active.length}
      <ul class="reading-now-list">
        {#each active as entry (entry.a)}
          {@const edition = editions.get(entry.a)}
          {@const pct = readingProgressPercent(entry)}
          {@const blurb = excerpts.get(excerptKey(entry)) || '…'}
          <li class="reading-now-card">
            {#if edition}
              <a class="reading-now-cover" href={continueHref(entry, edition)} use:link>
                <Cover event={edition} />
              </a>
            {/if}
            <div class="reading-now-body">
              <a class="reading-now-title" href={continueHref(entry, edition)} use:link>
                {titles.get(entry.a) || 'Loading…'}
              </a>
              <div
                class="reading-progress"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span class="reading-progress-fill" style={`width:${pct}%`}></span>
              </div>
              <p class="muted reading-now-excerpt">{blurb}</p>
              {#if edition}
                <a class="btn btn-primary" href={continueHref(entry, edition)} use:link>Continue</a>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {:else if !waiting.length}
      <p class="muted">
        Nothing tracked yet — open a book, press Read the publication, then Track reading once the text
        loads.
      </p>
    {:else}
      <p class="muted">Nothing in rotation — promote a book from Up next, or finish one to shift the queue.</p>
    {/if}

    {#if waiting.length}
      <h3 class="reading-upnext-title">Up next</h3>
      <ul class="reading-upnext-list">
        {#each waiting as entry (entry.a)}
          <li class="reading-upnext-row">
            <span>{titles.get(entry.a) || entry.a.split(':').slice(2).join(':') || 'Book'}</span>
            <button
              class="btn btn-sm"
              type="button"
              disabled={busyAddr === entry.a}
              onclick={() => void readNow(entry)}
            >
              Read now
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
