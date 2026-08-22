<script lang="ts">
  interface Props {
    placeholder?: string;
  }

  let { placeholder = 'Filter this page…' }: Props = $props();
  let filter = $state('');

  export function getFilter(): string {
    return filter.trim().toLowerCase();
  }
</script>

<input type="search" {placeholder} bind:value={filter} style="max-width:20rem;margin-bottom:1rem" />
