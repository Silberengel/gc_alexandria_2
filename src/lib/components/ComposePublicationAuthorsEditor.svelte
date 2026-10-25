<script lang="ts">
  import {
    AUTHOR_ROLE_OTHER,
    AUTHOR_ROLE_SUGGESTIONS,
    authorRoleSelectValue,
    authorRowsFromRaw,
    formatAuthors,
    type AuthorEntry
  } from '$lib/compose-publication-authors';

  interface Props {
    /** Serialized author lines (`Name` or `Name|role`), newline-separated. */
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
  }

  let {
    value = $bindable(''),
    label = 'Author',
    required = false,
    help = ''
  }: Props = $props();

  let rows = $state<AuthorEntry[]>(authorRowsFromRaw(value));
  let lastEmitted = $state(value);

  $effect(() => {
    if (value !== lastEmitted) {
      rows = authorRowsFromRaw(value);
      lastEmitted = value;
    }
  });

  function commit(next: AuthorEntry[]): void {
    rows = next;
    const raw = formatAuthors(next);
    lastEmitted = raw;
    value = raw;
  }

  function setName(i: number, name: string): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, name } : r)));
  }

  function setRoleSelect(i: number, select: string): void {
    const current = rows[i] ?? { name: '', role: 'author' };
    if (select === AUTHOR_ROLE_OTHER) {
      const custom =
        authorRoleSelectValue(current.role) === AUTHOR_ROLE_OTHER
          ? (current.role ?? '').trim()
          : '';
      commit(rows.map((r, idx) => (idx === i ? { ...r, role: custom } : r)));
      return;
    }
    commit(rows.map((r, idx) => (idx === i ? { ...r, role: select } : r)));
  }

  function setCustomRole(i: number, role: string): void {
    commit(rows.map((r, idx) => (idx === i ? { ...r, role } : r)));
  }

  function addRow(): void {
    commit([...rows, { name: '', role: 'author' }]);
  }

  function removeRow(i: number): void {
    if (rows.length <= 1) {
      commit([{ name: '', role: 'author' }]);
      return;
    }
    commit(rows.filter((_, idx) => idx !== i));
  }
</script>

<div class="tag-rows author-rows">
  <div class="tag-rows-head">
    <span>{label}{#if required}*{/if}</span>
    <button type="button" class="tag-rows-icon" onclick={addRow} aria-label="Add author">+</button>
  </div>
  {#if help}
    <p class="tag-rows-hint muted">{help}</p>
  {/if}
  {#each rows as entry, i}
    {@const select = authorRoleSelectValue(entry.role)}
    <div class="author-block">
      <div class="tag-row author-row">
        <input
          type="text"
          value={entry.name}
          placeholder="Name"
          aria-label="Author name"
          oninput={(e) => setName(i, e.currentTarget.value)}
        />
        <select
          value={select}
          aria-label="Author role"
          onchange={(e) => setRoleSelect(i, e.currentTarget.value)}
        >
          {#each AUTHOR_ROLE_SUGGESTIONS as opt}
            <option value={opt}>{opt}</option>
          {/each}
          <option value={AUTHOR_ROLE_OTHER}>other…</option>
        </select>
        <button
          type="button"
          class="tag-rows-icon"
          onclick={() => removeRow(i)}
          aria-label="Remove author"
          disabled={rows.length <= 1 && !entry.name.trim()}
          >−</button
        >
      </div>
      {#if select === AUTHOR_ROLE_OTHER}
        <input
          type="text"
          class="author-custom-role"
          value={entry.role ?? ''}
          placeholder="custom role"
          aria-label="Custom author role"
          oninput={(e) => setCustomRole(i, e.currentTarget.value)}
        />
      {/if}
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
  .tag-rows-hint {
    margin: 0;
    font-size: 0.8rem;
  }
  .author-block {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .author-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .author-row input {
    flex: 1 1 0;
    min-width: 0;
    padding: 0.35rem 0.55rem;
    font-size: 0.9rem;
  }
  .author-row select {
    flex: 0 1 8.5rem;
    max-width: 10rem;
    min-width: 6.5rem;
    padding: 0.35rem 0.4rem;
    font-size: 0.9rem;
  }
  .author-custom-role {
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
</style>
