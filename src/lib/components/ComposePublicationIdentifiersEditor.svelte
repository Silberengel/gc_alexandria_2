<script lang="ts">
  import ComposeEventTagRows from './ComposeEventTagRows.svelte';
  import {
    formatIdentifierRows,
    identifierRowsFromRaw
  } from '$lib/compose-publication-identifiers';

  interface Props {
    value?: string;
    label?: string;
    required?: boolean;
    help?: string;
  }

  let {
    value = $bindable(''),
    label = 'Identifiers',
    required = false,
    help = ''
  }: Props = $props();

  let rows = $state<string[][]>(identifierRowsFromRaw(value));
  let lastEmitted = $state(value);
  let syncing = false;

  $effect(() => {
    if (value !== lastEmitted) {
      syncing = true;
      rows = identifierRowsFromRaw(value);
      lastEmitted = value;
      syncing = false;
    }
  });

  $effect(() => {
    const snapshot = rows.map((r) => [...r]);
    if (syncing) return;
    const raw = formatIdentifierRows(snapshot);
    if (raw === lastEmitted) return;
    lastEmitted = raw;
    value = raw;
  });

  function partPlaceholder(part: number): string {
    if (part === 0) return 'scheme';
    if (part === 1) return 'value';
    return `part ${part + 1}`;
  }
</script>

<ComposeEventTagRows
  bind:tags={rows}
  label={`${label}${required ? '*' : ''}`}
  hint={help ||
    'One identifier per row (e.g. isbn + value). Add parts for multi-segment values; they join with : on publish.'}
  addRowLabel="Add identifier"
  removeRowLabel="Remove identifier"
  trimParts={false}
  {partPlaceholder}
/>
