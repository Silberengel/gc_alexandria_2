<script lang="ts">
  import {
    CONTENT_WARNING_DEFAULT_LABEL,
    CONTENT_WARNING_PRESETS
  } from '$lib/content-warning';

  interface Props {
    enabled?: boolean;
    label?: string;
    disabled?: boolean;
  }

  let {
    enabled = $bindable(false),
    label = $bindable(CONTENT_WARNING_DEFAULT_LABEL),
    disabled = false
  }: Props = $props();

  const selectedPreset = $derived.by(() => {
    if (!enabled) return CONTENT_WARNING_DEFAULT_LABEL;
    if ((CONTENT_WARNING_PRESETS as readonly string[]).includes(label)) return label;
    return '__custom__';
  });

  function onToggle(e: Event): void {
    const checked = (e.currentTarget as HTMLInputElement).checked;
    enabled = checked;
    if (checked && !label.trim()) label = CONTENT_WARNING_DEFAULT_LABEL;
  }

  function onPresetChange(e: Event): void {
    const next = (e.currentTarget as HTMLSelectElement).value;
    if (next === '__custom__') {
      if ((CONTENT_WARNING_PRESETS as readonly string[]).includes(label)) label = '';
      return;
    }
    label = next;
  }
</script>

<div class="compose-content-warning">
  <div class="compose-content-warning-row">
    <div class="compose-content-warning-copy">
      <p class="compose-content-warning-title">Content warning</p>
      <p class="muted compose-content-warning-hint">
        Adds a NIP-36 content-warning tag so readers must opt in.
      </p>
    </div>
    <label class="compose-content-warning-switch">
      <span class="visually-hidden">Content warning</span>
      <input
        type="checkbox"
        role="switch"
        checked={enabled}
        {disabled}
        onchange={onToggle}
      />
    </label>
  </div>
  {#if enabled}
    <label class="compose-field">
      <span>Warning type</span>
      <select value={selectedPreset} {disabled} onchange={onPresetChange}>
        {#each CONTENT_WARNING_PRESETS as preset}
          <option value={preset}>{preset}</option>
        {/each}
        <option value="__custom__">Custom label</option>
      </select>
    </label>
    {#if selectedPreset === '__custom__'}
      <label class="compose-field">
        <span>Label</span>
        <input
          type="text"
          bind:value={label}
          {disabled}
          maxlength="80"
          placeholder={CONTENT_WARNING_DEFAULT_LABEL}
          autocomplete="off"
        />
      </label>
    {/if}
  {/if}
</div>

<style>
  .compose-content-warning {
    display: grid;
    gap: 0.55rem;
    margin: 0.15rem 0 0.35rem;
    padding: 0.65rem 0.75rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--rule) 68%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--paper) 55%, var(--paper-light));
  }
  .compose-content-warning-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem 1rem;
  }
  .compose-content-warning-copy {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .compose-content-warning-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.3;
  }
  .compose-content-warning-hint {
    margin: 0.2rem 0 0;
    font-size: 0.82rem;
    line-height: 1.35;
  }
  .compose-content-warning-switch {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
  }
  .compose-content-warning-switch input {
    width: 2.6rem;
    height: 1.45rem;
    margin: 0;
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--rule) 80%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--paper-dark) 35%, var(--paper-light));
    position: relative;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .compose-content-warning-switch input::after {
    content: '';
    position: absolute;
    top: 0.12rem;
    left: 0.12rem;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    background: var(--paper-light);
    box-shadow: 0 1px 2px color-mix(in srgb, #000 18%, transparent);
    transition: transform 0.15s ease;
  }
  .compose-content-warning-switch input:checked {
    background: color-mix(in srgb, var(--accent) 55%, var(--paper-light));
    border-color: color-mix(in srgb, var(--accent) 45%, var(--rule));
  }
  .compose-content-warning-switch input:checked::after {
    transform: translateX(1.15rem);
  }
  .compose-content-warning-switch input:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .compose-content-warning :global(.compose-field) {
    margin: 0;
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
