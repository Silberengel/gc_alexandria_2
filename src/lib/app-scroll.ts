/** The main panel that scrolls between the fixed header and footer. */
let scrollRoot: HTMLElement | null = null;

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
