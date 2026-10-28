<script lang="ts">
  import { onMount } from 'svelte';
  import { tryParseSno } from '$lib/sno/parse';
  import { defaultView, renderSno, type SnoViewState } from '$lib/sno/render';

  interface Props {
    content: string;
    name?: string;
    /** CSS pixel size of the canvas. */
    size?: number;
  }

  let { content, name = '', size = 320 }: Props = $props();

  const sno = $derived(tryParseSno(content));
  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let view = $state<SnoViewState>({ yaw: 0.6, pitch: 0.35, distance: 12 });
  let dragging = $state(false);
  let lastX = 0;
  let lastY = 0;
  let raf = 0;
  let auto = $state(true);

  $effect(() => {
    if (sno) view = defaultView(sno);
  });

  function paint(): void {
    const canvas = canvasEl;
    if (!canvas || !sno) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const w = size;
    const h = size;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderSno(ctx, sno, view, w, h);
  }

  function tick(): void {
    if (auto && !dragging && sno) {
      view = { ...view, yaw: view.yaw + 0.008 };
    }
    paint();
    raf = requestAnimationFrame(tick);
  }

  onMount(() => {
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    auto = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasEl?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    view = {
      ...view,
      yaw: view.yaw + dx * 0.01,
      pitch: Math.max(-1.2, Math.min(1.2, view.pitch + dy * 0.01))
    };
  }

  function onPointerUp(): void {
    dragging = false;
  }
</script>

{#if sno}
  <figure class="sno-viewer">
    <canvas
      bind:this={canvasEl}
      class="sno-canvas"
      style:width={`${size}px`}
      style:height={`${size}px`}
      aria-label={name || sno.name || '3D object'}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
    ></canvas>
    <figcaption class="sno-caption muted">
      {name || sno.name}
      <span class="sno-meta"> · {sno.vertices.length} vertices · {sno.mode}</span>
      <button type="button" class="sno-spin" onclick={() => (auto = !auto)}
        >{auto ? 'Pause' : 'Spin'}</button
      >
    </figcaption>
  </figure>
{:else}
  <p class="muted sno-invalid">Could not render this 3D object.</p>
{/if}

<style>
  .sno-viewer {
    margin: 0.4rem 0 0.6rem;
    max-width: 100%;
  }
  .sno-canvas {
    display: block;
    max-width: 100%;
    border-radius: 0.45rem;
    touch-action: none;
    cursor: grab;
    background: #151a24;
  }
  .sno-canvas:active {
    cursor: grabbing;
  }
  .sno-caption {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    margin-top: 0.35rem;
    font-size: 0.85rem;
  }
  .sno-meta {
    opacity: 0.75;
  }
  .sno-spin {
    margin-left: auto;
    border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
    background: transparent;
    border-radius: 0.3rem;
    padding: 0.1rem 0.45rem;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    color: inherit;
  }
  .sno-invalid {
    margin: 0.4rem 0;
  }
</style>
