<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { session } from '$lib/stores/session';
  import { showNotice } from '$lib/stores/toast';
  import { signAndPublish } from '$lib/sign';
  import { formatAbsoluteTime } from '$lib/relative-time';
  import { fetchPollResults } from '$lib/poll-results';
  import {
    addOptimisticPollVote,
    createPollResponseDraft,
    emptyPollResults,
    isPollExpired,
    parsePoll,
    parsePollForDraftPreview,
    pollHasVoted,
    pollOptionIds,
    pollOptionMedia,
    pollVotedOptionIds,
    votesForOption,
    type PollInfo,
    type PollResults
  } from '$lib/poll';

  interface Props {
    event: Event;
    /** When true, hide the question (thread OP already shows structured content). */
    hideQuestion?: boolean;
    /**
     * When false (feed list), show only a Vote link + question — no options/results.
     * Full controls live in the thread view.
     */
    showControls?: boolean;
    /** Thread URL for the feed Vote button (`#/feed?...`). */
    voteHref?: string;
    /** Warm/scroll hooks when opening the thread from Vote. */
    onVoteOpen?: () => void;
  }

  let {
    event,
    hideQuestion = false,
    showControls = true,
    voteHref = '',
    onVoteOpen
  }: Props = $props();

  const isDraftPreview = $derived(!/^[0-9a-f]{64}$/i.test(event.id.trim()));
  const pollInfo = $derived(
    (isDraftPreview ? parsePollForDraftPreview(event) : parsePoll(event)) as PollInfo | null
  );
  const pollKey = $derived(
    `${event.id}:${event.created_at}:${event.tags.map((t) => t.join('|')).join(';')}`
  );

  let results = $state<PollResults>(emptyPollResults(new Set()));
  let selected = $state<Set<string>>(new Set());
  let resultsRevealed = $state(false);
  let voting = $state(false);
  let refreshing = $state(false);
  let fetchGen = 0;

  const expired = $derived(pollInfo ? isPollExpired(pollInfo) : false);
  const viewerPubkey = $derived($session.pubkey);
  const hasVoted = $derived(
    !isDraftPreview && viewerPubkey ? pollHasVoted(results, viewerPubkey) : false
  );
  const canVote = $derived(
    !isDraftPreview && !expired && !hasVoted && Boolean(viewerPubkey) && pollInfo != null
  );
  const showResults = $derived(
    !isDraftPreview && (resultsRevealed || hasVoted || expired)
  );
  const votedIds = $derived(
    viewerPubkey ? pollVotedOptionIds(results, viewerPubkey) : new Set<string>()
  );

  async function refreshResults(info: PollInfo): Promise<void> {
    const gen = ++fetchGen;
    refreshing = true;
    try {
      const next = await fetchPollResults(event, info, (cached) => {
        if (gen === fetchGen) results = cached;
      });
      if (gen === fetchGen) results = next;
    } finally {
      if (gen === fetchGen) refreshing = false;
    }
  }

  $effect(() => {
    void pollKey;
    const info = pollInfo;
    const draft = isDraftPreview;
    const interactive = showControls;
    selected = new Set();
    resultsRevealed = false;
    if (!info || draft || !interactive) {
      results = emptyPollResults(info ? pollOptionIds(info) : new Set());
      return;
    }
    results = emptyPollResults(pollOptionIds(info));
    if (isPollExpired(info)) resultsRevealed = true;
    void refreshResults(info);
  });

  function toggleOption(optionId: string): void {
    if (!canVote || !pollInfo) return;
    const next = new Set(selected);
    if (pollInfo.isMultipleChoice) {
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
    } else if (next.has(optionId)) {
      next.clear();
    } else {
      next.clear();
      next.add(optionId);
    }
    selected = next;
  }

  async function seeResults(): Promise<void> {
    if (!pollInfo) return;
    resultsRevealed = true;
    await refreshResults(pollInfo);
  }

  async function castVote(): Promise<void> {
    if (!pollInfo || !viewerPubkey || selected.size === 0 || voting) return;
    voting = true;
    try {
      if (pollHasVoted(results, viewerPubkey)) {
        resultsRevealed = true;
        showNotice('You already voted on this poll.');
        return;
      }
      if (isPollExpired(pollInfo)) {
        showNotice('This poll has ended.');
        return;
      }
      const draft = createPollResponseDraft(event, [...selected]);
      const signed = await signAndPublish(draft, { quiet: true });
      if (!signed) {
        showNotice('Could not publish your vote.');
        return;
      }
      results = addOptimisticPollVote(
        results,
        viewerPubkey,
        [...selected],
        pollOptionIds(pollInfo)
      );
      selected = new Set();
      resultsRevealed = true;
      showNotice('Vote published.');
      void refreshResults(pollInfo);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Could not publish your vote.');
    } finally {
      voting = false;
    }
  }
</script>

