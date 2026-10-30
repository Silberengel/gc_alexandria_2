<script lang="ts">
  import type { Snippet } from 'svelte';
  import ComposeGrammarTextarea from './ComposeGrammarTextarea.svelte';
  import {
    checkGrammar,
    defaultGrammarLanguageToolCode,
    grammarLanguageOptions,
    type GrammarIssue
  } from '$lib/compose-grammar';

  interface Props {
    value?: string;
    rows?: number;
    placeholder?: string;
    id?: string;
    disabled?: boolean;
    required?: boolean;
    fill?: boolean;
    /**
     * When false, hide Grammar/Language controls and never call LanguageTool
     * (encrypted / private-content composers). Defaults on for prose surfaces.
     */
    grammarEligible?: boolean;
    /** Optional label on the same row as Grammar / Language / headActions. */
    label?: string;
    /** Hide the textarea (e.g. while a Preview pane is shown). */
    hideBody?: boolean;
    /** Extra controls on the label/tools row (e.g. Preview). */
    headActions?: Snippet;
    onPaste?: (event: ClipboardEvent) => void;
    onDrop?: (event: DragEvent) => void;
    element?: HTMLTextAreaElement | null;
  }

  let {
    value = $bindable(''),
    rows = 3,
    placeholder = '',
    id = '',
    disabled = false,
    required = false,
    fill = false,
    grammarEligible = true,
    label = '',
    hideBody = false,
    headActions,
    onPaste,
    onDrop,
    element = $bindable<HTMLTextAreaElement | null>(null)
  }: Props = $props();

  let grammarOn = $state(true);
  let grammarLang = $state(defaultGrammarLanguageToolCode());
  let grammarIssues = $state<GrammarIssue[]>([]);
  let grammarCheckedSource = $state('');
  let grammarBusy = $state(false);
  const langChoices = $derived(grammarLanguageOptions(grammarLang));
  const showGrammar = $derived(grammarEligible && grammarOn && !disabled);
  const showHead = $derived(Boolean(label) || grammarEligible || Boolean(headActions));

  $effect(() => {
    // Follow eligibility (e.g. compose kind change) — do not read the prop into $state init.
    grammarOn = grammarEligible;
  });

  $effect(() => {
    if (!showGrammar) {
      grammarIssues = [];
      grammarCheckedSource = '';
      grammarBusy = false;
      return;
    }
    const text = value;
    const lang = grammarLang;
    let cancelled = false;
    const t = setTimeout(() => {
      grammarBusy = true;
      void checkGrammar(text, lang)
        .then((issues) => {
          if (cancelled) return;
          grammarIssues = issues;
          grammarCheckedSource = text;
        })
        .finally(() => {
          if (!cancelled) grammarBusy = false;
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
      grammarBusy = false;
    };
  });

  function applyFix(issue: GrammarIssue, replacement: string): void {
    const before = value.slice(0, issue.offset);
    const after = value.slice(issue.offset + issue.length);
    value = `${before}${replacement}${after}`;
    grammarIssues = [];
    grammarCheckedSource = '';
  }
</script>

<div class="prose-grammar-field" class:fill>
  {#if showHead}
    <div class="prose-grammar-head">
      {#if label}
        <label class="prose-grammar-label" for={id || undefined}>{label}</label>
      {:else}
        <span class="prose-grammar-head-spacer" aria-hidden="true"></span>
      {/if}
      <div class="prose-grammar-head-actions">
        {#if grammarEligible}
          <label class="compose-grammar-check">
            <input type="checkbox" bind:checked={grammarOn} disabled={disabled} />
            <span>Grammar{#if grammarOn && grammarBusy}…{/if}</span>
          </label>
          <label class="compose-grammar-lang">
            <span class="visually-hidden">Language</span>
            <select bind:value={grammarLang} disabled={disabled || !grammarOn} aria-label="Language">
              {#each langChoices as opt (opt.languageToolCode)}
                <option value={opt.languageToolCode}>{opt.label}</option>
              {/each}
            </select>
          </label>
        {/if}
        {@render headActions?.()}
      </div>
    </div>
  {/if}
  {#if !hideBody}
    <ComposeGrammarTextarea
      {id}
      bind:value
      {rows}
      {placeholder}
      {fill}
      {disabled}
      {required}
      issues={grammarIssues}
      checkedSource={grammarCheckedSource}
      enabled={showGrammar}
      onApply={applyFix}
      {onPaste}
      {onDrop}
      bind:element
    />
  {/if}
</div>

<style>
  .prose-grammar-field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
    min-height: 0;
  }
  .prose-grammar-field.fill {
    height: 100%;
  }
  .prose-grammar-field.fill :global(.grammar-field.fill) {
    flex: 1 1 auto;
    min-height: 0;
  }
  .prose-grammar-head {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem 0.75rem;
    min-width: 0;
  }
  .prose-grammar-label {
    font-family: var(--ui-font);
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .prose-grammar-head-spacer {
    flex: 1 1 auto;
    min-width: 0;
  }
  .prose-grammar-head-actions {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.35rem 0.55rem;
    min-width: 0;
    color: color-mix(in srgb, currentColor 55%, transparent);
    font-family: var(--ui-font);
    font-size: 0.82rem;
    line-height: 1.2;
  }
  .compose-grammar-check {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    cursor: pointer;
    user-select: none;
  }
  .compose-grammar-check input {
    display: inline-block;
    width: auto;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    accent-color: color-mix(in srgb, currentColor 55%, transparent);
  }
  .compose-grammar-check:has(input:disabled) {
    opacity: 0.45;
    cursor: default;
  }
  .compose-grammar-lang select {
    appearance: none;
    width: auto;
    min-width: 4.5rem;
    max-width: 7.5rem;
    margin: 0;
    padding: 0.15rem 0.2rem;
    font: inherit;
    font-size: inherit;
    line-height: inherit;
    color: inherit;
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, currentColor 28%, transparent);
    cursor: pointer;
  }
  .compose-grammar-lang select:hover:not(:disabled),
  .compose-grammar-lang select:focus-visible {
    color: inherit;
    border-bottom-color: color-mix(in srgb, currentColor 55%, transparent);
  }
  .compose-grammar-lang select:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
