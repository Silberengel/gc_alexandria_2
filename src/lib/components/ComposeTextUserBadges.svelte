<script lang="ts">
  import { hexPubkeysFromComposerText } from '$lib/compose-field-pubkeys';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    /** Raw field / row value that may contain hex, npub, or nprofile. */
    value?: string;
  }

  let { value = '' }: Props = $props();

  const pubkeys = $derived(hexPubkeysFromComposerText(value));
</script>

{#if pubkeys.length}
  <div class="compose-text-userbadges">
    {#each pubkeys as pk (pk)}
      <UserBadge pubkey={pk} compact />
    {/each}
  </div>
{/if}

<style>
  .compose-text-userbadges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.55rem;
    align-items: center;
    margin-top: 0.1rem;
    min-width: 0;
    opacity: 0.72;
  }
  .compose-text-userbadges :global(.userbadge) {
    font-size: 0.82rem;
    gap: 0.25rem;
    max-width: 100%;
  }
  .compose-text-userbadges :global(.userbadge span) {
    color: color-mix(in srgb, currentColor 78%, transparent);
    font-weight: 500;
  }
</style>
