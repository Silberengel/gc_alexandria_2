<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { NIP32_READ_LABEL } from '$lib/constants';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { signAndPublish } from '$lib/sign';
  import { deletionDraft, publicationLabelDraft } from '$lib/drafts';
  import { muteState } from '$lib/mute';
  import {
    distinctReadPubkeys,
    myReadLabel,
    readLabelsForPublication
  } from '$lib/read-marks';

  interface Props {
    publication: Event;
    /** Preloaded kind-1985 read labels for this edition. */
    readEvents?: Event[];
  }

  let { publication, readEvents: readProp = [] }: Props = $props();

  let local = $state<Event[]>([]);
  let busy = $state(false);

  $effect(() => {
    local = readProp;
  });

  const forEdition = $derived(readLabelsForPublication(local, publication));
  const count = $derived(distinctReadPubkeys(forEdition, $muteState).length);
  const mine = $derived(myReadLabel(forEdition, publication, $session.pubkey));
  const marked = $derived(!!mine);
  const signedIn = $derived(!!$session.pubkey);

  async function toggle(): Promise<void> {
    if (busy) return;
    if (!signedIn) {
      openLoginDialog();
      return;
    }
    busy = true;
    try {
      if (mine) {
        const signed = await signAndPublish(deletionDraft(mine));
        if (signed) local = local.filter((e) => e.id !== mine.id);
      } else {
        const signed = await signAndPublish(
          publicationLabelDraft(publication, NIP32_READ_LABEL)
        );
        if (signed) {
          local = [
            signed,
            ...local.filter(
              (e) =>
                !(
                  e.pubkey.toLowerCase() === signed.pubkey.toLowerCase() &&
                  e.tags.some((t) => t[0] === 'l' && t[1]?.toLowerCase() === NIP32_READ_LABEL)
                )
            )
          ];
        }
      }
    } finally {
      busy = false;
    }
  }

  const label = $derived.by(() => {
    if (!signedIn) return `Marked read (${count}). Sign in to mark as read`;
    return marked ? `Mark unread (${count})` : `Mark as read (${count})`;
  });
  const tip = $derived.by(() => {
    if (!signedIn) return 'Sign in to mark as read';
    return marked ? 'Mark unread' : 'Mark as read';
  });
</script>

<button
  class="btn btn-icon read-btn"
  class:read-on={marked}
  type="button"
  disabled={busy}
  aria-pressed={marked}
  aria-label={label}
  title={tip}
  onclick={() => void toggle()}
>
  <img class="read-icon" src="/read-mark.png" width="20" height="20" alt="" aria-hidden="true" />
  {#if count > 0}
    <span class="read-count">{count}</span>
  {/if}
</button>
