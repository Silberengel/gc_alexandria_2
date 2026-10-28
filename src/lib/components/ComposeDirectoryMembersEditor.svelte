<script lang="ts">
  import {
    directoryMemberDisplayId,
    directoryMemberRowFromPointer,
    directoryMemberRowsFromRaw,
    formatDirectoryMembers,
    isValidDirectoryMemberValue,
    moveDirectoryMemberRow,
    type DirectoryMemberRow
  } from '$lib/compose-directory-members';
  import { displayTitle, cardMeta } from '$lib/metadata';
  import { fetchByAddress, fetchById } from '$lib/nostr/fetch';
  import { parseAddress } from '$lib/library-scope';
  import type { Event } from 'nostr-tools';

  interface Props {
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
  }

  let {
    value = $bindable(''),
    label = 'Members',
    required = false,
    help = ''
  }: Props = $props();

  let rows = $state<DirectoryMemberRow[]>(directoryMemberRowsFromRaw(value));
  let lastEmitted = $state(value);
  /** index → resolved publication blurb */
  let blurbs = $state<Record<number, string>>({});
  let resolveGen = 0;

  $effect(() => {
    if (value !== lastEmitted) {
      rows = directoryMemberRowsFromRaw(value);
      lastEmitted = value;
    }
  });

  $effect(() => {
    const snapshot = rows.map((r) => ({ ...r }));
    const gen = ++resolveGen;
    let cancelled = false;
    blurbs = {};
    void (async () => {
      const found: Record<number, string> = {};
      await Promise.all(
        snapshot.map(async (row, i) => {
          const ev = await resolveMemberEvent(row);
          if (cancelled || gen !== resolveGen || !ev) return;
          const title = displayTitle(ev);
          const authors = cardMeta(ev).authors.filter(Boolean);
          const authorLine = authors.slice(0, 2).join(', ');
          const bits = [title, authorLine].filter(Boolean);
          if (bits.length) found[i] = bits.join(' · ');
        })
      );
      if (cancelled || gen !== resolveGen) return;
      blurbs = found;
    })();
    return () => {
      cancelled = true;
    };
  });

  async function resolveMemberEvent(row: DirectoryMemberRow): Promise<Event | null> {
    if (row.tag === 'a' && parseAddress(row.value)) {
      return fetchByAddress(row.value.trim());
    }
    const display = directoryMemberDisplayId(row);
    if (!display) return null;
    if (/^[0-9a-f]{64}$/i.test(display)) {
      return fetchById(display.toLowerCase());
    }
    if (parseAddress(display)) {
      return fetchByAddress(display);
    }
    const extra = row.extra?.trim() ?? '';
    if (extra && /^[0-9a-f]{64}$/i.test(extra)) {
      return fetchById(extra.toLowerCase());
    }
    return null;
  }

  function commit(next: DirectoryMemberRow[]): void {
    rows = next.length ? next : [{ tag: 'a', value: '' }];
    const raw = formatDirectoryMembers(rows);
    lastEmitted = raw;
    value = raw;
  }

  function setAt(i: number, pointer: string): void {
    commit(rows.map((r, idx) => (idx === i ? directoryMemberRowFromPointer(pointer, r) : r)));
  }

  function addRow(): void {
    commit([...rows, { tag: 'a', value: '' }]);
  }

  function removeRow(i: number): void {
    if (rows.length <= 1) {
      commit([{ tag: 'a', value: '' }]);
      return;
    }
    commit(rows.filter((_, idx) => idx !== i));
  }

  function moveUp(i: number): void {
    if (i <= 0) return;
    commit(moveDirectoryMemberRow(rows, i, i - 1));
  }

  function moveDown(i: number): void {
    if (i >= rows.length - 1) return;
    commit(moveDirectoryMemberRow(rows, i, i + 1));
  }
</script>

<div class="tag-rows member-rows">
  <div class="tag-rows-head">
    <span>{label}{#if required}*{/if}</span>
    <button type="button" class="tag-rows-icon" onclick={addRow} aria-label="Add member">+</button>
  </div>
  {#if help}
    <p class="tag-rows-hint muted">{help}</p>
  {/if}
  {#each rows as row, i}
    {@const pointer = directoryMemberDisplayId(row)}
    <div class="member-block">
      <div class="tag-row member-row">
        <div class="member-move">
          <button
            type="button"
            class="tag-rows-icon"
            onclick={() => moveUp(i)}
            aria-label="Move member up"
            disabled={i === 0}
            title="Move up">↑</button
          >
          <button
            type="button"
            class="tag-rows-icon"
            onclick={() => moveDown(i)}
            aria-label="Move member down"
            disabled={i >= rows.length - 1}
            title="Move down">↓</button
          >
        </div>
        <label class="member-field">
          <span class="member-field-label">{row.tag === 'a' ? 'Address' : 'Event id'}</span>
          <input
            type="text"
            value={pointer}
            placeholder="kind:pubkey:d, naddr, nevent, or event id"
            aria-label={`Member ${i + 1}`}
            class:invalid={pointer.trim() && !isValidDirectoryMemberValue(pointer)}
            oninput={(e) => setAt(i, e.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          class="tag-rows-icon"
          onclick={() => removeRow(i)}
          aria-label="Remove member"
          disabled={rows.length <= 1 && !pointer.trim()}
          >−</button
        >
      </div>
      {#if blurbs[i]}
        <p class="member-blurb muted" title={blurbs[i]}>{blurbs[i]}</p>
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
  .member-block {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .member-row {
    display: flex;
    align-items: flex-end;
    gap: 0.3rem;
    min-width: 0;
  }
  .member-move {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 0 0 auto;
  }
  .member-field {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .member-field-label {
    font-size: 0.72rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-muted, inherit);
    opacity: 0.8;
  }
  .member-field input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.35rem 0.55rem;
    font-size: 0.9rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .member-field input.invalid {
    border-color: color-mix(in srgb, #c44 55%, transparent);
  }
  .member-blurb {
    margin: 0 0 0 2.1rem;
    font-size: 0.78rem;
    line-height: 1.35;
    opacity: 0.78;
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
