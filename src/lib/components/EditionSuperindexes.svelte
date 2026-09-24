<script lang="ts">
  import type { Event } from 'nostr-tools';
  import { link } from 'svelte-spa-router';
  import { displayTitle, publicationPath } from '$lib/metadata';

  interface Props {
    parents: Event[];
  }

  let { parents }: Props = $props();
</script>

{#if parents.length}
  <nav class="edition-superindexes" aria-label="Containing indexes">
    <p class="edition-superindexes-label muted">In</p>
    <ul class="edition-superindexes-list">
      {#each parents as parent (parent.id)}
        <li>
          <a class="edition-inline-link" href={`#${publicationPath(parent)}`} use:link
            >{displayTitle(parent)}</a
          >
        </li>
      {/each}
    </ul>
  </nav>
{/if}
