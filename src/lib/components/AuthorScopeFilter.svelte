<script lang="ts">
  import type { AuthorResultScope } from '$lib/result-scope';

  let {
    value,
    showMine = false,
    showFollows = false,
    showTrusted = true,
    onchange
  }: {
    value: AuthorResultScope;
    showMine?: boolean;
    showFollows?: boolean;
    showTrusted?: boolean;
    onchange: (next: AuthorResultScope) => void;
  } = $props();

  const showAny = $derived(showMine || showFollows || showTrusted);

  const options = $derived.by(() => {
    const out: { id: AuthorResultScope; label: string; title?: string }[] = [
      { id: 'all', label: 'All' }
    ];
    if (showMine) {
      out.push({ id: 'mine', label: 'From me', title: 'Published by you' });
    }
    if (showFollows) {
      out.push({
        id: 'follows',
        label: 'From follows',
        title: 'Published by accounts you follow'
      });
    }
    if (showTrusted) {
      out.push({
        id: 'trusted',
        label: 'From trusted npubs',
        title: 'Authors with at least the minimum Brainstorm / GrapeRank score'
      });
    }
    return out;
  });
</script>

{#if showAny}
  <div class="filter-option-group author-scope" role="radiogroup" aria-label="Author source">
    {#each options as opt (opt.id)}
      <label class="filter-option" class:active={value === opt.id} title={opt.title}>
        <input
          type="radio"
          name="author-result-scope"
          value={opt.id}
          checked={value === opt.id}
          onchange={() => onchange(opt.id)}
        />
        <span>{opt.label}</span>
      </label>
    {/each}
  </div>
{/if}
