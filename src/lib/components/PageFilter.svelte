<script lang="ts">
  interface Props {
    value?: string;
    placeholder?: string;
    id?: string;
    variant?: 'page' | 'reader';
    onEnter?: () => void;
  }

  let {
    value = $bindable(''),
    placeholder = 'Filter this page…',
    id,
    variant = 'page',
    onEnter
  }: Props = $props();

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter?.();
    }
  }
</script>

{#if variant === 'reader'}
  <div class="publication-search">
    <span class="publication-search-icon" aria-hidden="true">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="6.5"></circle>
        <path d="M16.5 16.5 21 21"></path>
      </svg>
    </span>
    <input
      class="page-filter"
      type="search"
      {id}
      {placeholder}
      aria-label={placeholder}
      bind:value={value}
      onkeydown={onKeydown}
    />
  </div>
{:else}
  <input
    class="page-filter"
    type="search"
    {id}
    {placeholder}
    bind:value={value}
    style="max-width:20rem;margin-bottom:1rem"
    onkeydown={onKeydown}
  />
{/if}
