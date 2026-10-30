import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { displayTitle } from './metadata';
import { resolveMarkup, type MarkupFormat } from './markup';

/** Kinds that offer a single-body source download in page/reader menus. */
export function canDownloadEventSource(event: Event): boolean {
  if (
    event.kind === KIND.WIKI ||
    event.kind === KIND.SPEC ||
    event.kind === KIND.LONG_FORM ||
    event.kind === KIND.DJOT ||
    event.kind === KIND.SECTION
  ) {
    return Boolean(event.content?.trim());
  }
  // Publication indexes may carry a short body; empty indexes use assembled export instead.
  if (event.kind === KIND.PUBLICATION) return Boolean(event.content?.trim());
  return false;
}

/** File extension from resolved markup — djot/markdown → `.md`, AsciiDoc → `.adoc`. */
export function sourceFileExtension(format: MarkupFormat): 'adoc' | 'md' | 'txt' {
  if (format === 'asciidoc') return 'adoc';
  if (format === 'djot') return 'md';
  return 'txt';
}

export function sourceDownloadFilename(event: Event): string {
  const format = resolveMarkup(event.kind, event.content ?? '', event.tags);
  const ext = sourceFileExtension(format);
  const title = displayTitle(event) || 'document';
  const safe = title.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[\W_]+|[\W_]+$/g, '');
  const base = (safe || 'document').slice(0, 80);
  return `${base}.${ext}`;
}

/** Trigger a browser download of the event body with a markup-aware extension. */
export function downloadEventSourceFile(event: Event): { filename: string } {
  const content = event.content ?? '';
  if (!content.trim()) {
    throw new Error('This item has no downloadable source text.');
  }
  const filename = sourceDownloadFilename(event);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { filename };
}
