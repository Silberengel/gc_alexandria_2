<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { KIND } from '$lib/constants';
  import { feedThreadPointerFromId } from '$lib/feed';
  import { warmNavEvent } from '$lib/nav-warm';
  import { cachedEventsReferencing } from '$lib/nostr/cache';
  import { memoryGetEvent } from '$lib/nostr/event-memory';
  import { relayPool } from '$lib/nostr/pool';
  import { socialStack } from '$lib/nostr/selector';
  import { reactionDraft, fetchReactionsForIds } from '$lib/reactions';
  import { consumeSignFailure, publishSigned, signUnsigned } from '$lib/sign';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { showNotice } from '$lib/stores/toast';
  import {
    canRespondToWikiMerge,
    isMergeAcceptReaction,
    isMergeRejectReaction,
    parseWikiMergeAcceptance,
    parseWikiMergeRequest,
    wikiMergeTargetHref
  } from '$lib/wiki-merge';
  import { libraryDocumentPath } from '$lib/metadata';

  function threadHrefForId(id: string): string {
    return `#/feed?thread=${feedThreadPointerFromId(id)}`;
  }

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  let reactions = $state<Event[]>([]);
  let acceptances = $state<Event[]>([]);
  let pending = $state(false);

  const merge = $derived(parseWikiMergeRequest(event));
  const acceptance = $derived(
    event.kind === KIND.WIKI_MERGE_ACCEPTANCE ? parseWikiMergeAcceptance(event) : null
  );
  const canRespond = $derived(canRespondToWikiMerge(event, $session.pubkey));
  const targetHref = $derived(merge ? wikiMergeTargetHref(merge) : null);

  const myAccept = $derived(
    reactions.find((r) => isMergeAcceptReaction(r, event.id) && r.pubkey === $session.pubkey) ??
      null
  );
  const myReject = $derived(
    reactions.find((r) => isMergeRejectReaction(r, event.id) && r.pubkey === $session.pubkey) ??
      null
  );
  const anyAccept = $derived(
    acceptances.length > 0 || reactions.some((r) => isMergeAcceptReaction(r, event.id))
  );
  const anyReject = $derived(reactions.some((r) => isMergeRejectReaction(r, event.id)));

  const primaryAcceptance = $derived(
    [...acceptances].sort((a, b) => b.created_at - a.created_at)[0] ?? null
  );
  const resultHref = $derived.by(() => {
    const parsed = primaryAcceptance ? parseWikiMergeAcceptance(primaryAcceptance) : null;
    if (!parsed?.resultEventId) return null;
    const hit = memoryGetEvent(parsed.resultEventId);
    if (hit) return `#${libraryDocumentPath(hit)}`;
    return threadHrefForId(parsed.resultEventId);
  });

  $effect(() => {
    if (event.kind !== KIND.WIKI_MERGE_REQUEST) {
      reactions = [];
      acceptances = [];
      return;
    }
    const id = event.id.toLowerCase();
    let cancelled = false;
    void (async () => {
      const [rxn, fromCache] = await Promise.all([
        fetchReactionsForIds([id]),
        cachedEventsReferencing(id)
      ]);
      if (cancelled) return;
      reactions = rxn.filter(
        (e) => isMergeAcceptReaction(e, id) || isMergeRejectReaction(e, id)
      );
      const cached819 = fromCache.filter((e) => e.kind === KIND.WIKI_MERGE_ACCEPTANCE);
      if (cached819.length) acceptances = cached819;
      const hits = await relayPool.query(
        socialStack(),
        [{ kinds: [KIND.WIKI_MERGE_ACCEPTANCE], '#e': [id], limit: 20 }],
        4000
      );
      if (cancelled) return;
      const byId = new Map<string, Event>();
      for (const e of [...cached819, ...hits]) byId.set(e.id, e);
      acceptances = [...byId.values()];
    })();
    return () => {
      cancelled = true;
    };
  });

  async function respond(content: '+' | '-'): Promise<void> {
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    if (!canRespond || pending) return;
    pending = true;
    try {
      const signed = await signUnsigned(reactionDraft(event, content));
      if (!signed) {
        consumeSignFailure();
        showNotice(content === '+' ? 'Accept was not signed.' : 'Reject was not signed.');
        return;
      }
      const wrote = await publishSigned(signed);
      if (!wrote) {
        showNotice('Reaction was signed, but no relay accepted it.');
        return;
      }
      reactions = [signed, ...reactions.filter((r) => r.pubkey !== signed.pubkey)];
      showNotice(content === '+' ? 'Merge request accepted.' : 'Merge request rejected.');
    } finally {
      pending = false;
    }
  }

  function sourceHref(): string | null {
    const sid = merge?.sourceEventId;
    if (!sid) return null;
    const hit = memoryGetEvent(sid);
    if (hit && (hit.kind === KIND.WIKI || hit.kind === KIND.SPEC)) {
      return `#${libraryDocumentPath(hit)}`;
    }
    return threadHrefForId(sid);
  }

  function acceptanceResultPath(): string | null {
    if (!acceptance?.resultEventId) return null;
    const hit = memoryGetEvent(acceptance.resultEventId);
    if (hit) return `#${libraryDocumentPath(hit)}`;
    return threadHrefForId(acceptance.resultEventId);
  }

  function warmAndGo(href: string | null): void {
    if (!href) return;
    if (merge?.sourceEventId) {
      const hit = memoryGetEvent(merge.sourceEventId);
      if (hit) warmNavEvent(hit);
    }
  }
