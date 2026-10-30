<script lang="ts">
  import {
    ensureMinPollOptionRows,
    pollOptionMedia
  } from '$lib/poll';

  interface Props {
    options?: string[];
    multipleChoice?: boolean;
    endsHours?: string;
    disabled?: boolean;
  }

  let {
    options = $bindable(['', '']),
    multipleChoice = $bindable(false),
    endsHours = $bindable(''),
    disabled = false
  }: Props = $props();

  const rows = $derived(ensureMinPollOptionRows(options));

  function setOption(index: number, value: string): void {
    const next = [...rows];
    next[index] = value;
    options = next;
  }

  function removeOption(index: number): void {
    if (rows.length <= 2) return;
    options = rows.filter((_, i) => i !== index);
  }

  function addOption(): void {
    options = [...rows, ''];
  }
</script>

<div class="compose-poll-options">
  <div class="compose-poll-options-copy">
    <p class="compose-poll-options-title">Poll options</p>
    <p class="muted compose-poll-options-hint">
      At least two choices. Paste an image, video, audio, or PDF URL to use media as an option.
    </p>
  </div>

  {#each rows as value, index (index)}
    {@const preview = pollOptionMedia(value)}
    <div class="compose-poll-option-row">
      <label class="compose-field compose-poll-option-field">
        <span class="visually-hidden">Option {index + 1}</span>
        <input
          type="text"
          value={value}
          {disabled}
          placeholder={`Option ${index + 1}`}
          autocomplete="off"
          oninput={(e) => setOption(index, (e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      {#if preview?.kind === 'image'}
        <img class="compose-poll-option-thumb" src={preview.url} alt="" />
      {/if}
      <button
        type="button"
        class="btn compose-poll-option-remove"
        disabled={disabled || rows.length <= 2}
        title="Remove option"
        aria-label={`Remove option ${index + 1}`}
        onclick={() => removeOption(index)}
      >
        −
      </button>
    </div>
  {/each}

  <button type="button" class="btn" {disabled} onclick={addOption}>Add option</button>

  <label class="compose-option compose-poll-multiple">
    <input type="checkbox" bind:checked={multipleChoice} {disabled} />
    <span>Allow multiple choices</span>
  </label>

  <label class="compose-field">
    <span>Ends in (hours)</span>
    <input
      type="text"
      bind:value={endsHours}
      {disabled}
      placeholder="Optional"
      inputmode="numeric"
      autocomplete="off"
    />
    <small class="muted">Leave blank for no end time.</small>
  </label>
</div>

<style>
  .compose-poll-options {
    display: grid;
    gap: 0.55rem;
    margin: 0.15rem 0 0.35rem;
    padding: 0.65rem 0.75rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--rule) 68%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--paper) 55%, var(--paper-light));
  }
  .compose-poll-options-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.3;
  }
  .compose-poll-options-hint {
    margin: 0.2rem 0 0;
    font-size: 0.82rem;
    line-height: 1.35;
  }
  .compose-poll-option-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .compose-poll-option-field {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
  }
  .compose-poll-option-thumb {
    width: 1.75rem;
    height: 1.75rem;
    object-fit: cover;
    border-radius: 0.25rem;
    flex: 0 0 auto;
  }
  .compose-poll-option-remove {
    flex: 0 0 auto;
    min-width: 2rem;
    padding: 0.25rem 0.45rem;
  }
  .compose-poll-multiple {
    margin: 0.15rem 0 0;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
