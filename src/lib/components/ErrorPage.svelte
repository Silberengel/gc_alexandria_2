<script lang="ts">
  interface Props {
    title?: string;
    message?: string;
  }

  let {
    title = 'Something went wrong',
    message = 'This address is invalid, or the event could not be found.'
  }: Props = $props();
</script>

<div class="error-page card">
  <h1>{title}</h1>
  <p class="muted">{message}</p>
  <p><a href="#/">Return home</a></p>
</div>
