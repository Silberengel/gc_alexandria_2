<script lang="ts">
  interface Props {
    /** Each row is one multi-part entry: `[part0, part1, ...]`. */
    tags?: string[][];
    label?: string;
    hint?: string;
    addRowLabel?: string;
    removeRowLabel?: string;
    /** When false, inputs keep typed spaces (identifiers); event tags trim. */
    trimParts?: boolean;
    partPlaceholder?: (part: number) => string;
  }

  let {
    tags = $bindable([] as string[][]),
    label = 'Event tags',
    hint = undefined,
    addRowLabel = 'Add event tag',
    removeRowLabel = 'Remove event tag',
    trimParts = true,
    partPlaceholder = defaultPartPlaceholder
  }: Props = $props();

  const showDefaultHint = $derived(hint === undefined && label === 'Event tags');

  const MIN_PARTS = 2;

  function defaultPartPlaceholder(part: number): string {
    if (part === 0) return 'name';
    if (part === 1) return 'value';
    return `value ${part}`;
  }

  function blankRow(): string[] {
    return ['', ''];
  }

  function ensureRows(): void {
    if (!tags.length) tags = [blankRow()];
  }

  $effect(() => {
    ensureRows();
  });

  function setPart(row: number, part: number, value: string): void {
    const next = tags.map((r) => [...r]);
    const cells = next[row] ?? blankRow();
    while (cells.length <= part) cells.push('');
    cells[part] = trimParts ? value.trim() : value;
    next[row] = cells;
    tags = next;
  }

  function addPart(row: number): void {
    const next = tags.map((r) => [...r]);
    const cells = next[row] ?? blankRow();
    cells.push('');
    next[row] = cells;
    tags = next;
  }

  function removePart(row: number, part: number): void {
    const next = tags.map((r) => [...r]);
    const cells = [...(next[row] ?? blankRow())];
    if (cells.length <= MIN_PARTS) return;
    cells.splice(part, 1);
    next[row] = cells.length >= MIN_PARTS ? cells : blankRow();
    tags = next;
  }

  function addRow(): void {
    tags = [...tags, blankRow()];
  }

  function removeRow(i: number): void {
    const next = tags.filter((_, idx) => idx !== i);
    tags = next.length ? next : [blankRow()];
  }

  function clearAll(): void {
    tags = [blankRow()];
  }

  const canClear = $derived(
    tags.length > 1 || tags.some((row) => row.some((c) => c.trim()))
  );
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
      <button type="button" class="tag-rows-icon" onclick={addRow} aria-label={addRowLabel}>+</button>
    </div>
  </div>
  {#if showDefaultHint}
    <p class="tag-rows-hint muted">
      One row per tag. Add parts for multi-value tags (e.g. <code>e</code> id relay pubkey marker).
    </p>
  {:else if hint}
    <p class="tag-rows-hint muted">{hint}</p>
  {/if}
  {#each tags as row, i}
    <div class="tag-row event-tag-row">
      <div class="tag-parts">
        {#each row as cell, j}
          <div class="tag-part">
            <input
              type="text"
              value={cell}
              placeholder={partPlaceholder(j)}
              oninput={(e) => setPart(i, j, e.currentTarget.value)}
            />
            {#if j >= MIN_PARTS}
              <button
                type="button"
                class="tag-part-remove"
                onclick={() => removePart(i, j)}
                aria-label="Remove tag part"
                title="Remove part">×</button
              >
            {/if}
          </div>
        {/each}
        <button
          type="button"
          class="tag-rows-icon"
          onclick={() => addPart(i)}
          aria-label="Add tag part"
          title="Add part">+</button
        >
      </div>
      <button
        type="button"
        class="tag-rows-icon"
        onclick={() => removeRow(i)}
        aria-label={removeRowLabel}
        disabled={tags.length <= 1 && row.every((c) => !c.trim())}
        >−</button
      >
    </div>
  {/each}
</div>

<style>
  .tag-rows {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
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
  .tag-rows-hint code {
    font-size: 0.85em;
  }
  .event-tag-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .tag-parts {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .tag-part {
    position: relative;
    display: flex;
    flex: 1 1 6rem;
    min-width: 4.5rem;
    max-width: 100%;
  }
  .tag-part input {
    width: 100%;
    min-width: 0;
    padding: 0.35rem 1.15rem 0.35rem 0.55rem;
    font-size: 0.9rem;
  }
  .tag-part:first-child {
    flex: 0 1 5.5rem;
    max-width: 7rem;
  }
  .tag-part:first-child input {
    padding-right: 0.55rem;
  }
  .tag-part-remove {
    position: absolute;
    right: 0.15rem;
    top: 50%;
    transform: translateY(-50%);
    box-sizing: border-box;
    width: 1rem;
    height: 1rem;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 0.75rem;
    line-height: 1;
    opacity: 0.55;
    cursor: pointer;
  }
  .tag-part-remove:hover {
    opacity: 1;
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
</style>
