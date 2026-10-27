<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import LoadingHint from './LoadingHint.svelte';
  import {
    collectLiveChatRows,
    filterLiveChatForShield,
    liveChatDraft,
    liveChatShieldText
  } from '$lib/live-chat';
  import { followPubkeysFromMetadata, muteState } from '$lib/mute';
  import type { WorkResponses } from '$lib/comments';
  import { formatAbsoluteTime, formatChatTime } from '$lib/relative-time';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { scrubClipboardTextPaste, scrubTrackingUrlsInText } from '$lib/clean-url';
  import { publishComment } from '$lib/sign';
  import { liveChatShield } from '$lib/stores/live-chat-shield';
  import { trust } from '$lib/stores/trust';
  import { trustedAssertions } from '$lib/trusted-assertions';
  import { getFollowsOfFollowsSet } from '$lib/follows-of-follows';
  import type { GrapevineTrustContext } from '$lib/grapevine-rank';

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

  const shieldOn = $derived($liveChatShield);

  const grapevine = $derived.by((): GrapevineTrustContext | null => {
    if (!shieldOn) return null;
    const snap = trust.snapshot();
    if (!snap.enabled) return null;
    const viewerPubkey = $session.pubkey;
    return {
      trustFilterEnabled: true,
      rankCutoff: snap.rankMin,
      viewerPubkey,
      followPubkeySet: followPubkeysFromMetadata(session.getMetadata()),
      followsOfFollowsSet: getFollowsOfFollowsSet(viewerPubkey),
      getScore: (pk) => trustedAssertions.getScore(pk)
    };
  });

  const rows = $derived.by(() => {
    const thread = [...responses.thread, ...local];
    const other = responses.other ?? [];
    const quotes = responses.quotes ?? [];
    const pool = shieldOn
      ? {
          thread: filterLiveChatForShield(thread, $muteState, grapevine),
          other: filterLiveChatForShield(other, $muteState, grapevine),
          quotes: filterLiveChatForShield(quotes, $muteState, grapevine)
        }
      : {
          // Wide open: do not apply mute / trust / follows.
          thread,
          other,
          quotes
        };
    return collectLiveChatRows(target, { ...responses, ...pool }).filter(
      (row) => row.type === 'message'
    );
  });

  function showPublished(event: Event): void {
    local = [...local.filter((e) => e.id !== event.id), event];
  }

  function onPaste(event: ClipboardEvent): void {
    scrubClipboardTextPaste(event, (scrubbed, start, end) => {
      text = text.slice(0, start) + scrubbed + text.slice(end);
    });
  }

  async function post(): Promise<void> {
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    const body = scrubTrackingUrlsInText(text).trim();
    if (!body || posting) return;
    text = body;
    posting = true;
    try {
      const published = await publishComment(liveChatDraft(target, body));
      if (!published) return;
      showPublished(published);
      text = '';
    } finally {
      posting = false;
    }
  }
</script>

<section class="live-chat-feed">
  <div class="live-chat-head">
    <h2 class="section-title">Live chat</h2>
    <button
      type="button"
      class="btn btn-icon live-chat-shield"
      class:live-chat-shield-on={shieldOn}
      aria-pressed={shieldOn}
      aria-label={shieldOn ? 'Shield on — filtering chat' : 'Shield off — show everyone'}
      title="Block noisy relays again; hide muted / low-trust authors and media"
      onclick={() => liveChatShield.set(!shieldOn)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3 5 6.5v5.2c0 4.4 2.9 7.8 7 9.3 4.1-1.5 7-4.9 7-9.3V6.5L12 3Z" />
        {#if shieldOn}
          <path d="M9.2 12.1 11 14l3.8-4.2" />
        {/if}
      </svg>
    </button>
  </div>

  {#if allowCompose && $session.pubkey}
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
        onpaste={onPaste}
      />
    </form>
  {/if}

  {#if rows.length}
    <ul class="live-chat-list">
      {#each rows as row (row.event.id)}
        {@const shieldBody = shieldOn ? liveChatShieldText(row.event) : null}
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
            {#if shieldBody?.mediaOnly}
              <span class="live-chat-media-hidden muted">media hidden</span>
            {:else if shieldBody && shieldBody.text !== (row.event.content ?? '')}
              <EventBody
                event={{ ...row.event, content: shieldBody.text }}
                showEmbeds={false}
                hideMedia
              />
            {:else}
              <EventBody event={row.event} showEmbeds={false} hideMedia={shieldOn} />
            {/if}
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
