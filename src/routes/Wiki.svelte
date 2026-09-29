<script lang="ts">
  import { replace, querystring } from 'svelte-spa-router';
  import TopBar from '$lib/components/TopBar.svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import EventBody from '$lib/components/EventBody.svelte';
  import DetailsPanel from '$lib/components/DetailsPanel.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import EditionHeader from '$lib/components/EditionHeader.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import WorkCommentsPanel from '$lib/components/WorkCommentsPanel.svelte';
  import { KIND } from '$lib/constants';
  import { libraryDocumentPath } from '$lib/metadata';
  import { addressPath, parseAddress } from '$lib/library-scope';
  import { getWikiDeferTarget, isDeferralPlaceholderContent, isWikiDeference, deferrerPubkeys } from '$lib/wiki-defer';
  import { normalizeDTag } from '$lib/dtag';
  import { mercuryFilter } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { wikiStack, documentStack } from '$lib/nostr/selector';
  import { eventAddress } from '$lib/nostr/verify';
  import { fetchById } from '$lib/nostr/fetch';
  import { memoryFindByAddress, memoryGetEvent, rememberEvents } from '$lib/nostr/event-memory';
  import { isNewerReplaceable } from '$lib/nostr/replaceable';
  import { cacheFindByAddress } from '$lib/nostr/cache';
  import { warmAddress, warmNavEvent } from '$lib/nav-warm';
  import { muteState, filterMuted } from '$lib/mute';
  import { createPageFindController, filterPageEvents } from '$lib/page-filter';
  import { fetchWorkResponses, type WorkResponses } from '$lib/comments';
  import { isLibraryCopyPubkey } from '$lib/hex';
  import { decodePublicationPointer, hexFromNpubParam } from '$lib/publication-load';
  import { textHighlightsFromEvents } from '$lib/text-highlights';
  import type { Event } from 'nostr-tools';

  interface Props {
    params?: { d?: string; npub?: string; naddr?: string };
  }

  let { params = {} }: Props = $props();

  let event = $state<Event | null>(null);
  let versions = $state<Event[]>([]);
  let responses = $state<WorkResponses>({ thread: [], quotes: [], highlights: [] });
  let error = $state(false);
  let deferredByList = $state<string[]>([]);
  let forwarding = $state(false);
  let pageFilter = $state('');
  let loading = $state(true);
  let articlePane = $state<HTMLElement | undefined>();
  /** Bumps on each wiki route paint; drops stale social/deferrer assignments. */
  let wikiPaintGen = 0;
  /** Route kind from URL prefix — wiki, spec, and article share this page but never the same address. */
  let routeKind = $state<number>(KIND.WIKI);
  const pageFind = createPageFindController();

  const isSpecRoute = $derived(routeKind === KIND.SPEC);
  const isArticleRoute = $derived(routeKind === KIND.LONG_FORM);
  const surfaceLabel = $derived(
    isSpecRoute ? 'Spec' : isArticleRoute ? 'Article' : 'Wiki'
  );

  function stackForArticleKind(kind: number): string[] {
    return kind === KIND.LONG_FORM ? documentStack() : wikiStack();
  }

  function isArticleKind(kind: number): boolean {
    return kind === KIND.WIKI || kind === KIND.SPEC || kind === KIND.LONG_FORM;
  }
  const mutedHighlights = $derived(filterMuted(responses.highlights, $muteState));
  const bodyHighlights = $derived(textHighlightsFromEvents(mutedHighlights));
  const visibleVersions = $derived(filterPageEvents(versions, pageFilter));
  const panelResponses = $derived.by((): WorkResponses => {
    const q = pageFilter.trim().toLowerCase();
    if (!q) return responses;
    const match = (e: Event) => e.content.toLowerCase().includes(q);
    return {
      thread: responses.thread.filter(match),
      quotes: responses.quotes.filter(match),
      highlights: responses.highlights.filter(match)
    };
  });
  const hideBody = $derived(
    !!event && (isWikiDeference(event) || isDeferralPlaceholderContent(event.content))
  );
  const urlFocusComment = $derived(
    (new URLSearchParams($querystring ?? '').get('comment') ?? '').trim().toLowerCase()
  );

  let commentFocusApplied = $state('');

  function decodeParam(raw: string): string {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  function routeKindFromHash(hashPath: string): number {
    if (/^\/spec(\/|$)/i.test(hashPath)) return KIND.SPEC;
    if (/^\/article(\/|$)/i.test(hashPath)) return KIND.LONG_FORM;
    return KIND.WIKI;
  }

  /** Sync only — landing/search already put this in memory. Never scan Cache Storage here. */
  function warmArticle(pubkey: string, d: string, kind: number): Event | null {
    const slug = normalizeDTag(d) || d;
    return memoryFindByAddress(kind, pubkey, slug) ?? memoryFindByAddress(kind, pubkey, d);
  }

  /**
   * Cold load: Mercury (if up) then wikiStack across relays in parallel.
   * `onHit` fires as soon as any relay returns the article so SPA nav can paint early.
   * Uses a priority pool slot so Home background FoF/deletion REQs cannot starve wiki.
   */
  async function loadArticleByAuthorD(
    pubkey: string,
    d: string,
    kind: number,
    onHit?: (event: Event) => void
  ): Promise<Event | null> {
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
    const slug = normalizeDTag(d) || d;
    const dValues = [...new Set([d, slug].filter(Boolean))];
    const filter = {
      kinds: [kind],
      authors: [pubkey],
      '#d': dValues,
      limit: 5
    };
    let reported = false;
    const report = (ev: Event): void => {
      if (reported) return;
      if (ev.kind !== kind) return;
      reported = true;
      onHit?.(ev);
    };
    const pickNewest = (events: Event[]): Event | null => {
      let best: Event | null = null;
      for (const ev of events) {
        if (ev.kind !== kind) continue;
        if (!best || isNewerReplaceable(ev, best)) best = ev;
      }
      return best;
    };
    // Mercury HTTP first — does not take a WebSocket pool slot.
    const mHits = await mercuryFilter(filter);
    const fromMercury = pickNewest(mHits);
    if (fromMercury) {
      report(fromMercury);
      return fromMercury;
    }
    const wHits = await relayPool.query(
      stackForArticleKind(kind),
      [filter],
      4000,
      5,
      (batch) => {
        const hit = pickNewest(batch);
        if (hit) report(hit);
      },
      { priority: true }
    );
    const hit = pickNewest(wHits);
    if (hit) report(hit);
    return hit;
  }

  function isBech32Pointer(value: string): boolean {
    return /^(naddr|nevent|note)1[02-9ac-hj-np-z]+$/i.test(value.trim());
  }
  $effect(() => {
    if (!event || loading) return;
    void $querystring;
    const id = urlFocusComment;
    if (!id) {
      commentFocusApplied = '';
      queueMicrotask(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
      return;
    }
    void responses;
    if (id === commentFocusApplied) return;
    let attempts = 20;
    let timer = 0;
    const tryScroll = () => {
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

  $effect(() => {
    const root = articlePane;
    const q = pageFilter;
    if (!event || hideBody || !root) return;
    return pageFind.observe(root, q);
  });

  function cyclePageFind(): void {
    if (articlePane) pageFind.next(articlePane);
  }

  function hashQuery(): URLSearchParams {
    const hash = window.location.hash;
    const i = hash.indexOf('?');
    return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '');
  }

  function seedDeferrersFromUrl(): string[] {
    const q = hashQuery();
    return q
      .getAll('deferredBy')
      .flatMap((v) => v.split(','))
      .map((s) => s.trim().toLowerCase())
      .filter((pk) => /^[0-9a-f]{64}$/.test(pk));
  }

  async function loadDeferrers(target: Event): Promise<string[]> {
    const seeds = seedDeferrersFromUrl();
    const addr = eventAddress(target);
    const dTag = target.tags.find((t) => t[0] === 'd')?.[1];
    // Mercury-first — avoid a second full wikiStack fan-out on every page load.
    // Deferrers are wiki/spec articles that point at this address (either kind may defer).
    const filters = [
      { kinds: [KIND.WIKI, KIND.SPEC], '#a': [addr], limit: 40 },
      ...(dTag ? [{ kinds: [KIND.WIKI, KIND.SPEC], '#d': [dTag], limit: 40 }] : [])
    ];
    const batches = await Promise.all(filters.map((filter) => mercuryFilter(filter)));
    const byId = new Map<string, Event>();
    for (const batch of batches) for (const e of batch) byId.set(e.id, e);
    if (byId.size < 2) {
      const relayHits = await relayPool.query(wikiStack(), filters, 4000);
      for (const e of relayHits) byId.set(e.id, e);
    }
    return deferrerPubkeys([...byId.values()], target, seeds);
  }

  async function paintWiki(fetched: Event, gen: number): Promise<void> {
    // Paint immediately — never leave "Page is loading…" waiting on deference I/O.
    rememberEvents([fetched]);
    event = fetched;
    loading = false;
    if (await forwardDeference(fetched)) return;
    if (gen !== wikiPaintGen || event?.id !== fetched.id) return;
    // Social + deferrers after first paint — waiting on them left the page stuck under rate limits.
    void loadSocial(fetched, gen);
    void loadDeferrers(fetched).then((deferrers) => {
      if (gen !== wikiPaintGen || event?.id !== fetched.id) return;
      deferredByList = deferrers;
    });
  }

  async function eventFromId(id: string): Promise<Event | null> {
    const fromMem = memoryGetEvent(id);
    if (fromMem) return fromMem;
    const mercury = await mercuryFilter({ ids: [id], limit: 1 });
    if (mercury[0]) {
      rememberEvents([mercury[0]]);
      return mercury[0];
    }
    const hit = (await relayPool.query(wikiStack(), [{ ids: [id], limit: 1 }]))[0] ?? null;
    if (hit) rememberEvents([hit]);
    return hit;
  }

  async function forwardDeference(from: Event): Promise<boolean> {
    if (hashQuery().get('deferredBy')) return false;
    const target = getWikiDeferTarget(from);
    if (!target) return false;
    let path: string | null = null;
    if (target.coordinate) {
      const parsed = parseAddress(target.coordinate);
      if (parsed && parsed.pubkey === from.pubkey) {
        const d = from.tags.find((t) => t[0] === 'd')?.[1] ?? '';
        if (parsed.d === d) return false;
      }
      warmAddress(target.coordinate);
      path = addressPath(target.coordinate);
    }
    if (!path && target.eventId) {
      const dest = await eventFromId(target.eventId);
      if (dest) {
        warmNavEvent(dest);
        path = libraryDocumentPath(dest);
      }
    }
    if (!path) return false;
    forwarding = true;
    replace(`${path}?deferredBy=${from.pubkey}`);
    return true;
  }

  async function loadSocial(target: Event, gen: number): Promise<void> {
    const hit = await fetchWorkResponses(target, 60);
    if (gen !== wikiPaintGen || event?.id !== target.id) return;
    responses = hit;
  }

  $effect(() => {
    // Prefer router params; fall back to parsing the hash so a stale/empty params
    // object never skips the lookup and flashes "not found".
    const hashPath = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '').split('?')[0] : '';
    const kind = routeKindFromHash(hashPath);
    routeKind = kind;
    const prefix =
      kind === KIND.SPEC ? 'spec' : kind === KIND.LONG_FORM ? 'article' : 'wiki';
    const hashDnpub = hashPath.match(new RegExp(`^\\/${prefix}\\/d\\/([^/]+)\\/p\\/([^/]+)\\/?$`, 'i'));
    const hashDonly = hashPath.match(new RegExp(`^\\/${prefix}\\/d\\/([^/]+)\\/?$`, 'i'));
    const hashPointer = hashPath.match(
      new RegExp(
        `^\\/${prefix}\\/(?:(?:naddr|nevent|note)\\/)?((?:naddr|nevent|note)1[02-9ac-hj-np-z]+)\\/?$`,
        'i'
      )
    );

    const dTag = decodeParam(
      params.d || (hashDnpub?.[1] ?? hashDonly?.[1] ?? '')
    );
    const npubParam = (params.npub || hashDnpub?.[2] || '').split('?')[0];
    const naddrRaw = params.naddr || hashPointer?.[1] || '';
    const naddr = isBech32Pointer(naddrRaw) ? naddrRaw : '';

    let cancelled = false;
    const paintGen = ++wikiPaintGen;
    versions = [];
    responses = { thread: [], quotes: [], highlights: [] };
    error = false;
    forwarding = false;
    deferredByList = seedDeferrersFromUrl();

    const pubkey = npubParam ? hexFromNpubParam(npubParam) : '';
    const warm = dTag && pubkey ? warmArticle(pubkey, dTag, kind) : null;

    if (warm) {
      void paintWiki(warm, paintGen);
    } else {
      event = null;
      loading = true;
    }

    void (async () => {
      try {
        // Author+d is the normal deep link — never let a stray naddr param steal this path.
        if (dTag && npubParam) {
          if (!pubkey) {
            if (!cancelled) error = true;
            return;
          }
          if (warm) return;
          const slug = normalizeDTag(dTag) || dTag;
          // Memory / shallow cache only — a full Cache Storage walk blocks wiki for seconds.
          const cached =
            memoryFindByAddress(kind, pubkey, slug) ??
            (await cacheFindByAddress(kind, pubkey, slug));
          if (cancelled) return;
          if (cached) {
            await paintWiki(cached, paintGen);
            return;
          }
          const fetched = await loadArticleByAuthorD(pubkey, dTag, kind, (early) => {
            if (!cancelled) void paintWiki(early, paintGen);
          });
          if (cancelled) return;
          if (fetched) {
            if (!event || event.id !== fetched.id) await paintWiki(fetched, paintGen);
          } else if (!cancelled && !event) error = true;
          return;
        }

        if (naddr) {
          const decoded = decodePublicationPointer(naddr);
          if (!decoded) {
            if (!cancelled) error = true;
            return;
          }
          // Pointer kind wins over the URL prefix so a wiki naddr under /spec (or vice versa)
          // canonicalizes to the correct surface.
          const pointerKind = isArticleKind(decoded.kind) ? decoded.kind : kind;
          let fetched: Event | null = null;
          if (decoded.id) {
            fetched = memoryGetEvent(decoded.id) ?? (await fetchById(decoded.id));
          } else if (decoded.pubkey && decoded.d != null) {
            fetched =
              warmArticle(decoded.pubkey, decoded.d, pointerKind) ??
              (await loadArticleByAuthorD(decoded.pubkey, decoded.d, pointerKind, (early) => {
                if (!cancelled) void paintWiki(early, paintGen);
              }));
          }
          if (cancelled) return;
          if (!fetched || !isArticleKind(fetched.kind)) {
            if (!event) error = true;
            return;
          }
          const path = libraryDocumentPath(fetched);
          const here = window.location.hash.replace(/^#/, '').split('?')[0];
          if (here !== path) {
            replace(path);
            return;
          }
          await paintWiki(fetched, paintGen);
          return;
        }

        if (dTag && !npubParam) {
          const filter = { kinds: [kind], '#d': [dTag], limit: 50 };
          const [m, w] = await Promise.all([
            mercuryFilter(filter),
            relayPool.query(stackForArticleKind(kind), [filter], 8000)
          ]);
          const byId = new Map<string, Event>();
          for (const e of [...m, ...w]) {
            if (e.kind === kind) byId.set(e.id, e);
          }
          const found = [...byId.values()];
          if (cancelled) return;
          if (!found.length) {
            error = true;
            return;
          }
          rememberEvents(found);
          versions = found;
          return;
        }

        if (!cancelled) error = true;
      } catch {
        if (!cancelled) error = true;
      } finally {
        if (!cancelled) loading = false;
      }
    })();

    return () => {
      cancelled = true;
      if (paintGen === wikiPaintGen) wikiPaintGen++;
    };
  });
</script>

<TopBar />
<main class="shell">
  {#if error}
    <ErrorPage title={`${surfaceLabel} page not found`} />
  {:else if forwarding}
    <p class="loading-hint">Opening the preferred version…</p>
  {:else if versions.length}
    <header class="page-header">
      <p class="page-kicker">{surfaceLabel}</p>
      <h1>Versions</h1>
      <p class="page-lede muted">Choose which author’s version of this page to open.</p>
    </header>
    <PageFilter bind:value={pageFilter} />
    <div class="card-grid card-grid-results">
      {#each visibleVersions as version (version.id)}
        <div>
          {#if isLibraryCopyPubkey(version.pubkey)}
            <p class="muted">Library copy</p>
          {/if}
          <PublicationCard event={version} />
        </div>
      {/each}
    </div>
  {:else if event}
    {#if deferredByList.length}
      <div class="wiki-defer-banner">
        <p class="wiki-defer-banner-title">Deferred to by</p>
        <ul class="wiki-defer-list">
          {#each deferredByList as pk (pk)}
            <li><UserBadge pubkey={pk} /></li>
          {/each}
        </ul>
      </div>
    {/if}
    <PageFilter
      bind:value={pageFilter}
      placeholder="Find in this page…"
      onEnter={cyclePageFind}
    />
    <article class="card reading-body" bind:this={articlePane}>
      <EditionHeader {event} />
      {#if !hideBody}
        <EventBody {event} quotes={bodyHighlights} />
      {/if}
      <DetailsPanel {event} />
    </article>
    <div class="card reading-width" style="margin-top:1rem">
      <WorkCommentsPanel target={event} responses={panelResponses} focusId={urlFocusComment} />
    </div>
  {:else}
    <p class="loading-hint">Page is loading...</p>
  {/if}
</main>
