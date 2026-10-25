<script lang="ts">
  import { decodePointer, sectionDTagFromRow } from '@silberengel/kind-compose-catalog';
  import {
    formatSectionRows,
    isValidSectionRow,
    moveSectionRow,
    sectionRowsFromRaw
  } from '$lib/compose-publication-sections';
  import { fetchById } from '$lib/nostr/fetch';
  import { firstTag } from '$lib/nostr/verify';

  interface Props {
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
  }

  let {
    value = $bindable(''),
    label = 'Sections',
    required = false,
    help = ''
  }: Props = $props();

  let rows = $state<string[]>(sectionRowsFromRaw(value));
  let lastEmitted = $state(value);
  /** Resolved d-tags for hex/note/nevent rows (address rows use immediate parse). */
  let resolvedDTags = $state<Record<number, string>>({});
  let resolveGen = 0;

  $effect(() => {
    if (value !== lastEmitted) {
      rows = sectionRowsFromRaw(value);
      lastEmitted = value;
    }
  });

  $effect(() => {
    const snapshot = [...rows];
    const gen = ++resolveGen;
    let cancelled = false;
    resolvedDTags = {};
    void (async () => {
      const found: Record<number, string> = {};
      await Promise.all(
        snapshot.map(async (row, i) => {
          if (sectionDTagFromRow(row)) return;
          const pointer = row.trim();
          if (!pointer) return;
          // Only attempt fetch for event-id shaped rows (hex / note / nevent).
          const decoded = decodePointer(pointer);
          if (decoded?.type !== 'event') return;
          const ev = await fetchById(decoded.id);
          if (cancelled || gen !== resolveGen || !ev) return;
          const d = firstTag(ev, 'd')?.trim();
          if (d) found[i] = d;
        })
      );
      if (cancelled || gen !== resolveGen) return;
      resolvedDTags = found;
    })();
    return () => {
      cancelled = true;
    };
  });

  function commit(next: string[]): void {
    rows = next;
    const raw = formatSectionRows(next);
    lastEmitted = raw;
    value = raw;
  }

  function setAt(i: number, next: string): void {
    commit(rows.map((r, idx) => (idx === i ? next : r)));
  }

  function addRow(): void {
    commit([...rows, '']);
  }

  function removeRow(i: number): void {
    if (rows.length <= 1) {
      commit(['']);
      return;
    }
    commit(rows.filter((_, idx) => idx !== i));
  }

  function moveUp(i: number): void {
    if (i <= 0) return;
    commit(moveSectionRow(rows, i, i - 1));
  }

  function moveDown(i: number): void {
    if (i >= rows.length - 1) return;
    commit(moveSectionRow(rows, i, i + 1));
  }

  function dTagFor(i: number, row: string): string | null {
    return sectionDTagFromRow(row) ?? resolvedDTags[i] ?? null;
  }
</script>

<div class="tag-rows section-rows">
  <div class="tag-rows-head">
    <span>{label}{#if required}*{/if}</span>
    <button type="button" class="tag-rows-icon" onclick={addRow} aria-label="Add section">+</button>
  </div>
  {#if help}
    <p class="tag-rows-hint muted">{help}</p>
  {/if}
  {#each rows as row, i}
    <div class="section-block">
      <div class="tag-row section-row">
        <div class="section-move">
          <button
            type="button"
            class="tag-rows-icon"
            onclick={() => moveUp(i)}
            aria-label="Move section up"
            disabled={i === 0}
            title="Move up">↑</button
          >
          <button
            type="button"
            class="tag-rows-icon"
            onclick={() => moveDown(i)}
            aria-label="Move section down"
            disabled={i >= rows.length - 1}
            title="Move down">↓</button
          >
        </div>
        <input
          type="text"
          value={row}
          placeholder="naddr1… or kind:pubkey:d"
          aria-label={`Section ${i + 1}`}
          class:invalid={row.trim() && !isValidSectionRow(row)}
          oninput={(e) => setAt(i, e.currentTarget.value)}
        />
        <button
          type="button"
          class="tag-rows-icon"
          onclick={() => removeRow(i)}
          aria-label="Remove section"
          disabled={rows.length <= 1 && !row.trim()}
          >−</button
        >
      </div>
      {#if dTagFor(i, row)}
        <p class="section-d muted" title="d-tag">d: {dTagFor(i, row)}</p>
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
  .section-block {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .section-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .section-move {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 0 0 auto;
  }
  .section-row input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem 0.55rem;
    font-size: 0.9rem;
  }
  .section-row input.invalid {
    border-color: color-mix(in srgb, #c44 55%, transparent);
  }
  .section-d {
    margin: 0 0 0 2.1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
