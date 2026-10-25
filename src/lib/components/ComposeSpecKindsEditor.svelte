<script lang="ts">
  import {
    formatSpecKindRows,
    specKindRowsFromRaw,
    type SpecKindRow
  } from '$lib/compose-spec-kinds';

  interface Props {
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
  }

  let {
    value = $bindable(''),
    label = 'Defined kinds (k)',
    required = false,
    help = ''
  }: Props = $props();

  let rows = $state<SpecKindRow[]>(specKindRowsFromRaw(value));
  let lastEmitted = $state(value);

  $effect(() => {
    if (value !== lastEmitted) {
      rows = specKindRowsFromRaw(value);
      lastEmitted = value;
    }
  });

  function commit(next: SpecKindRow[]): void {
    rows = next;
    const raw = formatSpecKindRows(next);
    lastEmitted = raw;
    value = raw;
  }

  function setKind(i: number, kind: string): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, kind } : r)));
  }

  function setName(i: number, name: string): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, name } : r)));
  }

  function addRow(): void {
    commit([...rows, { kind: '', name: '' }]);
  }

  function removeRow(i: number): void {
    if (rows.length <= 1) {
      commit([{ kind: '', name: '' }]);
      return;
    }
    commit(rows.filter((_, idx) => idx !== i));
  }
</script>

<div class="tag-rows">
  <div class="tag-rows-head">
    <span>{label}{#if required}*{/if}</span>
    <button type="button" class="tag-rows-icon" onclick={addRow} aria-label="Add kind">+</button>
  </div>
  {#if help}
    <p class="tag-rows-hint muted">{help}</p>
  {/if}
  {#each rows as row, i}
    <div class="tag-row">
      <input
        type="text"
        inputmode="numeric"
        value={row.kind}
        placeholder="kind"
        aria-label="Kind number"
        class="kind-num"
        oninput={(e) => setKind(i, e.currentTarget.value)}
      />
      <input
        type="text"
        value={row.name}
        placeholder="name (optional)"
        aria-label="Kind name"
        oninput={(e) => setName(i, e.currentTarget.value)}
      />
      <button
        type="button"
        class="tag-rows-icon"
        onclick={() => removeRow(i)}
        aria-label="Remove kind"
        disabled={rows.length <= 1 && !row.kind.trim() && !row.name.trim()}
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
  .tag-rows-hint {
    margin: 0;
    font-size: 0.8rem;
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
  .tag-row input.kind-num {
    flex: 0 1 6.5rem;
    max-width: 8rem;
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
