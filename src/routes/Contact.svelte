<script lang="ts">
  import { onMount } from 'svelte';
  import { replace } from 'svelte-spa-router';

  /** Legacy `/contact` → About (contact form is at the bottom when signed in). */
  onMount(() => {
    try {
      sessionStorage.setItem('alexandria-scroll-contact', '1');
    } catch {
      /* ignore */
    }
    replace('/about');
  });
</script>
