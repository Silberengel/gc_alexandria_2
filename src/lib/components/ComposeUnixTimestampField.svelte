<script lang="ts">
  import {
    datetimeLocalToUnix,
    parseUnixSeconds,
    unixToDatetimeLocal
  } from '$lib/compose-unix-timestamp';

  interface Props {
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
  }

  let {
    value = $bindable(''),
    label = 'Timestamp',
    required = false,
    help = 'Unix timestamp (seconds)'
  }: Props = $props();

  let dateInput: HTMLInputElement | undefined = $state();

  const localValue = $derived.by(() => {
    const unix = parseUnixSeconds(value);
    return unix != null ? unixToDatetimeLocal(unix) : '';
  });

  function openPicker(): void {
    const el = dateInput;
    if (!el) return;
    try {
      el.showPicker?.();
    } catch {
      el.click();
    }
  }

  function onPicked(e: Event): void {
    const raw = (e.currentTarget as HTMLInputElement).value;
    const unix = datetimeLocalToUnix(raw);
    if (unix != null) value = String(unix);
  }
</script>

<label class="compose-field unix-field">
  <span>{label}{#if required}*{/if}</span>
  <div class="unix-row">
    <input
      type="text"
      bind:value
      placeholder="unix seconds"
      inputmode="numeric"
      autocomplete="off"
    />
    <button
      type="button"
      class="unix-pick"
      onclick={openPicker}
      title="Pick date and time"
      aria-label="Pick date and time"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M8 3v3m8-3v3M4.5 9.5h15M6 5.5h12a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 18 20.5H6A1.5 1.5 0 0 1 4.5 19V7A1.5 1.5 0 0 1 6 5.5Z"
        />
      </svg>
    </button>
    <input
      bind:this={dateInput}
      class="unix-native"
      type="datetime-local"
      value={localValue}
      tabindex="-1"
      aria-hidden="true"
      onchange={onPicked}
    />
  </div>
  {#if help}
    <small class="muted">{help}</small>
  {/if}
</label>

<style>
  .unix-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    position: relative;
  }
  .unix-row input[type='text'] {
    flex: 1 1 auto;
    min-width: 0;
  }
  .unix-pick {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.1rem;
    height: 2.1rem;
    margin: 0;
    padding: 0;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 0.3rem;
    background: color-mix(in srgb, currentColor 4%, transparent);
    color: inherit;
    cursor: pointer;
  }
  .unix-pick:hover {
    border-color: color-mix(in srgb, var(--accent, currentColor) 40%, transparent);
  }
  .unix-native {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }
</style>
