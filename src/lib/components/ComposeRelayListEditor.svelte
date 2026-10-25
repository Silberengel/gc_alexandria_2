<script lang="ts">
  import type { RelayRwMarker } from '@silberengel/kind-compose-catalog';
  import {
    formatRelayRows,
    relayRowsFromRaw,
    type RelayRow
  } from '$lib/compose-relay-list';

  interface Props {
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
    /** NIP-65 read/write markers on each row. */
    withMarkers?: boolean;
    placeholder?: string;
  }

  let {
    value = $bindable(''),
    label = 'Relays',
    required = false,
    help = '',
    withMarkers = false,
    placeholder = 'wss://…'
  }: Props = $props();

  let rows = $state<RelayRow[]>([]);
  let lastEmitted = $state<string | null>(null);

  $effect(() => {
    if (value !== lastEmitted) {
      rows = relayRowsFromRaw(value, withMarkers);
      lastEmitted = value;
    }
  });

  function commit(next: RelayRow[]): void {
    rows = next;
    const raw = formatRelayRows(next, withMarkers);
    lastEmitted = raw;
    value = raw;
  }

  function setUrl(i: number, url: string): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, url } : r)));
  }

  function setMarker(i: number, marker: RelayRwMarker): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, marker } : r)));
  }

  function addRow(): void {
    commit([...rows, { url: '', marker: 'both' }]);
  }

  function removeRow(i: number): void {
    if (rows.length <= 1) {
      commit([{ url: '', marker: 'both' }]);
      return;
    }
    commit(rows.filter((_, idx) => idx !== i));
  }

  function toggleRead(i: number, on: boolean): void {
    const row = rows[i]!;
    const write = row.marker !== 'read';
    const marker: RelayRwMarker =
      on && write ? 'both' : on ? 'read' : write ? 'write' : 'both';
    setMarker(i, marker);
  }

  function toggleWrite(i: number, on: boolean): void {
    const row = rows[i]!;
    const read = row.marker !== 'write';
    const marker: RelayRwMarker =
      read && on ? 'both' : on ? 'write' : read ? 'read' : 'both';
    setMarker(i, marker);
  }
</script>

<div class="tag-rows relay-rows">
  <div class="tag-rows-head">
    <span>{label}{#if required}*{/if}</span>
    <button type="button" class="tag-rows-icon" onclick={addRow} aria-label="Add relay">+</button>
  </div>
  {#if help}
    <p class="tag-rows-hint muted">{help}</p>
  {/if}
  {#each rows as row, i}
    <div class="tag-row relay-row">
      <input
        type="url"
        value={row.url}
        {placeholder}
        aria-label={`Relay ${i + 1}`}
        oninput={(e) => setUrl(i, e.currentTarget.value)}
      />
      {#if withMarkers}
        <label class="relay-scope" title="Read">
          <input
            type="checkbox"
            checked={row.marker !== 'write'}
            onchange={(e) => toggleRead(i, e.currentTarget.checked)}
          />
          <span>R</span>
        </label>
        <label class="relay-scope" title="Write">
          <input
            type="checkbox"
            checked={row.marker !== 'read'}
            onchange={(e) => toggleWrite(i, e.currentTarget.checked)}
          />
          <span>W</span>
        </label>
      {/if}
      <button
        type="button"
        class="tag-rows-icon"
        onclick={() => removeRow(i)}
        aria-label="Remove relay"
        disabled={rows.length <= 1 && !row.url.trim()}
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
  .relay-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .relay-row input[type='url'] {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem 0.55rem;
    font-size: 0.9rem;
  }
  .relay-scope {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    flex: 0 0 auto;
    font-size: 0.8rem;
    opacity: 0.9;
    cursor: pointer;
    user-select: none;
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
