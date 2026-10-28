<script lang="ts">
  import type { Event } from 'nostr-tools';
  import {
    deprecatedListD,
    isDeprecatedNip51List,
    migrateDeprecatedNip51List,
    standardKindForDeprecatedList
  } from '$lib/nip51-deprecated-lists';
  import { session } from '$lib/stores/session';
  import { showNotice } from '$lib/stores/toast';

  interface Props {
    event: Event;
  }

  let { event }: Props = $props();

  let busy = $state(false);

  const canMigrate = $derived.by(() => {
    const pk = $session.pubkey;
    if (!pk || !isDeprecatedNip51List(event)) return false;
    return event.pubkey.toLowerCase() === pk.toLowerCase();
  });

  const label = $derived.by(() => {
    const d = deprecatedListD(event);
    const kind = standardKindForDeprecatedList(event);
    if (!d || kind == null) return 'Migrate to the standard format';
    return `Migrate to kind ${kind}`;
  });

  async function migrate(): Promise<void> {
    if (busy || !canMigrate) return;
    busy = true;
    try {
      const result = await migrateDeprecatedNip51List(event);
      if (!result.ok) {
        showNotice(result.error);
        return;
      }
      const d = deprecatedListD(event);
      showNotice(
        `Migrated ${d ?? 'list'} to kind ${result.standard.kind}.`,
        true
      );
    } finally {
      busy = false;
    }
  }
</script>

{#if canMigrate}
  <div class="nip51-migrate">
    <p class="nip51-migrate-hint muted">
      Deprecated NIP-51 list (kind {event.kind}
      {#if deprecatedListD(event)}
        · d={deprecatedListD(event)}
      {/if}). Publish the standard replaceable list and delete this copy.
    </p>
    <button class="btn" type="button" disabled={busy} onclick={() => void migrate()}>
      {busy ? 'Migrating…' : 'Migrate to the standard format'}
    </button>
  </div>
{/if}

<style>
  .nip51-migrate {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.45rem;
    margin-top: 0.65rem;
    padding-top: 0.55rem;
    border-top: 1px solid color-mix(in srgb, var(--rule, currentColor) 35%, transparent);
  }
  .nip51-migrate-hint {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.35;
  }
  .nip51-migrate :global(.btn) {
    font-size: 0.82rem;
    padding: 0.3rem 0.65rem;
  }
</style>
