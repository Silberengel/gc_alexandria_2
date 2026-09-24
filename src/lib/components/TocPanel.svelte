<script lang="ts">
  import type { TocEntry, TocNode } from '$lib/publication-load';
  import { tocEntryKey } from '$lib/publication-load';

  interface Props {
    nodes: TocNode[];
    expanded: Record<string, boolean>;
    activeKey?: string;
    isLoaded: (entry: TocEntry) => boolean;
    isDisabled: (entry: TocEntry) => boolean;
    onToggle: (key: string) => void;
    onJump: (entry: TocEntry) => void;
  }

  let {
    nodes,
    expanded,
    activeKey = '',
    isLoaded,
    isDisabled,
    onToggle,
    onJump
  }: Props = $props();

  let rootEl: HTMLElement | null = $state(null);

  $effect(() => {
    if (!activeKey || !rootEl) return;
    const el = rootEl.querySelector<HTMLElement>('.toc-item.toc-current .toc-link');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
</script>

<div class="toc-panel" bind:this={rootEl}>
  {#snippet branch(list: TocNode[])}
    <ol class="toc-tree">
      {#each list as node (tocEntryKey(node.entry))}
        {@const entry = node.entry}
        {@const key = tocEntryKey(entry)}
        {@const hasKids = node.children.length > 0}
        {@const open = hasKids && (expanded[key] ?? entry.depth === 0)}
        {@const loaded = isLoaded(entry)}
        {@const unavailable = isDisabled(entry)}
        {@const current = !!activeKey && key === activeKey}
        <li
          class="toc-item"
          class:toc-branch={hasKids}
          class:toc-index={!!entry.index}
          class:toc-root={!!entry.root}
          class:toc-unloaded={!loaded}
          class:toc-open={open}
          class:toc-current={current}
          aria-current={current ? 'location' : undefined}
        >
          <div class="toc-row">
            {#if hasKids}
              <button
                class="toc-twist"
                type="button"
                aria-expanded={open}
                aria-label={open ? 'Collapse' : 'Expand'}
                onclick={() => onToggle(key)}
              >
                <span class="toc-twist-icon" aria-hidden="true"></span>
              </button>
            {:else}
              <span class="toc-twist-spacer" aria-hidden="true"></span>
            {/if}
            <button
              class="toc-link"
              type="button"
              disabled={unavailable}
              title={loaded ? undefined : entry.index ? 'Open this part' : 'Not loaded yet'}
              onclick={() => onJump(entry)}
            >
              <span class="toc-link-text">{entry.title}</span>
            </button>
          </div>
          {#if hasKids && open}
            {@render branch(node.children)}
          {/if}
        </li>
      {/each}
    </ol>
  {/snippet}

  {@render branch(nodes)}
</div>
