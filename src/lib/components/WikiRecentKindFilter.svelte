<script lang="ts">
  import type { WikiRecentKindFilter } from '$lib/wiki-hub';

  let {
    value,
    onchange
  }: {
    value: WikiRecentKindFilter;
    onchange: (next: WikiRecentKindFilter) => void;
  } = $props();

  const options: { id: WikiRecentKindFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'wiki', label: 'Wiki' },
    { id: 'spec', label: 'Spec' }
  ];

</script>

<div class="filter-option-group wiki-recent-kind" role="radiogroup" aria-label="Show wiki or specs">
  {#each options as opt}
    <label class="filter-option" class:active={value === opt.id}>
      <input
        type="radio"
        name="wiki-recent-kind"
        value={opt.id}
        checked={value === opt.id}
        onchange={() => onchange(opt.id)}
      />
      <span>{opt.label}</span>
    </label>
  {/each}
</div>
