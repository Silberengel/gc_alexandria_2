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
    encodeDrawingPng,
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
  import { uploadDrawingImage } from '$lib/drawing/upload';
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
  /** Null = no font chosen (Clear / before first pick). */
  let fontId = $state<DrawFontId | null>(null);
  /** Remember brush size when switching to/from text. */
  let brushWidth = 5;
  let paperId = $state<PaperId>('parchment');
  let mirror = $state(false);
  let strokes = $state<DrawStroke[]>([]);
  let redoStack = $state<DrawStroke[]>([]);
  let drawing = $state(false);
  let activePointerId = $state<number | null>(null);
  /** True after a stylus tip has contacted this board — finger/palm must not ink. */
  let stylusSeen = false;
  /** Stylus tip is currently down on the canvas. */
  let penContact = false;
  /** Ignore touch/mouse briefly after pen lift (palm often lands on lift). */
  let palmGuardUntil = 0;
  let busy = $state(false);
  let error = $state('');
  let altText = $state('');
  let step = $state<'draw' | 'preview'>('draw');
  let previewUrl = $state<string | null>(null);
  let previewBlob = $state<Blob | null>(null);
  /** Static PNG by default; GIF keeps the stroke-replay animation. */
  let exportFormat = $state<'png' | 'gif'>('png');
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
      fontId: fontId ?? '',
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
    if (typeof saved.fontId === 'string' && saved.fontId) {
      fontId = saved.fontId as DrawFontId;
    } else if (saved.fontId === '') {
      fontId = null;
    }
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
      stylusSeen = false;
      penContact = false;
      palmGuardUntil = 0;
      return;
    }
    if (restoredForOpen) return;
    restoredForOpen = true;
    step = 'draw';
    error = '';
    altText = '';
    previewUrl = null;
    previewBlob = null;
    stylusSeen = false;
    penContact = false;
    palmGuardUntil = 0;
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

  /**
   * Full-screen draw on tablets: pinching / double-tap / focus-zoom was scaling the
   * page under the overlay and trapping the viewport on a corner. Lock scale while
   * maximized; restore the original meta on exit.
   */
  $effect(() => {
    if (!open || !fullScreen || typeof document === 'undefined') return;
    const meta = document.querySelector('meta[name="viewport"]');
    const prevContent = meta?.getAttribute('content') ?? '';
    meta?.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    );

    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyTouch = body.style.touchAction;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';

    const blockPinch = (e: TouchEvent): void => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const blockGesture = (e: Event): void => {
      e.preventDefault();
    };
    // Non-passive so preventDefault actually stops Safari/Chrome pinch-zoom.
    document.addEventListener('touchmove', blockPinch, { passive: false });
    document.addEventListener('gesturestart', blockGesture, { passive: false });
    document.addEventListener('gesturechange', blockGesture, { passive: false });
    document.addEventListener('gestureend', blockGesture, { passive: false });

    // Snap back if the page was already zoomed before entering full screen.
    window.scrollTo(0, 0);

    return () => {
      if (meta) {
        meta.setAttribute(
          'content',
          prevContent || 'width=device-width, initial-scale=1.0'
        );
      }
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.touchAction = prevBodyTouch;
      document.removeEventListener('touchmove', blockPinch);
      document.removeEventListener('gesturestart', blockGesture);
      document.removeEventListener('gesturechange', blockGesture);
      document.removeEventListener('gestureend', blockGesture);
    };
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

  function onFontSelect(e: Event): void {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (!v) {
      fontId = null;
      return;
    }
    applyFontToLastLabel(v as DrawFontId);
  }

  const selectedFont = $derived(fontId ? drawFontById(fontId) : null);

  function clearLabel(): void {
    labelText = '';
    fontId = null;
    error = '';
  }

  /** Palm / resting hand must not leave dots while a stylus is in use. */
  function shouldIgnorePointer(e: PointerEvent): boolean {
    if (e.pointerType === 'pen') return false;
    if (e.pointerType === 'touch') {
      if (stylusSeen || penContact || Date.now() < palmGuardUntil) return true;
      // Fat contact before any stylus tip ≈ palm or wrist.
      if (e.width >= 22 || e.height >= 22) return true;
    }
    // Some drivers report palm as mouse while the pen is in range or just lifted.
    if (e.pointerType === 'mouse' && (penContact || Date.now() < palmGuardUntil)) {
      return true;
    }
    return false;
  }

  function dropForeignStroke(incomingId: number): void {
    if (!drawing || activePointerId === null || activePointerId === incomingId) return;
    const priorId = activePointerId;
    strokes = strokes.slice(0, -1);
    drawing = false;
    activePointerId = null;
    try {
      canvasEl?.releasePointerCapture(priorId);
    } catch {
      /* already released */
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (step !== 'draw' || busy) return;
    if (shouldIgnorePointer(e)) {
      e.preventDefault();
      return;
    }
    if (e.pointerType === 'pen') {
      stylusSeen = true;
      penContact = true;
      palmGuardUntil = 0;
      // Stylus wins over an in-progress palm/finger smear.
      dropForeignStroke(e.pointerId);
    }
    if (isTextTool(tool) && !labelText.trim()) {
      error = 'Type a label, then drag on the canvas to place and size it.';
      return;
    }
    if (isTextTool(tool) && !fontId) {
      error = 'Pick a font, then drag on the canvas to place the label.';
      return;
    }
    error = '';
    e.preventDefault();
    canvasEl?.setPointerCapture(e.pointerId);
    activePointerId = e.pointerId;
    drawing = true;
    redoStack = [];
    const pt = canvasPoint(e);
    const font = drawFontById(fontId ?? 'sans');
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
    if (shouldIgnorePointer(e)) return;
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
      penContact = false;
      // Palm often settles as the tip lifts — keep rejecting touch for a beat.
      palmGuardUntil = Date.now() + 700;
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
      // Clear paper needs alpha — GIF is opaque-only here.
      const format = paperId === 'transparent' ? 'png' : exportFormat;
      if (format === 'png' && exportFormat !== 'png') exportFormat = 'png';
      const blob =
        format === 'png'
          ? await encodeDrawingPng({
              strokes,
              paperId,
              mirror,
              backgroundImage
            })
          : await encodeDrawingGif({
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
      const format = paperId === 'transparent' ? 'png' : exportFormat;
      const uploadBlob =
        format === 'png'
          ? await encodeDrawingPng({
              strokes,
              paperId,
              mirror,
              backgroundImage
            })
          : await encodeDrawingGifForUpload({
              strokes,
              paperId,
              mirror,
              backgroundImage
            });
      const mime = format === 'png' ? 'image/png' : 'image/gif';
      const uploaded = await uploadDrawingImage(uploadBlob, pubkey, mime);
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

      <div class="draw-body">
      {#if step === 'draw'}
        <div class="draw-layout">
          <aside class="draw-chrome">
            <section class="chrome-section" aria-label="Tools">
              <h3 class="chrome-heading">Tools</h3>
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
                <div class="tool-group" aria-label="Label tool">
                  {#each LABEL_TOOLS as t}
                    <button
                      type="button"
                      class="tool"
                      class:active={tool === t}
                      onclick={() => selectTool(t)}>{t}</button
                    >
                  {/each}
                </div>
              </div>
            </section>

            <section class="chrome-section" aria-label="Stroke">
              <h3 class="chrome-heading">Stroke</h3>
              <div class="stroke-row">
                <div class="tool-group inks" role="group" aria-label="Ink colors">
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
                  {isTextTool(tool) ? 'Font size' : 'Tip'}
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
                    <input type="range" min="0.25" max="28" step="0.25" bind:value={width} />
                    <span class="size-val muted"
                      >{width < 1 ? width.toFixed(2) : Number.isInteger(width) ? width : width.toFixed(1)}</span
                    >
                  {/if}
                </label>
                <label class="mirror">
                  <input type="checkbox" bind:checked={mirror} />
                  Mirror
                </label>
              </div>
            </section>

            {#if isTextTool(tool)}
              <section class="chrome-section text-row" aria-label="Label">
                <h3 class="chrome-heading">Label</h3>
                <div class="text-label">
                  <span class="field-label">Text</span>
                  <div class="text-input-row">
                    <input
                      type="text"
                      bind:value={labelText}
                      placeholder="Type text, then drag to place…"
                      disabled={busy}
                      aria-label="Label text"
                    />
                    <button
                      class="btn text-clear"
                      type="button"
                      disabled={busy || (!labelText && !fontId)}
                      onclick={clearLabel}
                      title="Clear label and font"
                      aria-label="Clear label and font"
                      >Clear</button
                    >
                  </div>
                </div>
                <label class="font-label">
                  <span class="field-label">Font</span>
                  <select
                    class="font-select"
                    disabled={busy}
                    value={fontId ?? ''}
                    aria-label="Label font"
                    style:font-family={selectedFont?.family}
                    style:font-style={selectedFont?.style ?? 'normal'}
                    style:font-weight={String(selectedFont?.weight ?? 'normal')}
                    onchange={onFontSelect}
                  >
                    <option value="">Choose font…</option>
                    {#each DRAW_FONTS as f (f.id)}
                      <option
                        value={f.id}
                        style:font-family={f.family}
                        style:font-style={f.style ?? 'normal'}
                        style:font-weight={String(f.weight ?? 'normal')}
                        >{f.label}</option
                      >
                    {/each}
                  </select>
                </label>
                <p class="text-hint muted">
                  Type a label, pick a font, then drag on the canvas to place and size it.
                </p>
              </section>
            {/if}

            <section class="chrome-section" aria-label="Surface">
              <h3 class="chrome-heading">Surface</h3>
              <div class="papers" role="listbox" aria-label="Paper">
                {#each PAPERS as p}
                  <button
                    type="button"
                    class="paper"
                    class:paper-clear={p.id === 'transparent'}
                    class:active={paperId === p.id && !backgroundImage}
                    style:background={p.id === 'transparent' ? undefined : p.background}
                    style:color={p.defaultInk}
                    onclick={() => {
                      paperId = p.id;
                      color = p.defaultInk;
                      clearBackground();
                      // GIF has no useful alpha — keep Clear exports as PNG.
                      if (p.id === 'transparent') exportFormat = 'png';
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
            </section>
          </aside>

          <div class="draw-stage">
            <div class="canvas-wrap" class:checker={paperId === 'transparent' && !backgroundImage}>
              <canvas
                bind:this={canvasEl}
                class="draw-canvas"
                class:on-clear={paperId === 'transparent' && !backgroundImage}
                width={W}
                height={H}
                onpointerdown={onPointerDown}
                onpointermove={onPointerMove}
                onpointerup={endStroke}
                onpointercancel={endStroke}
              ></canvas>
            </div>
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
            <div class="export-format" role="group" aria-label="Export format">
              <button
                type="button"
                class="tool"
                class:active={exportFormat === 'png' || paperId === 'transparent'}
                disabled={busy}
                onclick={() => (exportFormat = 'png')}>PNG</button
              >
              <button
                type="button"
                class="tool"
                class:active={exportFormat === 'gif' && paperId !== 'transparent'}
                disabled={busy || paperId === 'transparent'}
                title={paperId === 'transparent' ? 'Clear paper exports as PNG (keeps transparency)' : undefined}
                onclick={() => (exportFormat = 'gif')}>GIF</button
              >
            </div>
            <button
              class="btn btn-primary"
              type="button"
              onclick={() => void goPreview()}
              disabled={(!strokes.length && !backgroundImage) || busy}
              >{busy ? 'Encoding…' : exportFormat === 'png' ? 'Preview PNG' : 'Preview GIF'}</button
            >
          </div>
        </div>
      {:else}
        <div class="preview-pane">
          {#if previewUrl}
            <img src={previewUrl} alt="" class="preview-gif" />
          {/if}
          <p class="export-format-hint muted">
            {exportFormat === 'png' ? 'Static PNG' : 'Animated GIF'}
          </p>
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
    /* Kill double-tap zoom even in the windowed sheet. */
    touch-action: manipulation;
  }
  .draw-overlay.full {
    padding: 0;
    place-items: stretch;
    /* Full-screen board: no pan/zoom gestures through to the page. */
    touch-action: none;
    overscroll-behavior: none;
  }
  .draw-sheet {
    width: min(40rem, 100%);
    max-height: min(96dvh, 58rem);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface, var(--paper-light, var(--paper)));
    color: var(--text, var(--ink));
    border: 1px solid var(--border, var(--rule));
    border-radius: 0.55rem;
    padding: 0.65rem 0.75rem 0.75rem;
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
    padding: 0.4rem 0.5rem 0.4rem;
    touch-action: none;
    overscroll-behavior: none;
  }
  .draw-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .draw-sheet.full .draw-body {
    overscroll-behavior: none;
  }
  /* Tool rail may still scroll vertically; canvas keeps touch-action: none. */
  .draw-sheet.full .draw-chrome {
    touch-action: pan-y;
  }
  .draw-sheet.full .draw-actions {
    touch-action: manipulation;
  }
  .draw-layout {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    gap: 0.35rem;
  }
  .draw-chrome {
    grid-row: 1;
    min-width: 0;
  }
  .draw-stage {
    grid-row: 2;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .draw-layout > .draw-actions {
    grid-row: 3;
  }
  .draw-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
    flex-shrink: 0;
  }
  .draw-head-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    justify-content: flex-end;
  }
  .draw-head h2 {
    margin: 0;
    font-size: 1rem;
    color: var(--text, var(--ink));
  }
  .draw-sheet.full .draw-head h2 {
    font-size: 0.95rem;
  }
  .chrome-section {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.45rem;
  }
  .chrome-section:last-child {
    margin-bottom: 0;
  }
  .chrome-heading {
    margin: 0;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--text, var(--ink)) 62%, transparent);
  }
  .draw-tools,
  .stroke-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.5rem;
    align-items: center;
    flex-shrink: 0;
  }
  .tool-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
  }
  .field-label {
    font-size: 0.7rem;
    color: var(--text, var(--ink));
  }
  .tool {
    border: 1px solid color-mix(in srgb, var(--border, var(--rule)) 80%, var(--accent));
    background: color-mix(in srgb, var(--surface-2, var(--paper-dark)) 40%, var(--surface, var(--paper-light)));
    color: var(--text, var(--ink));
    border-radius: 0.3rem;
    padding: 0.12rem 0.38rem;
    text-transform: capitalize;
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    line-height: 1.25;
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
    width: 1.05rem;
    height: 1.05rem;
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
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--text, var(--ink));
  }
  .size input[type='range'] {
    width: 5.5rem;
    max-width: 100%;
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
    gap: 0.22rem;
    flex-shrink: 0;
  }
  .bg-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }
  .bg-row .btn,
  .draw-chrome .btn {
    font-size: 0.72rem;
    padding: 0.2rem 0.45rem;
  }
  .bg-file {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .bg-name {
    font-size: 0.72rem;
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size-val {
    min-width: 1.5rem;
    font-size: 0.72rem;
  }
  .text-row {
    flex-shrink: 0;
  }
  .text-label,
  .font-label {
    display: grid;
    gap: 0.15rem;
    font-size: 0.72rem;
    color: var(--text, var(--ink));
  }
  .text-label {
    min-width: 0;
  }
  .text-input-row {
    display: flex;
    align-items: stretch;
    gap: 0.3rem;
  }
  .text-input-row input {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.8rem;
    padding: 0.25rem 0.4rem;
  }
  .text-clear {
    flex-shrink: 0;
    white-space: nowrap;
  }
  .font-label {
    min-width: 0;
  }
  .text-label input,
  .font-select {
    font: inherit;
    color: var(--text, var(--ink));
    background: var(--surface-2, var(--paper-dark));
    border: 1px solid var(--border, var(--rule));
    border-radius: 0.3rem;
    padding: 0.25rem 0.4rem;
  }
  .font-select {
    width: 100%;
    max-width: 16rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .font-select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .text-hint {
    margin: 0;
    font-size: 0.7rem;
  }
  .paper {
    border: 1px solid color-mix(in srgb, var(--border, var(--rule)) 70%, transparent);
    border-radius: 0.3rem;
    padding: 0.15rem 0.38rem;
    font-size: 0.68rem;
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
  .paper-clear {
    background-color: #ddd;
    background-image:
      linear-gradient(45deg, #bbb 25%, transparent 25%),
      linear-gradient(-45deg, #bbb 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #bbb 75%),
      linear-gradient(-45deg, transparent 75%, #bbb 75%);
    background-size: 0.55rem 0.55rem;
    background-position:
      0 0,
      0 0.275rem,
      0.275rem -0.275rem,
      -0.275rem 0;
  }
  .canvas-wrap {
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--surface-2, var(--paper-dark)) 70%, transparent);
    border: 1px solid color-mix(in srgb, var(--border, var(--rule)) 55%, transparent);
    border-radius: 0.35rem;
    padding: 0.25rem;
    touch-action: none;
    min-height: 0;
    flex: 1 1 auto;
  }
  .canvas-wrap.checker {
    background-color: #c8c4bc;
    background-image:
      linear-gradient(45deg, #b0aca4 25%, transparent 25%),
      linear-gradient(-45deg, #b0aca4 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #b0aca4 75%),
      linear-gradient(-45deg, transparent 75%, #b0aca4 75%);
    background-size: 0.75rem 0.75rem;
    background-position:
      0 0,
      0 0.375rem,
      0.375rem -0.375rem,
      -0.375rem 0;
  }
  .draw-canvas {
    /* Cap by width and height so short viewports shrink the board, not clip chrome. */
    width: min(100%, 26rem, calc(min(58dvh, 40rem) * 540 / 675));
    height: auto;
    aspect-ratio: 540 / 675;
    border-radius: 0.25rem;
    cursor: crosshair;
    touch-action: none;
    box-shadow: 0 0.15rem 0.5rem rgb(0 0 0 / 12%);
  }
  .draw-canvas.on-clear {
    background: transparent;
    box-shadow: none;
  }
  .draw-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0;
    padding: 0.35rem 0 0;
    flex-shrink: 0;
    background: var(--surface, var(--paper-light, var(--paper)));
    align-items: center;
  }
  .draw-actions .btn {
    font-size: 0.78rem;
    padding: 0.28rem 0.55rem;
  }
  .export-format {
    display: inline-flex;
    gap: 0.2rem;
    margin-left: auto;
  }
  .export-format-hint {
    margin: 0;
    font-size: 0.75rem;
  }
  .preview-pane {
    display: grid;
    gap: 0.4rem;
    justify-items: center;
  }
  .preview-gif {
    max-width: min(100%, 26rem);
    max-height: min(58dvh, 40rem);
    border-radius: 0.3rem;
    box-shadow: 0 0.15rem 0.5rem rgb(0 0 0 / 12%);
  }
  /* Full-screen: fill remaining height; footer stays at the bottom of the sheet. */
  .draw-sheet.full .draw-body {
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .draw-sheet.full .draw-layout {
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
  }
  .draw-sheet.full .draw-chrome {
    max-height: min(30dvh, 12rem);
    overflow: auto;
    overscroll-behavior: contain;
  }
  .draw-sheet.full .canvas-wrap {
    height: 100%;
    container-type: size;
  }
  .draw-sheet.full .draw-canvas {
    width: min(100cqw, calc(100cqh * 540 / 675));
    max-height: 100cqh;
  }
  .draw-sheet.full .draw-actions {
    position: sticky;
    bottom: 0;
    z-index: 1;
    padding: 0.3rem 0 0.05rem;
    box-shadow: 0 -0.4rem 0.6rem var(--surface, var(--paper-light, var(--paper)));
  }
  .draw-sheet.full .preview-gif {
    max-width: min(100%, 48rem);
    max-height: min(82dvh, 56rem);
  }
  /* Wide full-screen: compact left rail, paper takes the rest. */
  @media (min-width: 900px) {
    .draw-sheet.full .draw-layout {
      grid-template-columns: minmax(10rem, 12rem) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 0.4rem 0.65rem;
    }
    .draw-sheet.full .draw-chrome {
      grid-row: 1 / -1;
      grid-column: 1;
      max-height: none;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      padding-right: 0.15rem;
    }
    .draw-sheet.full .chrome-section {
      margin-bottom: 0;
    }
    .draw-sheet.full .draw-stage {
      grid-row: 1;
      grid-column: 2;
    }
    .draw-sheet.full .draw-layout > .draw-actions {
      grid-row: 2;
      grid-column: 2;
      position: static;
      box-shadow: none;
    }
    .draw-sheet.full .draw-tools,
    .draw-sheet.full .stroke-row {
      flex-direction: column;
      align-items: stretch;
      gap: 0.3rem;
    }
    .draw-sheet.full .size {
      flex-wrap: wrap;
    }
    .draw-sheet.full .size input[type='range'] {
      flex: 1 1 100%;
      width: 100%;
    }
    .draw-sheet.full .font-select {
      max-width: none;
    }
  }
  .draw-error {
    color: color-mix(in srgb, #c44 55%, var(--text, var(--ink)));
    margin: 0.6rem 0 0;
    font-size: 0.9rem;
  }
</style>
