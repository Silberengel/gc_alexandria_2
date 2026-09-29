<script lang="ts">
  interface Props {
    value?: string;
    placeholder?: string;
    id?: string;
    onEnter?: () => void;
  }

  let { value = $bindable(''), placeholder = 'Filter this page…', id, onEnter }: Props = $props();
</script>

<input
  class="page-filter"
  type="search"
  {id}
  {placeholder}
  bind:value={value}
  style="max-width:20rem;margin-bottom:1rem"
  onkeydown={(e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter?.();
    }
  }}
/>
