<script lang="ts">
  import type { Event } from 'nostr-tools';
  import UserBadge from './UserBadge.svelte';
  import { muteState } from '$lib/mute';
  import { editionPeopleRows } from '$lib/read-marks';

  interface Props {
    publication: Event;
    labels?: Event[];
    bookmarks?: Event[];
    highlights?: Event[];
    directories?: Event[];
  }

  let {
    publication,
    labels = [],
    bookmarks = [],
    highlights = [],
    directories = []
  }: Props = $props();

  const rows = $derived(
    editionPeopleRows({
      publication,
      labels,
      bookmarks,
      highlights,
      directories,
      mute: $muteState
    })
  );
</script>

{#if rows.length}
  <section class="card reading-width edition-people" style="margin-bottom:1rem">
    <h2>People</h2>
    {#each rows as row (row.key)}
      <div class="edition-people-row">
        <h3 class="edition-people-title">{row.title}</h3>
        <ul class="edition-people-list">
          {#each row.pubkeys as pk (pk)}
            <li><UserBadge pubkey={pk} /></li>
          {/each}
        </ul>
      </div>
    {/each}
  </section>
{/if}
