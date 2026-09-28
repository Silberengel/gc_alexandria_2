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
    readingQueues?: Event[];
  }

  let {
    publication,
    labels = [],
    bookmarks = [],
    highlights = [],
    directories = [],
    readingQueues = []
  }: Props = $props();

  const rows = $derived(
    editionPeopleRows({
      publication,
      labels,
      bookmarks,
      highlights,
      directories,
      readingQueues,
      mute: $muteState
    })
  );
</script>

{#if rows.length}
  <section class="edition-people" aria-label="People">
    <h2 class="page-kicker">People</h2>
    <dl class="edition-facts edition-people-facts">
      {#each rows as row (row.key)}
        <div class="edition-fact edition-people-fact">
          <dt>{row.title}</dt>
          <dd>
            <ul class="edition-people-list">
              {#each row.pubkeys as pk, i (pk)}
                {#if i > 0}<li class="edition-people-sep" aria-hidden="true">·</li>{/if}
                <li><UserBadge pubkey={pk} compact /></li>
              {/each}
            </ul>
          </dd>
        </div>
      {/each}
    </dl>
  </section>
{/if}
