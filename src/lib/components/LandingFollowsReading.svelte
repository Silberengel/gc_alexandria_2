<script lang="ts">
  import { link } from 'svelte-spa-router';
  import BooklistAvatar from './BooklistAvatar.svelte';
  import { followPubkeysFromMetadata, muteState } from '$lib/mute';
  import { session } from '$lib/stores/session';
  import { loadFollowsReading, type FollowsReadingRow } from '$lib/follows-reading';
  import { readingPrefs } from '$lib/stores/reading-prefs';

  let rows = $state<FollowsReadingRow[]>([]);
  let busy = $state(false);
  let loadKey = $state('');
  let follows = $state<Set<string>>(new Set());

  const signedIn = $derived(Boolean($session.pubkey));

  function peopleLabel(n: number): string {
    return n === 1 ? '1 person you follow' : `${n} people you follow`;
  }

  $effect(() => {
    follows = followPubkeysFromMetadata(session.getMetadata());
    const unsub = session.metadata.subscribe((events) => {
      follows = followPubkeysFromMetadata(events);
    });
    return unsub;
  });

  $effect(() => {
    const pk = $session.pubkey ?? '';
    const followKey = [...follows].sort().join(',');
    const muteKey = [...$muteState.pubkeys].sort().join(',');
    const key = `${pk}|${followKey}|${muteKey}|${$readingPrefs.concurrent}`;
    if (!pk || !follows.size) {
      rows = [];
      loadKey = key;
      return;
    }
    if (key === loadKey) return;
    loadKey = key;
    busy = true;
    const followList = [...follows];
    const muteAuthors = $muteState.pubkeys;
    const concurrent = $readingPrefs.concurrent;
    void loadFollowsReading({
      followPubkeys: followList,
      viewerPubkey: pk,
      mutePubkeys: muteAuthors,
      concurrent
    })
      .then((next) => {
        if (loadKey !== key) return;
        rows = next;
      })
      .catch(() => {
        if (loadKey !== key) return;
        rows = [];
      })
      .finally(() => {
        if (loadKey === key) busy = false;
      });
  });
</script>

{#if signedIn && follows.size > 0 && (rows.length || busy)}
  <aside class="landing-follows-reading" aria-label="Your follows are reading">
    <h2 class="section-title">
      <a href="#/search?queue=follows" use:link>Your follows are reading</a>
    </h2>
    {#if busy && !rows.length}
      <p class="muted landing-follows-reading-hint">Looking through follows…</p>
    {:else if !rows.length}
      <p class="muted landing-follows-reading-hint">No reading activity from follows yet.</p>
    {:else}
      <ul class="landing-follows-reading-list">
        {#each rows as row (row.address)}
          <li class="landing-follows-reading-row">
            <a class="landing-follows-reading-title" href={row.href} use:link title={row.title}
              >{row.title}</a
            >
            {#if row.author}
              <p class="landing-follows-reading-author muted">{row.author}</p>
            {/if}
            <div class="landing-follows-reading-meta">
              <span class="landing-follows-reading-people muted">{peopleLabel(row.readerCount)}</span>
              <div class="landing-follows-reading-avatars booklist-avatar-stack">
                {#each row.readers as pk (pk)}
                  <BooklistAvatar pubkey={pk} />
                {/each}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
{/if}
