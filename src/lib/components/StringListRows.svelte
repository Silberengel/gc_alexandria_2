<script lang="ts">
  interface Props {
    values?: string[];
    label: string;
    hint?: string;
    placeholder?: string;
    addLabel?: string;
    removeLabel?: string;
    inputType?: string;
    mono?: boolean;
    /** Fired after any add/edit/remove (for dirty tracking). */
    onChange?: () => void;
  }

  let {
    values = $bindable([] as string[]),
    label,
    hint = '',
    placeholder = '',
    addLabel = 'Add row',
    removeLabel = 'Remove row',
    inputType = 'text',
    mono = false,
    onChange
  }: Props = $props();

  function ensureRows(): void {
    if (!values.length) values = [''];
  }

  $effect(() => {
    ensureRows();
  });

  function setAt(i: number, value: string): void {
    const next = [...values];
    next[i] = value;
    values = next;
    onChange?.();
  }

  function addRow(): void {
    values = [...values, ''];
    onChange?.();
  }

  function removeRow(i: number): void {
    const next = values.filter((_, idx) => idx !== i);
    values = next.length ? next : [''];
    onChange?.();
  }

  function clearAll(): void {
    values = [''];
    onChange?.();
  }

  const canClear = $derived(values.some((v) => v.trim()) || values.length > 1);
</script>

<div class="tag-rows">
  <div class="tag-rows-head">
    <span>{label}</span>
    <div class="tag-rows-actions">
      {#if canClear}
        <button
          type="button"
          class="tag-rows-clear"
          onclick={clearAll}
          aria-label={`Clear ${label}`}
          title="Clear"
        >×</button>
      {/if}
      <button type="button" class="tag-rows-icon" onclick={addRow} aria-label={addLabel}>+</button>
    </div>
  </div>
  {#if hint}
    <p class="tag-rows-hint muted">{hint}</p>
  {/if}
  {#each values as value, i}
    <div class="tag-row">
      <input
        type={inputType}
        class:mono
        {value}
        {placeholder}
        autocomplete="off"
        spellcheck="false"
        oninput={(e) => setAt(i, e.currentTarget.value)}
      />
      <button
        type="button"
        class="tag-rows-icon"
        onclick={() => removeRow(i)}
        aria-label={removeLabel}
        disabled={values.length <= 1 && !value.trim()}
        >−</button
      >
    </div>
  {/each}
</div>

<style>
  .tag-rows {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .tag-rows-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.95rem;
  }
  .tag-rows-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .tag-rows-clear {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.65rem;
    height: 1.65rem;
    margin: 0;
    padding: 0;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 0.3rem;
    background: color-mix(in srgb, currentColor 4%, transparent);
    color: inherit;
    font: inherit;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }
  .tag-rows-clear:hover {
    border-color: color-mix(in srgb, var(--accent, currentColor) 40%, transparent);
  }
  .tag-rows-hint {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.35;
  }
  .tag-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .tag-row input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem 0.55rem;
    font-size: 0.9rem;
  }
  .tag-row input.mono {
    font-family: var(--mono-font, ui-monospace, monospace);
    font-size: 0.82rem;
  }
  .tag-rows-icon {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.65rem;
    height: 1.65rem;
    margin: 0;
    padding: 0;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 0.3rem;
    background: color-mix(in srgb, currentColor 4%, transparent);
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
  }
  .tag-rows-icon:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent, currentColor) 40%, transparent);
  }
  .tag-rows-icon:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .muted {
    opacity: 0.75;
  }
</style>
