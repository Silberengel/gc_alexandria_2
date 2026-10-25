<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import LoadingHint from './LoadingHint.svelte';
  import { collectLiveChatRows, liveChatDraft } from '$lib/live-chat';
  import { filterMuted, muteState } from '$lib/mute';
  import type { WorkResponses } from '$lib/comments';
  import { formatAbsoluteTime, formatChatTime } from '$lib/relative-time';
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
    } finally {
      posting = false;
    }
  }
</script>

<section class="live-chat-feed">
  <h2 class="section-title">Live chat</h2>

  {#if allowCompose}
    {#if $session.pubkey}
      <form
        class="live-chat-compose"
        onsubmit={(e) => {
          e.preventDefault();
          void post();
        }}
      >
        <input
          type="text"
          bind:value={text}
          placeholder="Say something…"
          disabled={posting}
          autocomplete="off"
          enterkeyhint="send"
          aria-label="Live chat message"
        />
      </form>
    {:else}
      <button class="btn" type="button" onclick={() => openLoginDialog()}>
        Sign in to chat
      </button>
    {/if}
  {/if}

  {#if rows.length}
    <ul class="live-chat-list">
      {#each rows as row (row.event.id)}
        <li class="live-chat-line">
          <div class="live-chat-meta">
            <UserBadge pubkey={row.event.pubkey} />
            <time
              class="live-chat-time muted"
              datetime={new Date(row.event.created_at * 1000).toISOString()}
              title={formatAbsoluteTime(row.event.created_at)}
              >{formatChatTime(row.event.created_at)}</time
            >
          </div>
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
