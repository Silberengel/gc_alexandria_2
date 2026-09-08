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
  import { getWikiDeferTarget, isDeferralPlaceholderContent, isWikiDeference } from '$lib/wiki-defer';
  import { mercuryFilter } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { wikiStack, socialStack } from '$lib/nostr/selector';
  import { eventAddress } from '$lib/nostr/verify';
  import { fetchById } from '$lib/nostr/fetch';
  import { muteState, filterMuted } from '$lib/mute';
  import { createPageFindController, filterPageEvents } from '$lib/page-filter';
  import { nestComments } from '$lib/comments';
  import { commentDraft } from '$lib/drafts';
  import { signAndPublish } from '$lib/sign';
  import { session } from '$lib/stores/session';
  import { isLibraryCopyPubkey } from '$lib/hex';
  import { decodePublicationPointer, hexFromNpubParam } from '$lib/publication-load';
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
  let deferredBy = $state('');
  let forwarding = $state(false);
  let commentText = $state('');
  let pageFilter = $state('');
  let loading = $state(true);
  let articlePane = $state<HTMLElement | undefined>();
  const pageFind = createPageFindController();

  const visibleComments = $derived(filterPageEvents(filterMuted(comments, $muteState), pageFilter));
  const visibleHighlights = $derived(filterPageEvents(filterMuted(highlights, $muteState), pageFilter));
  const visibleVersions = $derived(filterPageEvents(versions, pageFilter));
  const thread = $derived(event ? nestComments(visibleComments, $muteState) : []);
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
    const [cA, ca, h] = await Promise.all([
      relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#A': [addr], limit: 50 }]),
      relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], '#a': [addr], limit: 50 }]),
      relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], '#a': [addr], limit: 50 }])
    ]);
    const byId = new Map<string, Event>();
    for (const e of [...cA, ...ca]) byId.set(e.id, e);
    comments = [...byId.values()];
    highlights = h;
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
    error = false;
    forwarding = false;
    loading = true;
    deferredBy = hashQuery().get('deferredBy') ?? '';

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
          replace(wikiPath(fetched));
          if (await forwardDeference(fetched)) return;
          event = fetched;
          await loadSocial(fetched);
          return;
        }

        if (dTag && !npubParam) {
          const filter = { kinds: [KIND.WIKI, KIND.SPEC], '#d': [dTag], limit: 50 };
          const [m, w] = await Promise.all([
            mercuryFilter(filter),
            relayPool.query(wikiStack(), [filter])
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
            relayPool.query(wikiStack(), [filter]),
            mercuryFilter(filter)
          ]);
          const fetched = wHits[0] ?? mHits[0] ?? null;
          if (cancelled) return;
          if (!fetched) {
            error = true;
            return;
          }
          if (await forwardDeference(fetched)) return;
          if (cancelled) return;
          event = fetched;
          await loadSocial(fetched);
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
    {#if deferredBy}
      <p class="wiki-defer-banner">Deferred to by: <UserBadge pubkey={deferredBy} /></p>
    {/if}
    <PageFilter
      bind:value={pageFilter}
      placeholder="Find in this page…"
      onEnter={cyclePageFind}
    />
    <article class="card reading-body" bind:this={articlePane}>
      <EditionHeader {event} />
      {#if !hideBody}
        <EventBody {event} />
      {/if}
      <DetailsPanel {event} />
    </article>
    {#if visibleHighlights.length}
      <section class="card" style="margin-top:1rem">
        <h2>Highlights</h2>
        {#each visibleHighlights as h (h.id)}
          <p>
            <UserBadge pubkey={h.pubkey} />
          </p>
          <EventBody event={h} />
        {/each}
      </section>
    {/if}
    <section class="card" style="margin-top:1rem">
      <h2>Comments</h2>
      {#if thread.length}
        <ul class="thread-list">
          {#each thread as node (node.event?.id ?? node.placeholder)}
            <CommentThread {node} target={event} />
          {/each}
        </ul>
      {:else}
        <p class="muted">No comments yet.</p>
      {/if}
      {#if $session.pubkey}
        <form class="compose" onsubmit={(e) => { e.preventDefault(); void postComment(); }}>
          <textarea bind:value={commentText} rows="3" placeholder="Write a comment"></textarea>
          <button class="btn btn-primary" type="submit" disabled={!commentText.trim()}>Post</button>
        </form>
      {:else}
        <button class="btn" type="button" onclick={() => session.signIn()}>Sign in to comment</button>
      {/if}
    </section>
  {:else}
    <p class="loading-hint">Page is loading...</p>
  {/if}
</main>
