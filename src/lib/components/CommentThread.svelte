<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import EventBody from './EventBody.svelte';
  import CommentThread from './CommentThread.svelte';
  import { session } from '$lib/stores/session';
  import { signAndPublish } from '$lib/sign';
  import { commentDraft } from '$lib/drafts';
  import type { ThreadNode } from '$lib/comments';

  interface Props {
    node: ThreadNode;
    target: Event;
  }

  let { node, target }: Props = $props();
  let reply = $state('');
  let open = $state(false);
  let posting = $state(false);

  async function sendReply(): Promise<void> {
    if (!node.event) return;
    if (!$session.pubkey) {
      await session.signIn();
      return;
    }
    if (!reply.trim()) return;
    posting = true;
    const signed = await signAndPublish(commentDraft(target, reply.trim(), node.event));
    posting = false;
    if (signed) {
      node.children = [...node.children, { event: signed, placeholder: null, children: [] }];
      reply = '';
      open = false;
    }
  }
</script>

<li class="thread-node">
  {#if node.placeholder}
    <p class="muted">{node.placeholder}</p>
  {:else if node.event}
    <div class="thread-head">
      <UserBadge pubkey={node.event.pubkey} />
    </div>
    <EventBody event={node.event} />
    {#if $session.pubkey}
      <button class="btn" type="button" onclick={() => (open = !open)}>Reply</button>
    {:else}
      <button class="btn" type="button" onclick={() => session.signIn()}>Sign in to reply</button>
    {/if}
    {#if open}
      <form class="compose" onsubmit={(e) => { e.preventDefault(); void sendReply(); }}>
        <textarea bind:value={reply} rows="3" placeholder="Write a reply"></textarea>
        <button class="btn btn-primary" type="submit" disabled={posting || !reply.trim()}>Post</button>
      </form>
    {/if}
  {/if}
  {#if node.children.length}
    <ul class="thread-children">
      {#each node.children as child (child.event?.id ?? child.placeholder)}
        <CommentThread node={child} {target} />
      {/each}
    </ul>
  {/if}
</li>
