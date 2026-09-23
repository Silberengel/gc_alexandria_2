<script lang="ts">
  import { readingFinishUi, closeReadingFinish } from '$lib/stores/reading-finish-ui';

  interface Props {
    onRate?: () => void;
  }

  let { onRate }: Props = $props();

  function rate(): void {
    closeReadingFinish();
    onRate?.();
  }
</script>

{#if $readingFinishUi.open}
  <div class="reading-finish-backdrop" role="presentation" onclick={closeReadingFinish}>
    <div
      class="reading-finish-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reading-finish-title"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="reading-finish-burst" aria-hidden="true"></div>
      <h2 id="reading-finish-title">Finished</h2>
      <p class="reading-finish-title-text">{$readingFinishUi.title}</p>
      {#if $readingFinishUi.shiftedTitle}
        <p class="muted">{$readingFinishUi.shiftedTitle} is up next</p>
      {/if}
      <p>Want to leave a rating?</p>
      <div class="reading-finish-actions">
        <button class="btn btn-primary" type="button" onclick={rate}>Rate now</button>
        <button class="btn" type="button" onclick={closeReadingFinish}>Not now</button>
      </div>
    </div>
  </div>
{/if}
