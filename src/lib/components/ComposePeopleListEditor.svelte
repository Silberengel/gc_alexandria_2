<script lang="ts">
  import {
    formatPeopleRows,
    peopleRowsFromRaw,
    type PeopleRow
  } from '$lib/compose-people-list';
  import ComposeTextUserBadges from './ComposeTextUserBadges.svelte';
  import MentionControl from './MentionControl.svelte';

  interface Props {
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
  }

  let {
    value = $bindable(''),
    label = 'Follows',
    required = false,
    help = ''
  }: Props = $props();

  let rows = $state<PeopleRow[]>([]);
  let lastEmitted = $state<string | null>(null);

  $effect(() => {
    if (value !== lastEmitted) {
      rows = peopleRowsFromRaw(value);
      lastEmitted = value;
    }
  });

  function commit(next: PeopleRow[]): void {
    rows = next;
    const raw = formatPeopleRows(next);
    lastEmitted = raw;
    value = raw;
  }

  function setField(i: number, key: keyof PeopleRow, v: string): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  }

  function addRow(): void {
    commit([...rows, { pubkey: '', relay: '', petname: '' }]);
  }

  function removeRow(i: number): void {
    if (rows.length <= 1) {
      commit([{ pubkey: '', relay: '', petname: '' }]);
      return;
    }
    commit(rows.filter((_, idx) => idx !== i));
  }
</script>

<div class="tag-rows people-rows">
  <div class="tag-rows-head">
    <span>{label}{#if required}*{/if}</span>
    <button type="button" class="tag-rows-icon" onclick={addRow} aria-label="Add follow">+</button>
  </div>
  {#if help}
    <p class="tag-rows-hint muted">{help}</p>
  {/if}
  {#each rows as row, i}
    <div class="people-block">
      <div class="tag-row people-row">
        <MentionControl
          mode="npub"
          class="mono people-pubkey"
          value={row.pubkey}
          placeholder="npub / hex or @name"
          ariaLabel={`Follow pubkey ${i + 1}`}
          onValue={(next) => setField(i, 'pubkey', next)}
        />
        <input
          type="url"
          class="people-relay"
          value={row.relay}
          placeholder="relay (optional)"
          aria-label={`Follow relay ${i + 1}`}
          oninput={(e) => setField(i, 'relay', e.currentTarget.value)}
        />
        <input
          type="text"
          class="people-petname"
          value={row.petname}
          placeholder="petname"
          aria-label={`Follow petname ${i + 1}`}
          oninput={(e) => setField(i, 'petname', e.currentTarget.value)}
        />
        <button
          type="button"
          class="tag-rows-icon"
          onclick={() => removeRow(i)}
          aria-label="Remove follow"
          disabled={rows.length <= 1 && !row.pubkey.trim()}
          >−</button
        >
      </div>
      <ComposeTextUserBadges value={row.pubkey} />
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
    font-size: 0.78rem;
    line-height: 1.35;
  }
  .people-block {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    min-width: 0;
  }
  .people-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    flex-wrap: wrap;
  }
  .people-row input {
    padding: 0.35rem 0.55rem;
    font-size: 0.9rem;
    min-width: 0;
  }
  .people-row :global(.mention-host) {
    flex: 2 1 12rem;
    min-width: 0;
  }
  .people-row :global(.people-pubkey) {
    flex: 2 1 12rem;
    font-family: var(--mono-font, ui-monospace, monospace);
    font-size: 0.82rem;
  }
  .people-relay {
    flex: 1 1 8rem;
  }
  .people-petname {
    flex: 1 1 6rem;
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
