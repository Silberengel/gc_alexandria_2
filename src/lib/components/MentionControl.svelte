<script lang="ts">
  import {
    attachMentionField,
    MENTION_UI_IDLE,
    type MentionFieldBinding,
    type MentionUiState
  } from '$lib/mention-field';
  import type { MentionInsertMode } from '$lib/mention';
  import MentionHost from './MentionHost.svelte';

  interface Props {
    value?: string;
    mode?: MentionInsertMode;
    multiline?: boolean;
    rows?: number;
    placeholder?: string;
    id?: string;
    disabled?: boolean;
    required?: boolean;
    spellcheck?: boolean | 'true' | 'false';
    autocomplete?: HTMLInputElement['autocomplete'];
    class?: string;
    fill?: boolean;
    placement?: 'over' | 'below';
    ariaLabel?: string;
    element?: HTMLInputElement | HTMLTextAreaElement | null;
    onValue?: (value: string) => void;
    onpaste?: (event: ClipboardEvent) => void;
    ondrop?: (event: DragEvent) => void;
    onblur?: (event: FocusEvent) => void;
    onchange?: (event: Event) => void;
  }

  let {
    value = $bindable(''),
    mode = 'prose',
    multiline = false,
    rows = 3,
    placeholder = '',
    id = '',
    disabled = false,
    required = false,
    spellcheck = undefined,
    autocomplete = undefined,
    class: className = '',
    fill = false,
    placement = undefined,
    ariaLabel = '',
    element = $bindable<HTMLInputElement | HTMLTextAreaElement | null>(null),
    onValue,
    onpaste,
    ondrop,
    onblur,
    onchange
  }: Props = $props();

  let ui = $state<MentionUiState>(MENTION_UI_IDLE);
  let binding: MentionFieldBinding | null = null;

  const menuPlacement = $derived(placement ?? (fill ? 'over' : 'below'));
  const spell = $derived(spellcheck === undefined ? mode !== 'npub' : spellcheck !== false && spellcheck !== 'false');
  const complete = $derived(autocomplete ?? (mode === 'npub' ? 'off' : 'on'));

  function typed(event: Event): void {
    const node = event.currentTarget;
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return;
    value = node.value;
    onValue?.(node.value);
  }

  function attach(node: HTMLInputElement | HTMLTextAreaElement) {
    element = node;
    binding = attachMentionField(node, {
      mode: () => mode,
      onState: (next) => {
        ui = next;
      }
    });
    return () => {
      binding?.destroy();
      binding = null;
      if (element === node) element = null;
    };
  }
</script>

<MentionHost
  ui={ui}
  placement={menuPlacement}
  {fill}
  onChoose={(index) => binding?.choose(index)}
  onHover={(index) => binding?.setIndex(index)}
>
  {#if multiline}
    <textarea
      {@attach attach}
      {rows}
      {placeholder}
      id={id || undefined}
      {disabled}
      {required}
      spellcheck={spell}
      autocomplete={complete}
      class={className || undefined}
      aria-label={ariaLabel || undefined}
      bind:value
      oninput={typed}
      onpaste={onpaste}
      ondrop={ondrop}
      {onblur}
      {onchange}
    ></textarea>
  {:else}
    <input
      {@attach attach}
      type="text"
      {placeholder}
      id={id || undefined}
      {disabled}
      {required}
      spellcheck={spell}
      autocomplete={complete}
      class={className || undefined}
      aria-label={ariaLabel || undefined}
      bind:value
      oninput={typed}
      onpaste={onpaste}
      ondrop={ondrop}
      {onblur}
      {onchange}
    />
  {/if}
</MentionHost>
