<script lang="ts">
  import { replace, querystring } from 'svelte-spa-router';
  import TopBar from '$lib/components/TopBar.svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import EventBody from '$lib/components/EventBody.svelte';
  import CommentThread from '$lib/components/CommentThread.svelte';
  import DetailsPanel from '$lib/components/DetailsPanel.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import EditionHeader from '$lib/components/EditionHeader.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import { KIND } from '$lib/constants';
  import { wikiPath } from '$lib/metadata';
  import { addressPath, parseAddress } from '$lib/library-scope';
  import { getWikiDeferTarget, isDeferralPlaceholderContent, isWikiDeference, deferrerPubkeys } from '$lib/wiki-defer';
  import { normalizeDTag } from '$lib/dtag';
  import { mercuryFilter } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { wikiStack, socialStack } from '$lib/nostr/selector';
  import { eventAddress } from '$lib/nostr/verify';
  import { fetchById } from '$lib/nostr/fetch';
  import { memoryFindByAddress, memoryGetEvent, rememberEvents } from '$lib/nostr/event-memory';
  import { isNewerReplaceable } from '$lib/nostr/replaceable';
  import { cacheFindByAddress } from '$lib/nostr/cache';
  import { warmAddress, warmNavEvent } from '$lib/nav-warm';
  import { muteState, filterMuted } from '$lib/mute';
  import { createPageFindController, filterPageEvents } from '$lib/page-filter';
  import { nestComments, fetchThreadEvents, threadNodeKey } from '$lib/comments';
  import { commentDraft } from '$lib/drafts';
  import { signAndPublish } from '$lib/sign';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { isLibraryCopyPubkey } from '$lib/hex';
  import { decodePublicationPointer, hexFromNpubParam } from '$lib/publication-load';
  import { textHighlightsFromEvents } from '$lib/text-highlights';
  import { publicationCoordinateLookupKeys } from '$lib/publication-coordinate';
  import type { Event } from 'nostr-tools';

  interface Props {
    params?: { d?: string; npub?: string; naddr?: string };
  }

  let { params = {} }: Props = $props();

  let event = $state<Event | null>(null);
  let versions = $state<Event[]>([]);
  let comments = $state<Event[]>([]);
  let highlights = $state<Event[]>([]);
  let error = $state(false);
  let deferredByList = $state<string[]>([]);
  let forwarding = $state(false);
  let commentText = $state('');
  let replyOpenId = $state<string | null>(null);
  let pageFilter = $state('');
  let loading = $state(true);
  let articlePane = $state<HTMLElement | undefined>();
  const pageFind = createPageFindController();

  const visibleComments = $derived(filterPageEvents(filterMuted(comments, $muteState), pageFilter));
  const mutedHighlights = $derived(filterMuted(highlights, $muteState));
  const bodyHighlights = $derived(textHighlightsFromEvents(mutedHighlights));
  const visibleVersions = $derived(filterPageEvents(versions, pageFilter));
  const thread = $derived(event ? nestComments(visibleComments, $muteState, [event.id]) : []);
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

  /** Sync only — landing/search already put this in memory. Never scan Cache Storage here. */
  function warmWiki(pubkey: string, d: string): Event | null {
    const slug = normalizeDTag(d) || d;
    return (
      memoryFindByAddress(KIND.WIKI, pubkey, slug) ??
      memoryFindByAddress(KIND.SPEC, pubkey, slug) ??
      memoryFindByAddress(KIND.WIKI, pubkey, d) ??
      memoryFindByAddress(KIND.SPEC, pubkey, d)
    );
  }

  /**
   * Cold load: Mercury (if up) then wikiStack across relays in parallel.
   * `onHit` fires as soon as any relay returns the article so SPA nav can paint early.
   * Uses a priority pool slot so Home background FoF/deletion REQs cannot starve wiki.
   */
  async function loadWikiByAuthorD(
    pubkey: string,
    d: string,
    onHit?: (event: Event) => void
  ): Promise<Event | null> {
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
    const slug = normalizeDTag(d) || d;
    const dValues = [...new Set([d, slug].filter(Boolean))];
    const filter = {
      kinds: [KIND.WIKI, KIND.SPEC],
      authors: [pubkey],
      '#d': dValues,
      limit: 5
    };
    let reported = false;
    const report = (event: Event): void => {
      if (reported) return;
      if (event.kind !== KIND.WIKI && event.kind !== KIND.SPEC) return;
      reported = true;
      onHit?.(event);
    };
    const pickNewest = (events: Event[]): Event | null => {
      let best: Event | null = null;
      for (const event of events) {
        if (event.kind !== KIND.WIKI && event.kind !== KIND.SPEC) continue;
        if (!best || isNewerReplaceable(event, best)) best = event;
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
      wikiStack(),
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
    void comments;
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

  async function paintWiki(fetched: Event): Promise<void> {
    // Paint immediately — never leave "Page is loading…" waiting on deference I/O.
    rememberEvents([fetched]);
    event = fetched;
    loading = false;
    if (await forwardDeference(fetched)) return;
    // Social + deferrers after first paint — waiting on them left the page stuck under rate limits.
    void loadSocial(fetched);
    void loadDeferrers(fetched).then((deferrers) => {
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
        path = wikiPath(dest);
      }
    }
    if (!path) return false;
    forwarding = true;
    replace(`${path}?deferredBy=${from.pubkey}`);
    return true;
  }

  async function loadSocial(target: Event): Promise<void> {
    const addr = eventAddress(target);
    const highlightAddrs = [...new Set(publicationCoordinateLookupKeys(addr))].slice(0, 20);
    const [threadEvents, highlightsHit] = await Promise.all([
      fetchThreadEvents(target, 40),
      highlightAddrs.length
        ? relayPool.query(
            socialStack(),
            [{ kinds: [KIND.HIGHLIGHT], '#a': highlightAddrs, limit: 40 }],
            4000,
            2
          )
        : Promise.resolve([] as Event[])
    ]);
    comments = threadEvents;
    highlights = highlightsHit;
  }

  $effect(() => {
    // Prefer router params; fall back to parsing the hash so a stale/empty params
    // object never skips the lookup and flashes "not found".
    const hashPath = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '').split('?')[0] : '';
    const hashDnpub = hashPath.match(/^\/wiki\/d\/([^/]+)\/p\/([^/]+)\/?$/);
    const hashDonly = hashPath.match(/^\/wiki\/d\/([^/]+)\/?$/);
    const hashPointer = hashPath.match(/^\/wiki\/((?:naddr|nevent|note)1[02-9ac-hj-np-z]+)\/?$/i);

    const dTag = decodeParam(
      params.d || (hashDnpub?.[1] ?? hashDonly?.[1] ?? '')
    );
    const npubParam = (params.npub || hashDnpub?.[2] || '').split('?')[0];
    const naddrRaw = params.naddr || hashPointer?.[1] || '';
    const naddr = isBech32Pointer(naddrRaw) ? naddrRaw : '';

    let cancelled = false;
    versions = [];
    comments = [];
    highlights = [];
    replyOpenId = null;
    error = false;
    forwarding = false;
    deferredByList = seedDeferrersFromUrl();

    const pubkey = npubParam ? hexFromNpubParam(npubParam) : '';
    const warm = dTag && pubkey ? warmWiki(pubkey, dTag) : null;

    if (warm) {
      void paintWiki(warm);
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
            memoryFindByAddress(KIND.WIKI, pubkey, slug) ??
            memoryFindByAddress(KIND.SPEC, pubkey, slug) ??
            (await cacheFindByAddress(KIND.WIKI, pubkey, slug)) ??
            (await cacheFindByAddress(KIND.SPEC, pubkey, slug));
          if (cancelled) return;
          if (cached) {
            await paintWiki(cached);
            return;
          }
          const fetched = await loadWikiByAuthorD(pubkey, dTag, (early) => {
            if (!cancelled) void paintWiki(early);
          });
          if (cancelled) return;
          if (fetched) {
            if (!event || event.id !== fetched.id) await paintWiki(fetched);
          } else if (!cancelled && !event) error = true;
          return;
        }

        if (naddr) {
          const decoded = decodePublicationPointer(naddr);
          if (!decoded) {
            if (!cancelled) error = true;
            return;
          }
          let fetched: Event | null = null;
          if (decoded.id) {
            fetched = memoryGetEvent(decoded.id) ?? (await fetchById(decoded.id));
          } else if (decoded.pubkey && decoded.d != null) {
            fetched =
              warmWiki(decoded.pubkey, decoded.d) ??
              (await loadWikiByAuthorD(decoded.pubkey, decoded.d, (early) => {
                if (!cancelled) void paintWiki(early);
              }));
          }
          if (cancelled) return;
          if (!fetched || (fetched.kind !== KIND.WIKI && fetched.kind !== KIND.SPEC)) {
            if (!event) error = true;
            return;
          }
          const path = wikiPath(fetched);
          const here = window.location.hash.replace(/^#/, '').split('?')[0];
          if (here !== path) {
            replace(path);
            return;
          }
          await paintWiki(fetched);
          return;
        }

        if (dTag && !npubParam) {
          const filter = { kinds: [KIND.WIKI, KIND.SPEC], '#d': [dTag], limit: 50 };
          const [m, w] = await Promise.all([
            mercuryFilter(filter),
            relayPool.query(wikiStack(), [filter], 8000)
          ]);
          const byId = new Map<string, Event>();
          for (const e of [...m, ...w]) byId.set(e.id, e);
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
    };
  });

  async function postComment(): Promise<void> {
    if (!event) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    if (!commentText.trim()) return;
    const signed = await signAndPublish(commentDraft(event, commentText.trim()));
    if (signed) {
      comments = [...comments, signed];
      commentText = '';
    }
  }
</script>

<TopBar />
<main class="shell">
  {#if error}
    <ErrorPage title="Wiki page not found" />
  {:else if forwarding}
    <p class="loading-hint">Opening the preferred version…</p>
  {:else if versions.length}
    <h1>Versions</h1>
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
    <section class="card reading-width" style="margin-top:1rem">
      <h2>Comments</h2>
      {#if thread.length}
        <ul class="thread-list">
          {#each thread as node (threadNodeKey(node))}
            <CommentThread {node} target={event} bind:replyOpenId focusId={urlFocusComment} />
          {/each}
        </ul>
      {:else}
        <p class="muted">No comments yet.</p>
      {/if}
      {#if $session.pubkey && !replyOpenId}
        <form class="compose" onsubmit={(e) => { e.preventDefault(); void postComment(); }}>
          <textarea bind:value={commentText} rows="3" placeholder="Write a comment"></textarea>
          <button class="btn btn-primary" type="submit" disabled={!commentText.trim()}>Post</button>
        </form>
      {:else if !$session.pubkey}
        <button class="btn" type="button" onclick={() => openLoginDialog()}>Sign in to comment</button>
      {/if}
    </section>
  {:else}
    <p class="loading-hint">Page is loading...</p>
  {/if}
</main>
