<script lang="ts">
  import {
    formatMuteRows,
    muteRowsFromRaw,
    type MuteRow,
    type MuteTagName
  } from '$lib/compose-mute-list';

  interface Props {
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
  }

  let {
    value = $bindable(''),
    label = 'Muted',
    required = false,
    help = ''
  }: Props = $props();

  const TAG_OPTIONS: { value: MuteTagName; label: string }[] = [
    { value: 'p', label: 'Pubkey' },
    { value: 'e', label: 'Event' },
    { value: 'word', label: 'Word' },
    { value: 't', label: 'Hashtag' }
  ];

  let rows = $state<MuteRow[]>([]);
  let lastEmitted = $state<string | null>(null);

  $effect(() => {
    if (value !== lastEmitted) {
      rows = muteRowsFromRaw(value);
      lastEmitted = value;
    }
  });

  function commit(next: MuteRow[]): void {
    rows = next;
    const raw = formatMuteRows(next);
    lastEmitted = raw;
    value = raw;
  }

  function setTag(i: number, tag: MuteTagName): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, tag } : r)));
  }

  function setValue(i: number, v: string): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, value: v } : r)));
  }

  function setPrivate(i: number, on: boolean): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, private: on } : r)));
  }

  function addRow(): void {
    commit([...rows, { tag: 'p', value: '', private: false }]);
  }

  function removeRow(i: number): void {
    if (rows.length <= 1) {
      commit([{ tag: 'p', value: '', private: false }]);
      return;
    }
    commit(rows.filter((_, idx) => idx !== i));
  }

  function placeholderFor(tag: MuteTagName): string {
    if (tag === 'p') return 'npub / hex';
    if (tag === 'e') return 'note / nevent / hex';
    if (tag === 't') return 'hashtag';
    return 'word or phrase';
  }
</script>

<div class="tag-rows mute-rows">
  <div class="tag-rows-head">
    <span>{label}{#if required}*{/if}</span>
    <button type="button" class="tag-rows-icon" onclick={addRow} aria-label="Add mute">+</button>
  </div>
  {#if help}
    <p class="tag-rows-hint muted">{help}</p>
  {/if}
  {#each rows as row, i}
    <div class="tag-row mute-row">
      <select
        value={row.tag}
        aria-label={`Mute type ${i + 1}`}
        onchange={(e) => setTag(i, e.currentTarget.value as MuteTagName)}
      >
        {#each TAG_OPTIONS as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      <input
        type="text"
        class:mono={row.tag === 'p' || row.tag === 'e'}
        value={row.value}
        placeholder={placeholderFor(row.tag)}
        aria-label={`Mute value ${i + 1}`}
        autocomplete="off"
        spellcheck="false"
        oninput={(e) => setValue(i, e.currentTarget.value)}
      />
      <label class="mute-private" title="Private (encrypted in content)">
        <input
          type="checkbox"
          checked={row.private}
          onchange={(e) => setPrivate(i, e.currentTarget.checked)}
        />
        <span>Priv</span>
      </label>
      <button
        type="button"
        class="tag-rows-icon"
        onclick={() => removeRow(i)}
        aria-label="Remove mute"
        disabled={rows.length <= 1 && !row.value.trim()}
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
    font-size: 0.78rem;
    line-height: 1.35;
  }
  .mute-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .mute-row select {
    flex: 0 0 auto;
    max-width: 7.5rem;
    padding: 0.3rem 0.35rem;
    font-size: 0.85rem;
  }
  .mute-row input[type='text'] {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem 0.55rem;
    font-size: 0.9rem;
  }
  .mute-row input.mono {
    font-family: var(--mono-font, ui-monospace, monospace);
    font-size: 0.82rem;
  }
  .mute-private {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.75rem;
    opacity: 0.85;
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
