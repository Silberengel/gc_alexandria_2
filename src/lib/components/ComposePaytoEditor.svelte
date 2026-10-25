<script lang="ts">
  import {
    PAYTO_OTHER,
    PAYTO_TYPE_OPTIONS,
    formatPaytoRows,
    paytoRowsFromRaw,
    paytoSelectValue,
    type PaytoRow
  } from '$lib/compose-payto';

  interface Props {
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
  }

  let {
    value = $bindable(''),
    label = 'Payment targets',
    required = false,
    help = ''
  }: Props = $props();

  let rows = $state<PaytoRow[]>(paytoRowsFromRaw(value));
  let lastEmitted = $state(value);

  $effect(() => {
    if (value !== lastEmitted) {
      rows = paytoRowsFromRaw(value);
      lastEmitted = value;
    }
  });

  function commit(next: PaytoRow[]): void {
    rows = next;
    const raw = formatPaytoRows(next);
    lastEmitted = raw;
    value = raw;
  }

  function setType(i: number, select: string): void {
    const current = rows[i] ?? { type: 'lightning', authority: '' };
    if (select === PAYTO_OTHER) {
      const custom = paytoSelectValue(current.type) === PAYTO_OTHER ? current.type : '';
      commit(rows.map((r, idx) => (idx === i ? { ...r, type: custom } : r)));
      return;
    }
    commit(rows.map((r, idx) => (idx === i ? { ...r, type: select } : r)));
  }

  function setCustomType(i: number, type: string): void {
    const cleaned = type.toLowerCase().replace(/[^a-z0-9-]/g, '');
    commit(rows.map((r, idx) => (idx === i ? { ...r, type: cleaned } : r)));
  }

  function setAuthority(i: number, authority: string): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, authority } : r)));
  }

  function addRow(): void {
    commit([...rows, { type: 'lightning', authority: '' }]);
  }

  function removeRow(i: number): void {
    if (rows.length <= 1) {
      commit([{ type: 'lightning', authority: '' }]);
      return;
    }
    commit(rows.filter((_, idx) => idx !== i));
  }
</script>

<div class="tag-rows payto-rows">
  <div class="tag-rows-head">
    <span>{label}{#if required}*{/if}</span>
    <button type="button" class="tag-rows-icon" onclick={addRow} aria-label="Add payment target"
      >+</button
    >
  </div>
  {#if help}
    <p class="tag-rows-hint muted">{help}</p>
  {/if}
  {#each rows as row, i}
    {@const select = paytoSelectValue(row.type)}
    <div class="payto-block">
      <div class="tag-row payto-row">
        <select
          value={select}
          aria-label="Payment type"
          onchange={(e) => setType(i, e.currentTarget.value)}
        >
          {#each PAYTO_TYPE_OPTIONS as opt}
            <option value={opt}>{opt}</option>
          {/each}
        </select>
        <input
          type="text"
          value={row.authority}
          placeholder="address / account"
          aria-label="Payment authority"
          oninput={(e) => setAuthority(i, e.currentTarget.value)}
        />
        <button
          type="button"
          class="tag-rows-icon"
          onclick={() => removeRow(i)}
          aria-label="Remove payment target"
          disabled={rows.length <= 1 && !row.authority.trim()}
          >−</button
        >
      </div>
      {#if select === PAYTO_OTHER}
        <input
          type="text"
          class="payto-custom"
          value={row.type}
          placeholder="custom type"
          aria-label="Custom payment type"
          oninput={(e) => setCustomType(i, e.currentTarget.value)}
        />
      {/if}
    </div>
  {/each}
</div>

<style>
  .tag-rows {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
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
  .payto-block {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .payto-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .payto-row select {
    flex: 0 1 9rem;
    max-width: 11rem;
    min-width: 6.5rem;
    padding: 0.35rem 0.4rem;
    font-size: 0.9rem;
  }
  .payto-row input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem 0.55rem;
    font-size: 0.9rem;
  }
  .payto-custom {
    margin-left: 0;
    padding: 0.3rem 0.55rem;
    font-size: 0.85rem;
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
