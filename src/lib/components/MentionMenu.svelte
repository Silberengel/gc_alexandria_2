<script lang="ts">
  import { mentionSuggestionDetail, type MentionCandidate } from '$lib/mention';
  import type { MentionUiState } from '$lib/mention-field';
  import UserBadge from './UserBadge.svelte';

  interface Props {
    ui: MentionUiState;
    placement?: 'over' | 'below';
    onChoose: (index: number) => void;
    onHover: (index: number) => void;
  }

  let { ui, placement = 'below', onChoose, onHover }: Props = $props();

  let listEl = $state<HTMLDivElement | null>(null);

  function detail(hit: MentionCandidate): string {
    return mentionSuggestionDetail(hit, ui.query);
  }

  $effect(() => {
    const current = ui.index;
    if (!ui.open) return;
    queueMicrotask(() => {
      const row = listEl?.querySelector(`[data-i="${current}"]`);
      if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
    });
  });
</script>

{#if ui.open}
  <div
    bind:this={listEl}
    class="mention-popover"
    class:over={placement === 'over'}
    role="listbox"
    aria-label="People"
  >
    {#if ui.hits.length}
      {#each ui.hits as hit, i (hit.pubkey)}
        <button
          type="button"
          role="option"
          class="mention-option"
          class:active={i === ui.index}
          aria-selected={i === ui.index}
          data-i={i}
          onpointerdown={(event) => {
            // Keep focus in the composer; fire on down so stylus doesn't lose click.
            event.preventDefault();
            onChoose(i);
          }}
          onmousedown={(event) => event.preventDefault()}
          onmouseenter={() => onHover(i)}
          onclick={(event) => {
            event.preventDefault();
          }}
        >
          <UserBadge pubkey={hit.pubkey} plain />
          {#if detail(hit)}
            <span class="mention-detail">{detail(hit)}</span>
          {/if}
        </button>
      {/each}
    {:else if ui.busy}
      <p class="mention-hint">Searching…</p>
    {:else if !ui.query.trim()}
      <p class="mention-hint">Type a name, NIP-05, or npub</p>
    {:else}
      <p class="mention-hint">No one found</p>
    {/if}
  </div>
{/if}

<style>
  .mention-popover {
    position: absolute;
    z-index: 30;
    left: 0;
    width: max(100%, 18rem);
    max-width: min(28rem, 80vw);
    max-height: min(16rem, 50vh);
    overflow: auto;
    padding: 0.3rem;
    border: 1px solid color-mix(in srgb, var(--rule) 78%, transparent);
    border-radius: 0.45rem;
    background: var(--paper-light);
    box-shadow: var(--shadow-soft, 0 8px 24px rgb(0 0 0 / 16%));
  }
  .mention-popover:not(.over) {
    top: calc(100% + 0.2rem);
  }
  .mention-popover.over {
    top: 0.35rem;
    right: 0.35rem;
    left: 0.35rem;
    width: auto;
    max-width: none;
  }
  .mention-hint {
    margin: 0;
    padding: 0.35rem 0.45rem;
    color: var(--ink-soft);
    font-family: var(--ui-font);
    font-size: 0.85rem;
  }
  .mention-option {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    margin: 0;
    padding: 0.28rem 0.4rem;
    text-align: left;
    font: inherit;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: 0.3rem;
    cursor: pointer;
  }
  .mention-option.active,
  .mention-option:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .mention-option :global(.userbadge) {
    min-width: 0;
    flex: 1 1 auto;
    pointer-events: none;
  }
  .mention-detail {
    flex: 0 1 auto;
    max-width: 46%;
    overflow: hidden;
    color: var(--ink-soft);
    font-family: var(--ui-font);
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
