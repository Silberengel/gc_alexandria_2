<script lang="ts">
  import { applyPwaUpdate, pwaUpdateAvailable } from '$lib/pwa';
</script>

{#if $pwaUpdateAvailable}
  <div class="pwa-update-banner" role="status" aria-live="polite">
    <p class="pwa-update-copy">
      A new version of Alexandria is available. Reload to update.
    </p>
    <button type="button" class="btn btn-primary pwa-update-ok" onclick={() => applyPwaUpdate()}>
      OK
    </button>
  </div>
{/if}
