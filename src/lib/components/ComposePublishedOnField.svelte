<script lang="ts">
  import {
    formatPublishedOn,
    fromIsoDateValue,
    parsePublishedOn,
    toIsoDateValue
  } from '$lib/compose-published-on';

  interface Props {
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
  }

  let {
    value = $bindable(''),
    label = 'Published on',
    required = false,
    help = 'Date as dd.mm.yyyy'
  }: Props = $props();

  let dateInput: HTMLInputElement | undefined = $state();

  const isoValue = $derived.by(() => {
    const parsed = parsePublishedOn(value);
    return parsed ? toIsoDateValue(parsed) : '';
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

  function onDatePicked(e: Event): void {
    const iso = (e.currentTarget as HTMLInputElement).value;
    const date = fromIsoDateValue(iso);
    if (date) value = formatPublishedOn(date);
  }
</script>

<label class="compose-field published-on-field">
  <span>{label}{#if required}*{/if}</span>
  <div class="published-on-row">
    <input
      type="text"
      bind:value
      placeholder="dd.mm.yyyy"
      inputmode="numeric"
      autocomplete="off"
    />
    <button
      type="button"
      class="published-on-pick"
      onclick={openPicker}
      title="Pick date"
      aria-label="Pick date"
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
      class="published-on-native"
      type="date"
      value={isoValue}
      tabindex="-1"
      aria-hidden="true"
      onchange={onDatePicked}
    />
  </div>
  {#if help}
    <small class="muted">{help}</small>
  {/if}
</label>

<style>
  .published-on-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    position: relative;
  }
  .published-on-row input[type='text'] {
    flex: 1 1 auto;
    min-width: 0;
  }
  .published-on-pick {
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
  .published-on-pick:hover {
    border-color: color-mix(in srgb, var(--accent, currentColor) 40%, transparent);
  }
  .published-on-native {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }
</style>
