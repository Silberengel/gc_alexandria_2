<script lang="ts">
  import { closeRawEvent, rawEventViewer } from '$lib/stores/raw-event-viewer';

  const json = $derived($rawEventViewer ? JSON.stringify($rawEventViewer, null, 2) : '');
  let copied = $state(false);
  let area = $state<HTMLTextAreaElement | undefined>();
  let copyTimer = 0;

  $effect(() => {
    if (!$rawEventViewer) return;
    copied = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRawEvent();
    };
    document.addEventListener('keydown', onKey);
    queueMicrotask(() => area?.focus());
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(copyTimer);
    };
  });

  async function copyJson(): Promise<void> {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        copied = false;
      }, 1200);
    } catch {
      area?.focus();
      area?.select();
    }
  }

  function onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) closeRawEvent();
  }
</script>

{#if $rawEventViewer}
  <div class="raw-event-backdrop" role="presentation" onclick={onBackdrop}>
    <div class="raw-event-viewer" role="dialog" aria-modal="true" aria-label="Raw event">
      <header class="raw-event-toolbar">
        <p class="raw-event-title">Raw event</p>
        <div class="raw-event-actions">
          <button class="btn" type="button" onclick={() => void copyJson()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button class="btn" type="button" onclick={() => closeRawEvent()}>Close</button>
        </div>
      </header>
      <textarea class="raw-event-json" readonly spellcheck="false" bind:this={area} value={json}
      ></textarea>
    </div>
  </div>
{/if}