</script>

{#if event.kind === KIND.WIKI_MERGE_ACCEPTANCE && acceptance}
  <div class="wiki-merge-card wiki-merge-acceptance">
    <p class="wiki-merge-kind muted">KIND: 819 · Wiki merge acceptance</p>
    <p class="wiki-merge-status">This merge request was accepted (legacy 819).</p>
    {#if acceptanceResultPath()}
      <p>
        <a
          href={acceptanceResultPath()!}
          onclick={() => {
            const hit = memoryGetEvent(acceptance.resultEventId!);
            if (hit) warmNavEvent(hit);
          }}>View merged version</a
        >
      </p>
    {/if}
  </div>
{:else if merge}
  <div class="wiki-merge-card">
    <p class="wiki-merge-kind muted">KIND: 818 · Wiki merge request</p>
    {#if merge.explanation.trim()}
      <p class="wiki-merge-explain">{merge.explanation.trim()}</p>
    {/if}
    <ul class="wiki-merge-links">
      {#if targetHref}
        <li>
          <a href={`#${targetHref}`}>Destination article</a>
        </li>
      {/if}
      {#if sourceHref()}
        <li>
          <a href={sourceHref()!} onclick={() => warmAndGo(sourceHref())}>Version to merge</a>
        </li>
      {/if}
    </ul>

    {#if primaryAcceptance && resultHref}
      <p class="wiki-merge-banner wiki-merge-banner-ok">
        Merged into
        <a href={resultHref}>the resulting version</a>
        (kind 819).
      </p>
    {:else if anyAccept}
      <p class="wiki-merge-banner wiki-merge-banner-ok">Accepted (+)</p>
    {:else if anyReject}
      <p class="wiki-merge-banner wiki-merge-banner-no">Rejected (−)</p>
    {/if}

    {#if canRespond}
      <div class="wiki-merge-actions">
        <button
          type="button"
          class="btn-secondary"
          disabled={pending || !!myAccept}
          onclick={() => void respond('+')}
        >
          {myAccept ? 'Accepted' : 'Accept'}
        </button>
        <button
          type="button"
          class="btn-secondary"
          disabled={pending || !!myReject}
          onclick={() => void respond('-')}
        >
          {myReject ? 'Rejected' : 'Reject'}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .wiki-merge-card {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .wiki-merge-kind {
    margin: 0;
    font-size: 0.75rem;
  }
  .wiki-merge-explain {
    margin: 0;
    white-space: pre-wrap;
  }
  .wiki-merge-links {
    margin: 0;
    padding-left: 1.1rem;
  }
  .wiki-merge-banner {
    margin: 0;
    padding: 0.45rem 0.65rem;
    border-radius: 0.35rem;
    font-size: 0.9rem;
  }
  .wiki-merge-banner-ok {
    background: color-mix(in srgb, var(--accent, #2a7) 18%, transparent);
  }
  .wiki-merge-banner-no {
    background: color-mix(in srgb, var(--danger, #c44) 18%, transparent);
  }
  .wiki-merge-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .wiki-merge-status {
    margin: 0;
  }
</style>
