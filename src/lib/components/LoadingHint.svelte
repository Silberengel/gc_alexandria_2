<script lang="ts">
  interface Props {
    message: string;
    /** Tighter spacing for dialogs, forms, and panels. */
    compact?: boolean;
  }

  let { message, compact = false }: Props = $props();
</script>

<p
  class="loading-hint loading-hint-busy"
  class:loading-hint-compact={compact}
  aria-live="polite"
>
  <span class="jump-busy-spinner" aria-hidden="true"></span>
  {message}
</p>
