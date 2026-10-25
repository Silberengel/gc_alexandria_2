<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import ThreadCompose from './ThreadCompose.svelte';
  import LoadingHint from './LoadingHint.svelte';
  import { collectLiveChatRows, liveChatDraft } from '$lib/live-chat';
  import { filterMuted, muteState } from '$lib/mute';
  import type { WorkResponses } from '$lib/comments';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { publishComment } from '$lib/sign';

  interface Props {
    target: Event;
    responses: WorkResponses;
    loading?: boolean;
    allowCompose?: boolean;
  }

  let { target, responses, loading = false, allowCompose = true }: Props = $props();

  let text = $state('');
  let posting = $state(false);
  let local = $state<Event[]>([]);
  let composeOpen = $state(false);

  const rows = $derived(
    collectLiveChatRows(target, {
      ...responses,
      thread: filterMuted([...responses.thread, ...local], $muteState),
      other: filterMuted(responses.other ?? [], $muteState),
      quotes: filterMuted(responses.quotes ?? [], $muteState)
    }).filter((row) => row.type === 'message')
  );

  function showPublished(event: Event): void {
    local = [...local.filter((e) => e.id !== event.id), event];
  }

  async function post(): Promise<void> {
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    if (!text.trim() || posting) return;
    posting = true;
    try {
      const published = await publishComment(liveChatDraft(target, text.trim()));
      if (!published) return;
      showPublished(published);
      text = '';
      composeOpen = false;
    } finally {
      posting = false;
    }
  }
</script>

<section class="live-chat-feed">
  <h2 class="section-title">Live chat</h2>

  {#if allowCompose}
    {#if $session.pubkey && composeOpen}
      <ThreadCompose
        bind:value={text}
        placeholder="Say something…"
        {posting}
        offerKind1={false}
        onSubmit={() => void post()}
        onCancel={() => (composeOpen = false)}
      />
    {:else}
      <button
        class="btn"
        type="button"
        onclick={() => ($session.pubkey ? (composeOpen = true) : openLoginDialog())}
      >
        {$session.pubkey ? 'Say something…' : 'Sign in to chat'}
      </button>
    {/if}
  {/if}

  {#if rows.length}
    <ul class="live-chat-list">
      {#each rows as row (row.event.id)}
        <li class="live-chat-line">
          <UserBadge pubkey={row.event.pubkey} />
          <span class="live-chat-colon" aria-hidden="true">:</span>
          <div class="live-chat-body">
            <EventBody event={row.event} showEmbeds={false} />
          </div>
        </li>
      {/each}
    </ul>
  {:else if loading}
    <LoadingHint message="Loading chat…" compact />
  {:else}
    <p class="muted">No messages yet.</p>
  {/if}
</section>
