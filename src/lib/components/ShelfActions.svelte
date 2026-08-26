<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { KIND } from '$lib/constants';
  import { session } from '$lib/stores/session';
  import { signAndPublish } from '$lib/sign';
  import { booklistLabelDraft, bookmarkDraft, deletionDraft } from '$lib/drafts';
  import { isBooklistEvent, eventTargetsPublication } from '$lib/nip32';
  import { bookmarkHasPublication } from '$lib/shelves';
  import { latestReplaceable } from '$lib/mute';

  interface Props {
    publication: Event;
  }

  let { publication }: Props = $props();
  let mine = $state<Event[]>([]);

  $effect(() => {
    const unsub = session.metadata.subscribe((events) => {
      mine = events;
    });
    return unsub;
  });

  const myLabels = $derived(mine.filter((e) => isBooklistEvent(e) && eventTargetsPublication(e, publication)));
  const myBookmark = $derived(latestReplaceable(mine, KIND.BOOKMARK));
  const onBooklist = $derived(myLabels.length > 0);
  const onBookmark = $derived(bookmarkHasPublication(myBookmark, publication));
  let busy = $state(false);

  async function needSignIn(): Promise<boolean> {
    if ($session.pubkey) return true;
    return session.signIn();
  }

  async function toggleBooklist(): Promise<void> {
    if (!(await needSignIn()) || busy) return;
    busy = true;
    try {
      if (onBooklist) {
        for (const label of myLabels) {
          await signAndPublish(deletionDraft(label));
        }
        mine = mine.filter((e) => !myLabels.includes(e));
      } else {
        const signed = await signAndPublish(booklistLabelDraft(publication));
        if (signed) mine = [...mine, signed];
      }
    } finally {
      busy = false;
    }
  }

  async function toggleBookmark(): Promise<void> {
    if (!(await needSignIn()) || busy) return;
    busy = true;
    try {
      const signed = await signAndPublish(bookmarkDraft(myBookmark, publication, !onBookmark));
      if (signed) {
        mine = [...mine.filter((e) => e.kind !== KIND.BOOKMARK), signed];
      }
    } finally {
      busy = false;
    }
  }
</script>

{#if $session.pubkey}
  <div class="shelf-actions">
    <button class="btn" type="button" disabled={busy} onclick={() => void toggleBooklist()}>
      {onBooklist ? 'Remove from booklist' : 'Add to booklist'}
    </button>
    <button class="btn" type="button" disabled={busy} onclick={() => void toggleBookmark()}>
      {onBookmark ? 'Remove bookmark' : 'Bookmark'}
    </button>
  </div>
{:else}
  <div class="shelf-actions">
    <button class="btn" type="button" onclick={() => session.signIn()}>Sign in to booklist or bookmark</button>
  </div>
{/if}
