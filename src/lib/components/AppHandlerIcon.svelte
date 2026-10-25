<script lang="ts">
  import type { AppHandlerInfo } from '$lib/app-handlers';

  interface Props {
    app: AppHandlerInfo;
    /** When false, render a bare label (parent supplies the link). */
    linked?: boolean;
  }

  let { app, linked = true }: Props = $props();

  const label = $derived(app.about ? `${app.name} — ${app.about}` : app.name);
  const asLink = $derived(linked && !!app.href);
</script>

{#if asLink}
  <a
    class="work-app-handle"
    href={app.href}
    target="_blank"
    rel="noopener noreferrer"
    title={label}
  >{app.name}</a>
{:else}
  <span class="work-app-handle" title={label}>{app.name}</span>
{/if}

<style>
  .work-app-handle {
    display: inline-flex;
    align-items: center;
    max-width: 14rem;
    padding: 0.15rem 0.45rem;
    border-radius: 0.3rem;
    background: color-mix(in srgb, currentColor 10%, transparent);
    color: inherit;
    text-decoration: none;
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a.work-app-handle:hover,
  a.work-app-handle:focus-visible {
    background: color-mix(in srgb, currentColor 16%, transparent);
    outline: none;
  }
</style>
