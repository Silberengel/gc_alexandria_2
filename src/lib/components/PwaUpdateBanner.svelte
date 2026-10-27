<script lang="ts">
  import { applyPwaUpdate, pwaUpdateAvailable } from '$lib/pwa';
  import { APP_VERSION } from '$lib/constants';

  let applying = $state(false);

  async function onOk() {
    if (applying) return;
    applying = true;
    try {
      await applyPwaUpdate();
    } catch (error) {
      console.warn('[pwa] apply update failed', error);
      applying = false;
    }
  }
</script>

{#if $pwaUpdateAvailable}
  <div class="pwa-update-banner" role="status" aria-live="polite">
    <p class="pwa-update-copy">
      A new version of Alexandria is available
      {#if APP_VERSION}
        (you are on {APP_VERSION})
      {/if}. Reload to update.
    </p>
    <button
      type="button"
      class="btn btn-primary pwa-update-ok"
      disabled={applying}
      onclick={() => void onOk()}
    >
      {applying ? 'Updating…' : 'OK'}
    </button>
  </div>
{/if}
