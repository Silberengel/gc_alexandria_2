<script lang="ts">
  import { onDestroy } from 'svelte';
  import { closeMediaViewer, mediaViewer } from '$lib/stores/media-viewer';

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const ZOOM_STEP = 0.25;

  let zoom = $state(1);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let dragging = $state(false);
  let status = $state('');
  let dragOrigin = { x: 0, y: 0, ox: 0, oy: 0 };

  $effect(() => {
    if (!$mediaViewer.open) return;
    zoom = 1;
    offsetX = 0;
    offsetY = 0;
    status = '';
  });

  $effect(() => {
    if (!$mediaViewer.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMediaViewer();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        bumpZoom(ZOOM_STEP);
      } else if (e.key === '-') {
        e.preventDefault();
        bumpZoom(-ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        resetView();
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  });

  onDestroy(() => {
    document.body.style.overflow = '';
  });

  function clampZoom(value: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
  }

  function bumpZoom(delta: number): void {
    const next = clampZoom(zoom + delta);
    zoom = next;
    if (next <= MIN_ZOOM) {
      offsetX = 0;
      offsetY = 0;
    }
  }

  function resetView(): void {
    zoom = 1;
    offsetX = 0;
    offsetY = 0;
  }

  function onWheel(e: WheelEvent): void {
    if (!$mediaViewer.open) return;
    e.preventDefault();
    bumpZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }

  function onPointerDown(e: PointerEvent): void {
    if (zoom <= MIN_ZOOM) return;
    dragging = true;
    dragOrigin = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    offsetX = dragOrigin.ox + (e.clientX - dragOrigin.x);
    offsetY = dragOrigin.oy + (e.clientY - dragOrigin.y);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function filenameFromUrl(url: string): string {
    try {
      const path = new URL(url).pathname;
      const base = path.split('/').filter(Boolean).pop() || 'cover';
      return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(base) ? base : `${base}.jpg`;
    } catch {
      return 'cover.jpg';
    }
  }

  async function download(): Promise<void> {
    const url = $mediaViewer.url;
    if (!url) return;
    const name = filenameFromUrl(url);
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      status = 'Downloaded';
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
      status = 'Opened original';
    }
    window.setTimeout(() => {
      if (status === 'Downloaded' || status === 'Opened original') status = '';
    }, 1600);
  }

  async function shareOrCopy(): Promise<void> {
    const url = $mediaViewer.url;
    if (!url) return;
    const title = $mediaViewer.title || 'Cover';
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, url });
        status = 'Shared';
      } else {
        await navigator.clipboard.writeText(url);
        status = 'Link copied';
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(url);
        status = 'Link copied';
      } catch {
        status = 'Could not share';
      }
    }
    window.setTimeout(() => {
      if (status === 'Shared' || status === 'Link copied' || status === 'Could not share') status = '';
    }, 1600);
  }
</script>

{#if $mediaViewer.open}
  <div
    class="media-viewer-backdrop"
    role="presentation"
    onclick={closeMediaViewer}
  >
    <div
      class="media-viewer"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label={$mediaViewer.title ? `Cover: ${$mediaViewer.title}` : 'Cover image'}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header class="media-viewer-toolbar">
        <p class="media-viewer-title">{$mediaViewer.title || 'Cover'}</p>
        <div class="media-viewer-actions">
          <button class="btn media-viewer-btn" type="button" title="Zoom out (−)" onclick={() => bumpZoom(-ZOOM_STEP)}
            >−</button
          >
          <button class="btn media-viewer-btn" type="button" title="Reset zoom (0)" onclick={resetView}
            >{Math.round(zoom * 100)}%</button
          >
          <button class="btn media-viewer-btn" type="button" title="Zoom in (+)" onclick={() => bumpZoom(ZOOM_STEP)}
            >+</button
          >
          <button class="btn media-viewer-btn" type="button" title="Download" onclick={() => void download()}
            >Download</button
          >
          <button class="btn media-viewer-btn" type="button" title="Share or copy link" onclick={() => void shareOrCopy()}
            >Share</button
          >
          <button
            class="btn media-viewer-btn media-viewer-close"
            type="button"
            title="Close (Esc)"
            aria-label="Close"
            onclick={closeMediaViewer}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>
      {#if status}
        <p class="media-viewer-status muted" aria-live="polite">{status}</p>
      {/if}
      <div
        class="media-viewer-stage"
        class:media-viewer-stage-zoom={zoom > 1}
        role="region"
        aria-label="Zoomable cover image"
        tabindex="-1"
        onwheel={onWheel}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
      >
        <img
          class="media-viewer-image"
          src={$mediaViewer.url}
          alt={$mediaViewer.title || 'Cover'}
          draggable="false"
          style={`transform: translate(${offsetX}px, ${offsetY}px) scale(${zoom});`}
        />
      </div>
    </div>
  </div>
{/if}