{#if pollInfo}
  <div class="poll-card" class:poll-card-summary={!showControls}>
    <div class="poll-card-meta">
      <span class="poll-card-label">Poll</span>
      {#if pollInfo.isMultipleChoice}
        <span class="muted poll-card-multi">Multiple choice</span>
      {/if}
    </div>

    {#if !hideQuestion && pollInfo.question.trim()}
      <p class="poll-card-question">{pollInfo.question}</p>
    {/if}

    {#if pollInfo.endsAt}
      <p class="muted poll-card-ends">
        {#if expired}
          Poll has ended
        {:else}
          Ends {formatAbsoluteTime(pollInfo.endsAt)}
        {/if}
      </p>
    {/if}

    {#if !showControls && voteHref}
      <a
        class="btn btn-primary poll-card-vote-open"
        href={voteHref}
        use:link
        onclick={() => onVoteOpen?.()}
      >{expired ? 'View poll' : 'Vote'}</a>
    {/if}

    {#if showControls}
      <ul class="poll-card-options">
        {#each pollInfo.options as option (option.id)}
          {@const media = pollOptionMedia(option.label)}
          {@const votes = votesForOption(results, option.id)}
          {@const total = results.totalVotes}
          {@const pct = showResults && total > 0 ? votes / total : 0}
          {@const isSelected = selected.has(option.id)}
          {@const isVoted = votedIds.has(option.id)}
          <li>
            <button
              type="button"
              class="poll-option"
              class:is-selected={isSelected}
              class:is-voted={isVoted}
              class:show-results={showResults}
              disabled={!canVote}
              style={showResults && total > 0
                ? `--poll-pct: ${(pct * 100).toFixed(1)}%`
                : undefined}
              onclick={() => toggleOption(option.id)}
            >
              {#if media?.kind === 'image'}
                <img class="poll-option-media" src={media.url} alt="" />
              {:else if media?.kind === 'video'}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video class="poll-option-media" src={media.url} controls preload="metadata"></video>
              {:else if media?.kind === 'audio'}
                <audio class="poll-option-audio" src={media.url} controls preload="metadata"></audio>
              {:else if media?.kind === 'pdf'}
                <a
                  class="poll-option-pdf"
                  href={media.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onclick={(e) => e.stopPropagation()}
                >Open PDF</a>
              {:else}
                <span class="poll-option-label">{option.label}</span>
              {/if}
              {#if showResults}
                <span class="poll-option-score muted">
                  {total > 0 ? `${Math.round(pct * 100)}% (${votes})` : '0%'}
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>

      {#if !isDraftPreview && !showResults && !expired}
        <button
          type="button"
          class="btn poll-card-action"
          disabled={refreshing}
          onclick={() => void seeResults()}
        >
          {refreshing ? 'Loading…' : 'See results'}
        </button>
      {/if}

      {#if canVote && selected.size > 0}
        <button
          type="button"
          class="btn btn-primary poll-card-action"
          disabled={voting}
          onclick={() => void castVote()}
        >
          {voting ? 'Voting…' : 'Vote'}
        </button>
      {:else if !isDraftPreview && !expired && !viewerPubkey}
        <p class="muted poll-card-signin">Sign in to vote.</p>
      {/if}

      {#if showResults && results.totalVotes > 0}
        <p class="muted poll-card-total">
          {results.totalVotes}
          {results.totalVotes === 1 ? 'vote' : 'votes'}
        </p>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .poll-card {
    display: grid;
    gap: 0.55rem;
    margin: 0.35rem 0;
  }
  .poll-card-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.45rem 0.75rem;
  }
  .poll-card-label {
    font-size: 0.82rem;
    font-weight: 650;
    letter-spacing: 0.02em;
    color: var(--accent, var(--link));
  }
  .poll-card-multi {
    font-size: 0.78rem;
  }
  .poll-card-question {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .poll-card-ends,
  .poll-card-total,
  .poll-card-signin {
    margin: 0;
    font-size: 0.82rem;
  }
  .poll-card-options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
  .poll-option {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    margin: 0;
    padding: 0.55rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    border-radius: 0.45rem;
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--accent) 28%, transparent) 0,
        color-mix(in srgb, var(--accent) 28%, transparent) var(--poll-pct, 0%),
        transparent var(--poll-pct, 0%)
      ),
      color-mix(in srgb, var(--paper-dark) 18%, var(--paper-light));
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }
  .poll-option:disabled {
    cursor: default;
  }
  .poll-option.is-selected {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--rule));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .poll-option.is-voted:not(.is-selected) {
    border-color: color-mix(in srgb, var(--rule) 90%, var(--accent));
  }
  .poll-option-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .poll-option-score {
    flex: 0 0 auto;
    font-size: 0.78rem;
    font-weight: 650;
  }
  .poll-option-media {
    display: block;
    max-width: min(100%, 15rem);
    max-height: 12rem;
    border-radius: 0.35rem;
    object-fit: contain;
  }
  .poll-option-audio {
    width: min(100%, 16rem);
  }
  .poll-option-pdf {
    color: var(--accent, var(--link));
  }
  .poll-card-action {
    justify-self: stretch;
  }
  .poll-card-vote-open {
    justify-self: end;
  }
</style>
