<script lang="ts">
  import {
    DEFAULT_DRAW_SIZE,
    DEFAULT_HIGHLIGHTER_COLOR,
    DEFAULT_HIGHLIGHTER_SIZE,
    DEFAULT_TEXT_SIZE,
    DRAW_FONTS,
    FREEHAND_TOOLS,
    INK_PALETTE,
    LABEL_TOOLS,
    PAPERS,
    SHAPE_TOOLS,
    drawFontById,
    encodeDrawingGif,
    encodeDrawingGifForUpload,
    isShapeTool,
    isTextTool,
    paintDrawing,
    prepareBackgroundForDrawing,
    type DrawBackgroundImage,
    type DrawFontId,
    type DrawStroke,
    type DrawTool,
    type PaperId
  } from '$lib/drawing';
  import {
    compressBackgroundForDraft,
    deleteDrawingDraft,
    loadDrawingDraft,
    saveDrawingDraft
  } from '$lib/comment-drafts';
  import { uploadDrawingGif } from '$lib/drawing/upload';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';

  interface Props {
    open: boolean;
    /** Called when the user finishes; parent inserts URL/imeta into a note or comment. */
    onComplete?: (result: {
      url: string;
      imeta: string[];
      alt: string;
      blob: Blob;
    }) => void;
    onCancel?: () => void;
    /** Optional constrained title for margin ink. */
    title?: string;
    initialPaper?: PaperId;
    /** Autosave strokes while drawing (e.g. `draw:comment:<id>` or `ink:<id>:<quoteHash>`). */
    draftScope?: string;
  }

  let {
    open = $bindable(false),
    onComplete,
    onCancel,
    title = 'Draw',
    initialPaper = 'parchment',
    draftScope = ''
  }: Props = $props();

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let tool = $state<DrawTool>('brush');
  let color = $state<string>(INK_PALETTE[0]!);
  let width = $state(5);
  let labelText = $state('');
  let fontId = $state<DrawFontId>('sans');
  /** Remember brush size when switching to/from text. */
  let brushWidth = 5;
  let paperId = $state<PaperId>('parchment');
  let mirror = $state(false);
  let strokes = $state<DrawStroke[]>([]);
  let redoStack = $state<DrawStroke[]>([]);
  let drawing = $state(false);
  let activePointerId = $state<number | null>(null);
  let penActive = $state(false);
  let busy = $state(false);
  let error = $state('');
  let altText = $state('');
  let step = $state<'draw' | 'preview'>('draw');
  let previewUrl = $state<string | null>(null);
  let previewBlob = $state<Blob | null>(null);
  let fullScreen = $state(readFullScreenPref());
  let backgroundImage = $state<DrawBackgroundImage | null>(null);
  let backgroundObjectUrl = $state<string | null>(null);
  let backgroundName = $state('');
  /** Compressed data URL kept for autosave (object URLs do not survive reload). */
  let backgroundDraftDataUrl = $state<string | null>(null);
  let bgFileInput = $state<HTMLInputElement | null>(null);
  let drawSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let restoredForOpen = false;

  const W = DEFAULT_DRAW_SIZE.width;
  const H = DEFAULT_DRAW_SIZE.height;

  function persistDrawingDraft(): void {
    const pubkey = $session.pubkey;
    if (!pubkey || !draftScope) return;
    saveDrawingDraft(pubkey, draftScope, {
      strokes,
      paperId,
      mirror,
      labelText,
      fontId,
      color,
      width,
      tool,
      ...(backgroundDraftDataUrl
        ? {
            backgroundDataUrl: backgroundDraftDataUrl,
            backgroundName: backgroundName || 'Background'
          }
        : {})
    });
  }

  function scheduleDrawingPersist(): void {
    if (!draftScope || !$session.pubkey || !open) return;
    if (drawSaveTimer) clearTimeout(drawSaveTimer);
    drawSaveTimer = setTimeout(() => {
      drawSaveTimer = null;
      persistDrawingDraft();
    }, 320);
  }

  function discardDrawingDraft(): void {
    const pubkey = $session.pubkey;
    if (!pubkey || !draftScope) return;
    deleteDrawingDraft(pubkey, draftScope);
  }

  function restoreDrawingDraft(): boolean {
    const pubkey = $session.pubkey;
    if (!pubkey || !draftScope) return false;
    const saved = loadDrawingDraft(pubkey, draftScope);
    if (!saved) return false;
    const hasStrokes = Array.isArray(saved.strokes) && saved.strokes.length > 0;
    const bgData =
      typeof saved.backgroundDataUrl === 'string' && saved.backgroundDataUrl.startsWith('data:')
        ? saved.backgroundDataUrl
        : null;
    if (!hasStrokes && !bgData) return false;
    strokes = hasStrokes ? (saved.strokes as DrawStroke[]) : [];
    redoStack = [];
    if (typeof saved.paperId === 'string') paperId = saved.paperId as PaperId;
    mirror = !!saved.mirror;
    if (typeof saved.labelText === 'string') labelText = saved.labelText;
    if (typeof saved.fontId === 'string') fontId = saved.fontId as DrawFontId;
    if (typeof saved.color === 'string') color = saved.color;
    if (typeof saved.width === 'number') width = saved.width;
    if (typeof saved.tool === 'string') tool = saved.tool as DrawTool;
    if (bgData) {
      backgroundDraftDataUrl = bgData;
      backgroundName =
        typeof saved.backgroundName === 'string' && saved.backgroundName
          ? saved.backgroundName
          : 'Background';
      void loadImage(bgData)
        .then((img) => {
          if (!open) return;
          backgroundImage = img;
          queueMicrotask(() => redraw());
        })
        .catch(() => {
          backgroundDraftDataUrl = null;
        });
    }
    return true;
  }

  function readFullScreenPref(): boolean {
    if (typeof window === 'undefined') return true;
    try {
      const raw = window.sessionStorage.getItem('alexandria-draw-fullscreen');
      if (raw === '0') return false;
      if (raw === '1') return true;
    } catch {
      /* ignore */
    }
    // Prefer a large writing surface on first open (esp. tablets / phones).
    return window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
  }

  function setFullScreen(next: boolean): void {
    fullScreen = next;
    try {
      window.sessionStorage.setItem('alexandria-draw-fullscreen', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  $effect(() => {
    if (!open) {
      restoredForOpen = false;
      return;
    }
    if (restoredForOpen) return;
    restoredForOpen = true;
    step = 'draw';
    error = '';
    altText = '';
    previewUrl = null;
    previewBlob = null;
    clearBackground({ persist: false });
    const restored = restoreDrawingDraft();
    if (!restored) {
      paperId = initialPaper;
      strokes = [];
      redoStack = [];
    }
    queueMicrotask(() => redraw());
  });

  $effect(() => {
    if (!open) return;
    void strokes;
    void paperId;
    void mirror;
    void labelText;
    void fontId;
    void color;
    void width;
    void tool;
    void backgroundDraftDataUrl;
    void backgroundName;
    void draftScope;
    scheduleDrawingPersist();
    return () => {
      if (drawSaveTimer) {
        clearTimeout(drawSaveTimer);
        drawSaveTimer = null;
      }
    };
  });

  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      if (fullScreen) {
        e.preventDefault();
        setFullScreen(false);
        return;
      }
      e.preventDefault();
      closeEditor();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function redraw(): void {
    const canvas = canvasEl;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintDrawing(ctx, {
      width: W,
      height: H,
      paperId,
      strokes,
      mirror,
      backgroundImage
    });
  }

  $effect(() => {
    // Re-paint when strokes / paper / mirror / background change.
    void strokes;
    void paperId;
    void mirror;
    void backgroundImage;
    if (canvasEl) redraw();
  });

  function clearBackground(opts?: { persist?: boolean }): void {
    if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
    backgroundObjectUrl = null;
    backgroundImage = null;
    backgroundName = '';
    backgroundDraftDataUrl = null;
    if (bgFileInput) bgFileInput.value = '';
    if (opts?.persist !== false) scheduleDrawingPersist();
  }

  async function onBackgroundFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      error = 'Choose an image file (PNG, JPEG, WebP, …).';
      input.value = '';
      return;
    }
    error = '';
    const url = URL.createObjectURL(file);
    try {
      const raw = await loadImage(url);
      const prepared = await prepareBackgroundForDrawing(raw);
      if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
      if (prepared.objectUrl) {
        URL.revokeObjectURL(url);
        backgroundObjectUrl = prepared.objectUrl;
      } else {
        backgroundObjectUrl = url;
      }
      backgroundImage = prepared.image;
      backgroundName = file.name;
      const compressed = compressBackgroundForDraft(prepared.image);
      backgroundDraftDataUrl = compressed;
      if (!compressed) {
        error = 'Background is too large to autosave; drawing will still use it this session.';
      }
      scheduleDrawingPersist();
    } catch {
      URL.revokeObjectURL(url);
      error = 'Could not load that image.';
      input.value = '';
    }
  }

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = url;
    });
  }

  function canvasPoint(e: PointerEvent): { x: number; y: number; pressure: number } {
    const canvas = canvasEl!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const pressure =
      e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return { x, y, pressure };
  }

  function textSizeFromDrag(
    start: { x: number; y: number },
    end: { x: number; y: number },
    fallback: number
  ): number {
    const drag = Math.hypot(end.x - start.x, end.y - start.y);
    if (drag <= 4) return Math.max(10, Math.min(160, fallback));
    return Math.max(10, Math.min(160, Math.round(drag * 0.55)));
  }

  function selectTool(next: DrawTool): void {
    const leavingSpecial = isTextTool(tool) || tool === 'highlighter';
    const enteringText = isTextTool(next);
    const enteringHighlight = next === 'highlighter';
    if (leavingSpecial && !enteringText && !enteringHighlight) {
      width = brushWidth;
    } else if (!isTextTool(tool) && enteringText) {
      brushWidth = width;
      width = Math.max(width, DEFAULT_TEXT_SIZE);
    } else if (tool !== 'highlighter' && enteringHighlight) {
      brushWidth = width;
      width = Math.max(width, DEFAULT_HIGHLIGHTER_SIZE);
      if (color === INK_PALETTE[0] || color === '#f5f0e6') {
        color = DEFAULT_HIGHLIGHTER_COLOR;
      }
    }
    tool = next;
  }

  /** Resize the most recent label with the font-size slider. */
  function onFontSizeInput(): void {
    if (!isTextTool(tool) || drawing) return;
    const last = strokes[strokes.length - 1];
    if (!last || !isTextTool(last.tool)) return;
    strokes = [...strokes.slice(0, -1), { ...last, width }];
  }

  /** Restyle the most recent label when the font picker changes. */
  function applyFontToLastLabel(nextId: DrawFontId): void {
    fontId = nextId;
    if (!isTextTool(tool) || drawing) return;
    const last = strokes[strokes.length - 1];
    if (!last || !isTextTool(last.tool)) return;
    const font = drawFontById(nextId);
    strokes = [
      ...strokes.slice(0, -1),
      {
        ...last,
        fontFamily: font.family,
        fontStyle: font.style ?? 'normal',
        fontWeight: font.weight ?? 'normal'
      }
    ];
  }

  function onPointerDown(e: PointerEvent): void {
    if (step !== 'draw' || busy) return;
    if (penActive && e.pointerType === 'touch') return;
    if (e.pointerType === 'pen') penActive = true;
    if (isTextTool(tool) && !labelText.trim()) {
      error = 'Type a label, then drag on the canvas to place and size it.';
      return;
    }
    error = '';
    e.preventDefault();
    canvasEl?.setPointerCapture(e.pointerId);
    activePointerId = e.pointerId;
    drawing = true;
    redoStack = [];
    const pt = canvasPoint(e);
    const font = drawFontById(fontId);
    const stroke: DrawStroke = {
      tool,
      color: tool === 'eraser' ? '#000000' : color,
      width:
        tool === 'eraser'
          ? Math.max(width * 2.2, 12)
          : tool === 'highlighter'
            ? Math.max(width, 10)
            : width,
      points: isShapeTool(tool) || isTextTool(tool) ? [pt, pt] : [pt],
      seed: (Math.random() * 0xffffffff) >>> 0,
      ...(isTextTool(tool)
        ? {
            text: labelText.trim(),
            fontFamily: font.family,
            fontStyle: font.style ?? 'normal',
            fontWeight: font.weight ?? 'normal'
          }
        : {})
    };
    strokes = [...strokes, stroke];
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drawing || e.pointerId !== activePointerId) return;
    if (penActive && e.pointerType === 'touch') return;
    e.preventDefault();
    const pt = canvasPoint(e);
    const last = strokes[strokes.length - 1];
    if (!last) return;
    if (isTextTool(last.tool)) {
      const start = last.points[0] ?? pt;
      const size = textSizeFromDrag(start, pt, last.width);
      width = size;
      strokes = [
        ...strokes.slice(0, -1),
        { ...last, width: size, points: [start, pt] }
      ];
      return;
    }
    if (isShapeTool(last.tool)) {
      const start = last.points[0] ?? pt;
      strokes = [...strokes.slice(0, -1), { ...last, points: [start, pt] }];
      return;
    }
    const prev = last.points[last.points.length - 1];
    if (prev && Math.hypot(prev.x - pt.x, prev.y - pt.y) < 0.8) return;
    strokes = [
      ...strokes.slice(0, -1),
      { ...last, points: [...last.points, pt] }
    ];
  }

  function endStroke(e: PointerEvent): void {
    if (e.pointerId !== activePointerId) return;
    drawing = false;
    activePointerId = null;
    const last = strokes[strokes.length - 1];
    if (last && isTextTool(last.tool) && last.points[0]) {
      // Keep a single anchor; size lives in width.
      strokes = [
        ...strokes.slice(0, -1),
        { ...last, points: [last.points[0]] }
      ];
    }
    if (e.pointerType === 'pen') {
      // Keep palm rejection briefly after pen lift.
      setTimeout(() => {
        penActive = false;
      }, 80);
    }
  }

  function undo(): void {
    if (!strokes.length) return;
    const next = strokes.slice(0, -1);
    redoStack = [...redoStack, strokes[strokes.length - 1]!];
    strokes = next;
  }

  function redo(): void {
    if (!redoStack.length) return;
    const s = redoStack[redoStack.length - 1]!;
    redoStack = redoStack.slice(0, -1);
    strokes = [...strokes, s];
  }

  function clearAll(): void {
    strokes = [];
    redoStack = [];
  }

  async function goPreview(): Promise<void> {
    if ((!strokes.length && !backgroundImage) || busy) return;
    busy = true;
    error = '';
    try {
      const blob = await encodeDrawingGif({
        strokes,
        paperId,
        mirror,
        backgroundImage,
        quality: 'preview'
      });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewBlob = blob;
      previewUrl = URL.createObjectURL(blob);
      step = 'preview';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function addToPost(): Promise<void> {
    if (!previewBlob) return;
    const pubkey = $session.pubkey;
    if (!pubkey) {
      openLoginDialog();
      return;
    }
    busy = true;
    error = '';
    try {
      // Re-encode at upload quality (and tighten further if still large).
      const uploadBlob = await encodeDrawingGifForUpload({
        strokes,
        paperId,
        mirror,
        backgroundImage
      });
      const uploaded = await uploadDrawingGif(uploadBlob, pubkey);
      onComplete?.({
        url: uploaded.url,
        imeta: uploaded.imeta,
        alt: altText.trim() || 'Hand-drawn sketch',
        blob: uploadBlob
      });
      closeEditor({ discardDraft: true });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function closeEditor(opts?: { discardDraft?: boolean }): void {
    if (opts?.discardDraft) discardDrawingDraft();
    else persistDrawingDraft();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    previewBlob = null;
    strokes = [];
    redoStack = [];
    clearBackground({ persist: false });
    step = 'draw';
    open = false;
    onCancel?.();
  }
</script>

{#if open}
  <div
    class="draw-overlay"
    class:full={fullScreen}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div class="draw-sheet" class:full={fullScreen}>
      <header class="draw-head">
        <h2>{title}</h2>
        <div class="draw-head-actions">
          <button
            class="btn"
            type="button"
            aria-pressed={fullScreen}
            disabled={busy}
            onclick={() => setFullScreen(!fullScreen)}
            >{fullScreen ? 'Exit full screen' : 'Full screen'}</button
          >
          <button class="btn" type="button" onclick={() => closeEditor()} disabled={busy}>Close</button>
        </div>
      </header>

      {#if step === 'draw'}
        <div class="draw-tools" role="toolbar" aria-label="Drawing tools">
          <div class="tool-group" aria-label="Freehand">
            {#each FREEHAND_TOOLS as t}
              <button
                type="button"
                class="tool"
                class:active={tool === t}
                onclick={() => selectTool(t)}>{t}</button
              >
            {/each}
          </div>
          <div class="tool-group" aria-label="Shapes">
            {#each SHAPE_TOOLS as t}
              <button
                type="button"
                class="tool"
                class:active={tool === t}
                onclick={() => selectTool(t)}>{t}</button
              >
            {/each}
          </div>
          <div class="tool-group" aria-label="Label">
            {#each LABEL_TOOLS as t}
              <button
                type="button"
                class="tool"
                class:active={tool === t}
                onclick={() => selectTool(t)}>{t}</button
              >
            {/each}
          </div>
          <div class="tool-group inks" aria-label="Ink colors">
            {#each INK_PALETTE as ink}
              <button
                type="button"
                class="ink"
                class:active={color === ink}
                style:background={ink}
                aria-label={`Ink ${ink}`}
                onclick={() => (color = ink)}
              ></button>
            {/each}
          </div>
          <label class="size">
            {isTextTool(tool) ? 'Font size' : 'Size'}
            {#if isTextTool(tool)}
              <input
                type="range"
                min="10"
                max="120"
                bind:value={width}
                oninput={onFontSizeInput}
              />
              <span class="size-val muted">{Math.round(width)}</span>
            {:else}
              <input type="range" min="1" max="28" bind:value={width} />
            {/if}
          </label>
          <label class="mirror">
            <input type="checkbox" bind:checked={mirror} />
            Mirror
          </label>
        </div>

        {#if isTextTool(tool)}
          <div class="text-row">
            <label class="text-label">
              Label
              <input
                type="text"
                bind:value={labelText}
                placeholder="Type text, then drag to place…"
                disabled={busy}
              />
            </label>
            <div class="font-label">
              <span>Font</span>
              <div class="font-picker" role="listbox" aria-label="Label font">
                {#each DRAW_FONTS as f (f.id)}
                  <button
                    type="button"
                    class="font-choice"
                    class:active={fontId === f.id}
                    role="option"
                    aria-selected={fontId === f.id}
                    disabled={busy}
                    style:font-family={f.family}
                    style:font-style={f.style ?? 'normal'}
                    style:font-weight={String(f.weight ?? 'normal')}
                    onclick={() => applyFontToLastLabel(f.id)}
                    >{f.label}</button
                  >
                {/each}
              </div>
            </div>
            <p class="text-hint muted">
              Drag on the canvas to place the label and set its size.
            </p>
          </div>
        {/if}

        <div class="papers" role="listbox" aria-label="Paper">
          {#each PAPERS as p}
            <button
              type="button"
              class="paper"
              class:active={paperId === p.id && !backgroundImage}
              style:background={p.background}
              style:color={p.defaultInk}
              onclick={() => {
                paperId = p.id;
                color = p.defaultInk;
                clearBackground();
              }}>{p.label}</button
            >
          {/each}
        </div>

        <div class="bg-row">
          <input
            bind:this={bgFileInput}
            class="bg-file"
            type="file"
            accept="image/*"
            disabled={busy}
            onchange={(e) => void onBackgroundFile(e)}
          />
          <button
            class="btn"
            type="button"
            disabled={busy}
            onclick={() => bgFileInput?.click()}
            >{backgroundImage ? 'Change background…' : 'Background image…'}</button
          >
          {#if backgroundImage}
            <span class="bg-name muted" title={backgroundName}>{backgroundName || 'Image'}</span>
            <button class="btn" type="button" disabled={busy} onclick={() => clearBackground()}
              >Clear background</button
            >
          {/if}
        </div>

        <div class="canvas-wrap">
          <canvas
            bind:this={canvasEl}
            class="draw-canvas"
            width={W}
            height={H}
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={endStroke}
            onpointercancel={endStroke}
          ></canvas>
        </div>

        <div class="draw-actions">
          <button class="btn" type="button" onclick={undo} disabled={!strokes.length || busy}
            >Undo</button
          >
          <button class="btn" type="button" onclick={redo} disabled={!redoStack.length || busy}
            >Redo</button
          >
          <button class="btn" type="button" onclick={clearAll} disabled={!strokes.length || busy}
            >Clear</button
          >
          <button
            class="btn btn-primary"
            type="button"
            onclick={() => void goPreview()}
            disabled={(!strokes.length && !backgroundImage) || busy}
            >{busy ? 'Encoding…' : 'Preview GIF'}</button
          >
        </div>
      {:else}
        <div class="preview-pane">
          {#if previewUrl}
            <img src={previewUrl} alt="" class="preview-gif" />
          {/if}
          <label class="alt">
            Alt text
            <input type="text" bind:value={altText} placeholder="Hand-drawn sketch" disabled={busy} />
          </label>
          <div class="draw-actions">
            <button class="btn" type="button" onclick={() => (step = 'draw')} disabled={busy}
              >Back</button
            >
            <button
              class="btn btn-primary"
              type="button"
              onclick={() => void addToPost()}
              disabled={busy || !previewBlob}
              >{busy ? 'Uploading…' : 'Add to post'}</button
            >
          </div>
        </div>
      {/if}

      {#if error}
        <p class="draw-error" role="alert">{error}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .draw-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: grid;
    place-items: center;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--ink) 55%, transparent);
  }
  .draw-overlay.full {
    padding: 0;
    place-items: stretch;
  }
  .draw-sheet {
    width: min(36rem, 100%);
    max-height: min(96vh, 56rem);
    overflow: auto;
    background: var(--surface, var(--paper-light, var(--paper)));
    color: var(--text, var(--ink));
    border: 1px solid var(--border, var(--rule));
    border-radius: 0.55rem;
    padding: 0.85rem 1rem 1.1rem;
    box-shadow: var(--shadow-soft, 0 0.6rem 2rem rgb(0 0 0 / 28%));
  }
  .draw-sheet.full {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0.65rem 0.85rem 0.85rem;
  }
  .draw-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.65rem;
    flex-shrink: 0;
  }
  .draw-head-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    justify-content: flex-end;
  }
  .draw-head h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text, var(--ink));
  }
  .draw-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem 0.85rem;
    align-items: center;
    margin-bottom: 0.55rem;
    flex-shrink: 0;
  }
  .tool-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .tool {
    border: 1px solid color-mix(in srgb, var(--border, var(--rule)) 80%, var(--accent));
    background: color-mix(in srgb, var(--surface-2, var(--paper-dark)) 40%, var(--surface, var(--paper-light)));
    color: var(--text, var(--ink));
    border-radius: 0.35rem;
    padding: 0.25rem 0.55rem;
    text-transform: capitalize;
    cursor: pointer;
    font: inherit;
  }
  .tool:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border, var(--rule)));
    background: color-mix(in srgb, var(--accent) 10%, var(--surface, var(--paper-light)));
  }
  .tool.active {
    background: color-mix(in srgb, var(--accent) 22%, var(--surface, var(--paper-light)));
    border-color: var(--accent);
    color: var(--text, var(--ink));
    font-weight: 600;
  }
  .ink {
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 999px;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .ink.active {
    border-color: var(--text, var(--ink));
    outline: 1px solid color-mix(in srgb, var(--surface, var(--paper)) 70%, transparent);
  }
  .size,
  .mirror,
  .alt {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--text, var(--ink));
  }
  .alt {
    flex-direction: column;
    align-items: stretch;
    margin: 0.75rem 0;
  }
  .alt input {
    font: inherit;
    color: var(--text, var(--ink));
    background: var(--surface-2, var(--paper-dark));
    border: 1px solid var(--border, var(--rule));
    border-radius: 0.35rem;
    padding: 0.35rem 0.5rem;
  }
  .papers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.45rem;
    flex-shrink: 0;
  }
  .bg-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.55rem;
    flex-shrink: 0;
  }
  .bg-file {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .bg-name {
    font-size: 0.8rem;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size-val {
    min-width: 1.75rem;
    font-size: 0.8rem;
  }
  .text-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.55rem 0.75rem;
    margin-bottom: 0.55rem;
    flex-shrink: 0;
  }
  .text-label,
  .font-label {
    display: grid;
    gap: 0.2rem;
    font-size: 0.82rem;
    color: var(--text, var(--ink));
  }
  .text-label {
    flex: 1 1 12rem;
  }
  .font-label {
    flex: 1 1 100%;
  }
  .text-label input {
    font: inherit;
    color: var(--text, var(--ink));
    background: var(--surface-2, var(--paper-dark));
    border: 1px solid var(--border, var(--rule));
    border-radius: 0.35rem;
    padding: 0.35rem 0.5rem;
  }
  .font-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .font-choice {
    border: 1px solid color-mix(in srgb, var(--border, var(--rule)) 80%, var(--accent));
    background: var(--surface-2, var(--paper-dark));
    color: var(--text, var(--ink));
    border-radius: 0.35rem;
    padding: 0.3rem 0.55rem;
    font-size: 0.95rem;
    line-height: 1.2;
    cursor: pointer;
  }
  .font-choice:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border, var(--rule)));
  }
  .font-choice.active {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--surface, var(--paper-light)));
  }
  .text-hint {
    flex: 1 1 100%;
    margin: 0;
    font-size: 0.78rem;
  }
  .paper {
    border: 1px solid color-mix(in srgb, var(--border, var(--rule)) 70%, transparent);
    border-radius: 0.35rem;
    padding: 0.3rem 0.55rem;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    /* color set inline from each paper's defaultInk for contrast on swatch bg */
  }
  .paper.active {
    box-shadow:
      inset 0 0 0 2px var(--accent),
      0 0 0 1px color-mix(in srgb, var(--text, var(--ink)) 35%, transparent);
  }
  .canvas-wrap {
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--surface-2, var(--paper-dark)) 70%, transparent);
    border: 1px solid color-mix(in srgb, var(--border, var(--rule)) 55%, transparent);
    border-radius: 0.4rem;
    padding: 0.4rem;
    touch-action: none;
  }
  .draw-sheet.full .canvas-wrap {
    flex: 1 1 auto;
    min-height: 0;
    align-content: center;
  }
  .draw-canvas {
    width: min(100%, 22rem);
    height: auto;
    aspect-ratio: 540 / 675;
    border-radius: 0.25rem;
    cursor: crosshair;
    touch-action: none;
    box-shadow: 0 0.15rem 0.5rem rgb(0 0 0 / 12%);
  }
  .draw-sheet.full .draw-canvas {
    /* Grow within the flex area while keeping the bitmap aspect ratio. */
    width: min(100%, calc((100dvh - 12.5rem) * 540 / 675));
    height: auto;
    max-width: 100%;
    max-height: calc(100dvh - 12.5rem);
  }
  .draw-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.7rem;
    flex-shrink: 0;
  }
  .preview-pane {
    display: grid;
    gap: 0.4rem;
    justify-items: center;
  }
  .draw-sheet.full .preview-pane {
    flex: 1 1 auto;
    min-height: 0;
    align-content: center;
  }
  .preview-gif {
    max-width: min(100%, 22rem);
    border-radius: 0.3rem;
    box-shadow: 0 0.15rem 0.5rem rgb(0 0 0 / 12%);
  }
  .draw-sheet.full .preview-gif {
    max-width: min(100%, 36rem);
    max-height: calc(100dvh - 12rem);
  }
  .draw-error {
    color: color-mix(in srgb, #c44 55%, var(--text, var(--ink)));
    margin: 0.6rem 0 0;
    font-size: 0.9rem;
  }
</style>
