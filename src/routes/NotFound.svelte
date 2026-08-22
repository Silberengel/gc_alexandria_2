<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
</script>

<TopBar />
<main class="shell">
  <ErrorPage title="Page not found" message="This address is unknown." />
</main>
