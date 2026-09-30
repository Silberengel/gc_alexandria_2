<script lang="ts">
  import { toast } from '$lib/stores/toast';
</script>

<div class="publish-toast-host" aria-live="polite">
  {#if $toast}
    <p class="publish-toast" class:publish-toast-ok={$toast.ok} class:publish-toast-fail={!$toast.ok} role="status">
      {#if $toast.ok}
        <svg class="publish-toast-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.1 14.2-3.6-3.6 1.4-1.4 2.2 2.2 4.7-4.7 1.4 1.4-6.1 6.1Z"
          />
        </svg>
      {:else}
        <svg class="publish-toast-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.75" />
          <path
            d="M9 9l6 6M15 9l-6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
          />
        </svg>
      {/if}
      {$toast.message}
    </p>
  {/if}
</div>
