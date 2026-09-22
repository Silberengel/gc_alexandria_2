<script lang="ts">
  import { replace } from 'svelte-spa-router';
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
  import { mercuryFilter } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { wikiStack, socialStack } from '$lib/nostr/selector';
  import { eventAddress } from '$lib/nostr/verify';
  import { fetchById } from '$lib/nostr/fetch';
  import { muteState, filterMuted } from '$lib/mute';
  import { createPageFindController, filterPageEvents } from '$lib/page-filter';
  import { nestComments, fetchThreadEvents } from '$lib/comments';
  import { commentDraft } from '$lib/drafts';
  import { signAndPublish } from '$lib/sign';
  import { session } from '$lib/stores/session';
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
      const relayHits = await relayPool.query(wikiStack(), filters, 4000, 2);
      for (const e of relayHits) byId.set(e.id, e);
    }
    return deferrerPubkeys([...byId.values()], target, seeds);
  }

  async function paintWiki(fetched: Event): Promise<void> {
    if (await forwardDeference(fetched)) return;
    event = fetched;
    loading = false;
    // Social + deferrers after first paint — waiting on them left the page stuck under rate limits.
    void loadSocial(fetched);
    void loadDeferrers(fetched).then((deferrers) => {
      deferredByList = deferrers;
    });
  }

  async function eventFromId(id: string): Promise<Event | null> {
    const mercury = await mercuryFilter({ ids: [id], limit: 1 });
    if (mercury[0]) return mercury[0];
    return (await relayPool.query(wikiStack(), [{ ids: [id], limit: 1 }]))[0] ?? null;
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
      path = addressPath(target.coordinate);
    }
    if (!path && target.eventId) {
      const dest = await eventFromId(target.eventId);
      if (dest) path = wikiPath(dest);
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
    const dTag = params.d;
    const npubParam = params.npub;
    const naddr = params.naddr;
    let cancelled = false;
    event = null;
    versions = [];
    comments = [];
    highlights = [];
    replyOpenId = null;
    error = false;
    forwarding = false;
    loading = true;
    deferredByList = seedDeferrersFromUrl();

    void (async () => {
      try {
        if (naddr) {
          const decoded = decodePublicationPointer(naddr);
          if (!decoded) {
            error = true;
            return;
          }
          let fetched: Event | null = null;
          if (decoded.id) fetched = await fetchById(decoded.id);
          else if (decoded.pubkey && decoded.d != null) {
            const filter = {
              kinds: [decoded.kind ?? KIND.WIKI, KIND.SPEC],
              authors: [decoded.pubkey],
              '#d': [decoded.d],
              limit: 2
            };
            fetched =
              (await Promise.all([
                mercuryFilter(filter),
                relayPool.query(wikiStack(), [filter])
              ]).then(([m, w]) => m[0] ?? w[0] ?? null));
          }
          if (cancelled) return;
          if (!fetched || (fetched.kind !== KIND.WIKI && fetched.kind !== KIND.SPEC)) {
            error = true;
            return;
          }
          const path = wikiPath(fetched);
          const here = window.location.hash.replace(/^#/, '').split('?')[0];
          if (here !== path) {
            // Let the d/npub route effect load once — avoid double social fan-out.
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
            relayPool.query(wikiStack(), [filter], 5000, 2)
          ]);
          const byId = new Map<string, Event>();
          for (const e of [...m, ...w]) byId.set(e.id, e);
          const found = [...byId.values()];
          if (cancelled) return;
          if (!found.length) {
            error = true;
            return;
          }
          versions = found;
          return;
        }

        if (dTag && npubParam) {
          const pubkey = hexFromNpubParam(npubParam);
          const filter = {
            kinds: [KIND.WIKI, KIND.SPEC],
            authors: [pubkey],
            '#d': [dTag],
            limit: 1
          };
          const [wHits, mHits] = await Promise.all([
            relayPool.query(wikiStack(), [filter], 5000, 2),
            mercuryFilter(filter)
          ]);
          const fetched = wHits[0] ?? mHits[0] ?? null;
          if (cancelled) return;
          if (!fetched) {
            error = true;
            return;
          }
          await paintWiki(fetched);
        }
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
    <section class="card" style="margin-top:1rem">
      <h2>Comments</h2>
      {#if thread.length}
        <ul class="thread-list">
          {#each thread as node (node.event?.id ?? node.placeholder)}
            <CommentThread {node} target={event} bind:replyOpenId />
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
        <button class="btn" type="button" onclick={() => session.signIn()}>Sign in to comment</button>
      {/if}
    </section>
  {:else}
    <p class="loading-hint">Page is loading...</p>
  {/if}
</main>
