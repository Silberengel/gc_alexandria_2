import type { Event } from 'nostr-tools';

export function matchesPageFilter(event: Event, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  const tags = event.tags.map((t) => t.slice(1).join(' ')).join('\n');
  return `${event.content}\n${tags}`.toLowerCase().includes(q);
}

export function filterPageEvents(events: Event[], filter: string): Event[] {
  if (!filter.trim()) return events;
  return events.filter((e) => matchesPageFilter(e, filter));
}

const HIT_CLASS = 'page-filter-hit';

export function clearFilterMarks(root: ParentNode): void {
  for (const mark of [...root.querySelectorAll(`mark.${HIT_CLASS}`)]) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  }
}

/** Wrap visible matches in the rendered article. Returns the first mark. */
export function applyPageFind(root: HTMLElement, query: string): HTMLElement | null {
  clearFilterMarks(root);
  const q = query.trim();
  if (q.length < 2 || typeof document === 'undefined') return null;
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('textarea, input, script, style, .toc, .page-filter, .loading-hint')) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!node.textContent) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);

  let first: HTMLElement | null = null;
  for (const textNode of nodes) {
    const text = textNode.textContent ?? '';
    const lower = text.toLowerCase();
    let idx = lower.indexOf(needle);
    if (idx < 0) continue;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    while (idx >= 0) {
      if (idx > cursor) frag.append(text.slice(cursor, idx));
      const mark = document.createElement('mark');
      mark.className = HIT_CLASS;
      mark.textContent = text.slice(idx, idx + q.length);
      if (!first) first = mark;
      frag.append(mark);
      cursor = idx + q.length;
      idx = lower.indexOf(needle, cursor);
    }
    if (cursor < text.length) frag.append(text.slice(cursor));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return first;
}

export function nextFilterHit(root: HTMLElement, from: Element | null): HTMLElement | null {
  const hits = [...root.querySelectorAll<HTMLElement>(`mark.${HIT_CLASS}`)];
  if (!hits.length) return null;
  if (!from) return hits[0] ?? null;
  const i = hits.indexOf(from as HTMLElement);
  return hits[(i + 1) % hits.length] ?? hits[0] ?? null;
}

export function createPageFindController(): {
  observe: (root: HTMLElement, query: string) => () => void;
  next: (root: HTMLElement) => HTMLElement | null;
} {
  let hit: HTMLElement | null = null;
  let jumped = '';
  let applying = false;

  function apply(root: HTMLElement, query: string, jump: boolean): void {
    if (applying) return;
    applying = true;
    try {
      const first = applyPageFind(root, query);
      if (!query.trim()) {
        jumped = '';
        hit = null;
        return;
      }
      if (first && jump && jumped !== query) {
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        jumped = query;
        hit = first;
      }
    } finally {
      queueMicrotask(() => {
        applying = false;
      });
    }
  }

  return {
    observe(root, query) {
      jumped = '';
      const mo = new MutationObserver(() => apply(root, query, true));
      mo.observe(root, { childList: true, subtree: true });
      apply(root, query, true);
      return () => {
        mo.disconnect();
        clearFilterMarks(root);
      };
    },
    next(root) {
      hit = nextFilterHit(root, hit);
      hit?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return hit;
    }
  };
}
