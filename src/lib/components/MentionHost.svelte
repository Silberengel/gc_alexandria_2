<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MentionUiState } from '$lib/mention-field';
  import MentionMenu from './MentionMenu.svelte';

  interface Props {
    ui: MentionUiState;
    placement?: 'over' | 'below';
    fill?: boolean;
    onChoose: (index: number) => void;
    onHover: (index: number) => void;
    children: Snippet;
  }

  let { ui, placement = 'below', fill = false, onChoose, onHover, children }: Props = $props();
</script>

<div class="mention-host" class:fill>
  {@render children()}
  <MentionMenu {ui} {placement} {onChoose} {onHover} />
</div>

<style>
  .mention-host {
    position: relative;
    display: block;
    min-width: 0;
    max-width: 100%;
    flex: 1 1 auto;
  }
  .mention-host.fill {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .mention-host.fill :global(textarea) {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-height: 0;
    resize: none;
  }
</style>
