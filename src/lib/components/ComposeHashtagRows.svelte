<script lang="ts">
  interface Props {
    /** Topic strings without leading `#`. */
    tags?: string[];
  }

  let { tags = $bindable([] as string[]) }: Props = $props();

  function normalize(raw: string): string {
    return raw.replace(/^#/, '').trim();
  }

  function ensureRows(): void {
    if (!tags.length) tags = [''];
  }

  $effect(() => {
    ensureRows();
  });

  function setAt(i: number, value: string): void {
    const next = [...tags];
    next[i] = normalize(value);
    tags = next;
  }

  function addRow(): void {
    tags = [...tags, ''];
  }

  function removeRow(i: number): void {
    const next = tags.filter((_, idx) => idx !== i);
    tags = next.length ? next : [''];
  }
</script>

<div class="tag-rows">
  <div class="tag-rows-head">
    <span>Hashtags</span>
    <button type="button" class="tag-rows-icon" onclick={addRow} aria-label="Add hashtag">+</button>
  </div>
  {#each tags as tag, i}
    <div class="tag-row">
      <span class="tag-hash" aria-hidden="true">#</span>
      <input
        type="text"
        value={tag}
        placeholder="topic"
        oninput={(e) => setAt(i, e.currentTarget.value)}
      />
      <button
        type="button"
        class="tag-rows-icon"
        onclick={() => removeRow(i)}
        aria-label="Remove hashtag"
        disabled={tags.length <= 1 && !tag.trim()}
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
  .tag-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .tag-hash {
    flex: 0 0 auto;
    opacity: 0.45;
    font-size: 0.9rem;
    line-height: 1;
  }
  .tag-row input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem 0.55rem;
    font-size: 0.9rem;
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
