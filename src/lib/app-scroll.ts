/** The main panel that scrolls between the fixed header and footer. */
let scrollRoot: HTMLElement | null = null;

/** Distances from the viewport edges to the app-scroll panel (CSS px). */
export function syncAppScrollInsets(el: HTMLElement | null = scrollRoot): void {
  const root = document.documentElement;
  if (!el) {
    root.style.removeProperty('--app-scroll-top');
    root.style.removeProperty('--app-scroll-bottom');
    return;
  }
  const r = el.getBoundingClientRect();
  root.style.setProperty('--app-scroll-top', `${Math.max(0, Math.round(r.top))}px`);
  root.style.setProperty(
    '--app-scroll-bottom',
    `${Math.max(0, Math.round(window.innerHeight - r.bottom))}px`
  );
}

/**
 * Keep `--app-scroll-top` / `--app-scroll-bottom` in sync so fixed chrome
 * (ToC FAB/panel, toasts) stays inside the center scroll band.
 */
export function observeAppScrollInsets(el: HTMLElement): () => void {
  const sync = () => syncAppScrollInsets(el);
  sync();
  const ro = new ResizeObserver(sync);
  ro.observe(el);
  window.addEventListener('resize', sync);
  // Top bar conceal toggles a root class and reflows the flex column.
  const mo = new MutationObserver(sync);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => {
    ro.disconnect();
    mo.disconnect();
    window.removeEventListener('resize', sync);
    syncAppScrollInsets(null);
  };
}

export function setAppScrollRoot(el: HTMLElement | null): void {
  scrollRoot = el;
}

export function getAppScrollRoot(): HTMLElement | null {
  return scrollRoot;
}

export function appScrollY(): number {
  return scrollRoot ? scrollRoot.scrollTop : window.scrollY;
}

export function appScrollHeight(): number {
  return scrollRoot ? scrollRoot.scrollHeight : document.documentElement.scrollHeight;
}

export function appClientHeight(): number {
  return scrollRoot ? scrollRoot.clientHeight : window.innerHeight;
}

export function appScrollTo(options: ScrollToOptions): void {
  if (scrollRoot) scrollRoot.scrollTo(options);
  else window.scrollTo(options);
}

export function appScrollBy(x: number, y: number): void {
  if (scrollRoot) scrollRoot.scrollBy(x, y);
  else window.scrollBy(x, y);
}

/** Content Y of `el` within the app scrollport (for scrollTo targeting). */
export function appOffsetTop(el: Element): number {
  if (!scrollRoot) {
    return el.getBoundingClientRect().top + window.scrollY;
  }
  const rootRect = scrollRoot.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return elRect.top - rootRect.top + scrollRoot.scrollTop;
}

export function onAppScroll(
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean
): () => void {
  const target: EventTarget = scrollRoot ?? window;
  target.addEventListener('scroll', handler, options);
  return () => target.removeEventListener('scroll', handler, options);
}
