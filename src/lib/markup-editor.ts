export type MarkupEditorFormat = 'djot' | 'asciidoc';

export type SourceEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export type MediaFile = {
  url: string;
  mime?: string;
  name?: string;
};

function splice(
  source: string,
  start: number,
  end: number,
  insert: string,
  selectAt: number,
  selectLen: number
): SourceEdit {
  return {
    value: source.slice(0, start) + insert + source.slice(end),
    selectionStart: start + selectAt,
    selectionEnd: start + selectAt + selectLen
  };
}

function lineBounds(source: string, start: number, end: number): { from: number; to: number; text: string } {
  const from = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const newline = source.indexOf('\n', end);
  const to = newline === -1 ? source.length : newline;
  return { from, to, text: source.slice(from, to) };
}

export function wrapInline(
  source: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string
): SourceEdit {
  const inner = source.slice(start, end) || placeholder;
  return splice(source, start, end, before + inner + after, before.length, inner.length);
}

/** Prefix every line in the selection. Lines that already start with the prefix are left alone. */
export function prefixLines(source: string, start: number, end: number, prefix: string): SourceEdit {
  const { from, to, text } = lineBounds(source, start, end);
  const lines = (text || '').split('\n');
  const next = lines
    .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
    .join('\n');
  const cursor = from + next.length;
  return {
    value: source.slice(0, from) + next + source.slice(to),
    selectionStart: cursor,
    selectionEnd: cursor
  };
}

/** Insert a block on its own, with a blank line on either side when neighbors exist. */
export function insertBlock(source: string, start: number, end: number, block: string): SourceEdit {
  const before = source.slice(0, start);
  const after = source.slice(end);
  const prefix =
    before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix =
    after.length === 0 || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const insert = prefix + block + suffix;
  const cursor = before.length + prefix.length + block.length;
  return {
    value: before + insert + after,
    selectionStart: cursor,
    selectionEnd: cursor
  };
}

export function editBold(source: string, start: number, end: number): SourceEdit {
  return wrapInline(source, start, end, '*', '*', 'bold');
}

export function editItalic(source: string, start: number, end: number): SourceEdit {
  return wrapInline(source, start, end, '_', '_', 'italic');
}

export function editHeading(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  return prefixLines(source, start, end, format === 'asciidoc' ? '== ' : '## ');
}

export function editQuote(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'djot') return prefixLines(source, start, end, '> ');
  const { from, to, text } = lineBounds(source, start, end);
  const inner = text.trim() ? text : 'quote';
  return insertBlock(source, from, to, `[quote]\n____\n${inner}\n____`);
}

export function editList(
  format: MarkupEditorFormat,
  ordered: boolean,
  source: string,
  start: number,
  end: number
): SourceEdit {
  const prefix = format === 'asciidoc' ? (ordered ? '. ' : '* ') : ordered ? '1. ' : '- ';
  return prefixLines(source, start, end, prefix);
}

export function editStrike(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'asciidoc') return wrapInline(source, start, end, '[.line-through]#', '#', 'struck');
  return wrapInline(source, start, end, '{-', '-}', 'struck');
}

export function editCode(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end);
  if (selected.includes('\n')) return editCodeBlock(format, source, start, end);
  return wrapInline(source, start, end, '`', '`', 'code');
}

/** Fenced code block, even when the selection is a single line. */
export function editCodeBlock(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).replace(/^\n+|\n+$/g, '');
  const inner = selected || 'code';
  const block = format === 'asciidoc' ? `[source]\n----\n${inner}\n----` : '```\n' + inner + '\n```';
  const edit = insertBlock(source, start, end, block);
  const at = edit.value.lastIndexOf(inner, edit.selectionStart);
  if (at < 0) return edit;
  return { value: edit.value, selectionStart: at, selectionEnd: at + inner.length };
}

export function editTable(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const block =
    format === 'asciidoc'
      ? '|===\n| Header | Header\n\n| Cell | Cell\n|==='
      : '| Header | Header |\n| --- | --- |\n| Cell | Cell |';
  return insertBlock(source, start, end, block);
}

export function editRule(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  return insertBlock(source, start, end, format === 'asciidoc' ? "'''" : '---');
}

/** Next `[^n]` that is not already used as a reference or definition. */
export function nextFootnoteNumber(source: string): number {
  const used = new Set<number>();
  for (const match of source.matchAll(/\[\^(\d+)\]/g)) {
    const n = Number(match[1]);
    if (n > 0) used.add(n);
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

export function editFootnote(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).trim();
  const note = selected || 'note';
  if (format === 'asciidoc') {
    const insert = `footnote:[${note}]`;
    return splice(source, start, end, insert, 'footnote:['.length, note.length);
  }
  const n = nextFootnoteNumber(source);
  const ref = `[^${n}]`;
  const body = source.slice(0, start) + ref + source.slice(end);
  const sep = body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  const lead = `${body}${sep}[^${n}]: `;
  const value = `${lead}${note}\n`;
  return { value, selectionStart: lead.length, selectionEnd: lead.length + note.length };
}

export function editLink(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).trim();
  const selectedIsUrl = /^https?:\/\//i.test(selected);
  if (format === 'asciidoc') {
    if (selectedIsUrl) {
      const insert = `link:${selected}[link]`;
      return splice(source, start, end, insert, `link:${selected}[`.length, 'link'.length);
    }
    const label = selected || 'link';
    const insert = `link:https://[${label}]`;
    return splice(source, start, end, insert, 'link:'.length, 'https://'.length);
  }
  if (selectedIsUrl) {
    const insert = `[link](${selected})`;
    return splice(source, start, end, insert, 1, 'link'.length);
  }
  const label = selected || 'link';
  const insert = `[${label}](https://)`;
  return splice(source, start, end, insert, insert.indexOf('https://'), 'https://'.length);
}

export function mediaAlt(name: string | undefined): string {
  const base = (name ?? '').trim().split(/[/\\]/).pop() ?? '';
  return base.replace(/\.[^.]+$/, '').replace(/[\][\n\r]/g, '').trim();
}

export function mediaKind(mime: string | undefined, nameOrUrl: string): 'image' | 'video' | 'audio' | 'file' {
  const type = (mime ?? '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  const path = nameOrUrl.split('?')[0]?.toLowerCase() ?? '';
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(path)) return 'image';
  if (/\.(mp4|webm|mov|ogv|mkv)$/.test(path)) return 'video';
  if (/\.(mp3|ogg|wav|m4a|flac|aac|opus)$/.test(path)) return 'audio';
  return 'file';
}

/** Format-native markup for a Blossom file URL. */
export function mediaMarkup(format: MarkupEditorFormat, file: MediaFile): string {
  const url = file.url.replace(/"/g, '%22');
  const alt = mediaAlt(file.name);
  const kind = mediaKind(file.mime, file.name || file.url);
  if (format === 'asciidoc') {
    if (kind === 'image') return `image::${url}[${alt}]`;
    if (kind === 'video') return `video::${url}[]`;
    if (kind === 'audio') return `audio::${url}[]`;
    return `link:${url}[${alt || 'file'}]`;
  }
  if (kind === 'image') return `![${alt}](${url})`;
  if (kind === 'video') return '``` =html\n<video src="' + url + '" controls></video>\n```';
  if (kind === 'audio') return '``` =html\n<audio src="' + url + '" controls></audio>\n```';
  return `[${alt || 'file'}](${url})`;
}

export function editMedia(
  format: MarkupEditorFormat,
  source: string,
  start: number,
  end: number,
  file: MediaFile
): SourceEdit {
  return insertBlock(source, start, end, mediaMarkup(format, file));
}

function selectInner(edit: SourceEdit, inner: string): SourceEdit {
  const at = edit.value.lastIndexOf(inner, edit.selectionStart);
  if (at < 0) return edit;
  return { value: edit.value, selectionStart: at, selectionEnd: at + inner.length };
}

function blockAround(source: string, start: number, end: number, block: string, inner: string): SourceEdit {
  return selectInner(insertBlock(source, start, end, block), inner);
}

function delimited(
  source: string,
  start: number,
  end: number,
  open: string,
  close: string,
  placeholder: string
): SourceEdit {
  const inner = source.slice(start, end).replace(/^\n+|\n+$/g, '') || placeholder;
  return blockAround(source, start, end, `${open}\n${inner}\n${close}`, inner);
}

function spanClass(
  source: string,
  start: number,
  end: number,
  klass: string,
  placeholder: string
): SourceEdit {
  const inner = source.slice(start, end) || placeholder;
  return splice(source, start, end, `[${inner}]{.${klass}}`, 1, inner.length);
}

/**
 * AsciiDoc allows one document title, and it has to be the first line.
 * A later `=` is a level-0 section, which article documents reject.
 */
export function editTitle(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'djot') return prefixLines(source, start, end, '# ');
  const existing = /^=[ \t]+([^\n]*)$/m.exec(source);
  if (existing && source.slice(0, existing.index).trim() === '') {
    const titleText = existing[1] ?? '';
    const titleStart = existing.index + existing[0].length - titleText.length;
    return {
      value: source,
      selectionStart: titleStart,
      selectionEnd: titleStart + titleText.length
    };
  }
  const selected = source.slice(start, end).replace(/[\r\n]+/g, ' ').trim();
  const title = selected || 'Document Title';
  const rest = source.replace(/^\n+/, '');
  const value = `= ${title}\n\n${rest}`;
  return { value, selectionStart: 2, selectionEnd: 2 + title.length };
}

export function editHighlight(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'asciidoc') return wrapInline(source, start, end, '#', '#', 'highlight');
  return spanClass(source, start, end, 'mark', 'highlight');
}

export function editUnderline(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'asciidoc') return wrapInline(source, start, end, '[.underline]#', '#', 'underlined');
  return spanClass(source, start, end, 'underline', 'underlined');
}

export function editSuperscript(source: string, start: number, end: number): SourceEdit {
  return wrapInline(source, start, end, '^', '^', 'super');
}

export function editSubscript(source: string, start: number, end: number): SourceEdit {
  return wrapInline(source, start, end, '~', '~', 'sub');
}

export function editChecklist(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  return prefixLines(source, start, end, format === 'asciidoc' ? '* [ ] ' : '- [ ] ');
}

export function editDescription(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).trim();
  if (format === 'asciidoc') {
    const description = selected || 'description';
    const line = `term:: ${description}`;
    const edit = insertBlock(source, start, end, line);
    const at = edit.value.lastIndexOf(description, edit.selectionStart);
    return at < 0 ? edit : { value: edit.value, selectionStart: at, selectionEnd: at + description.length };
  }
  const description = selected || 'description';
  return blockAround(source, start, end, `**term**\n\n${description}`, description);
}

export function editAdmonition(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const inner = source.slice(start, end).replace(/^\n+|\n+$/g, '') || 'note';
  if (format === 'djot') return delimited(source, start, end, '::: note', ':::', 'note');
  if (inner.includes('\n')) return delimited(source, start, end, '[NOTE]\n====', '====', 'note');
  return blockAround(source, start, end, `NOTE: ${inner}`, inner);
}

export function editSidebar(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'djot') return delimited(source, start, end, '::: sidebar', ':::', 'sidebar');
  return delimited(source, start, end, '****', '****', 'sidebar');
}

export function editExample(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'djot') return delimited(source, start, end, '::: example', ':::', 'example');
  return delimited(source, start, end, '====', '====', 'example');
}

export function editLiteral(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'djot') return editCodeBlock(format, source, start, end);
  return delimited(source, start, end, '....', '....', 'literal');
}

export function editKbd(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const key = source.slice(start, end).trim() || 'F11';
  if (format === 'asciidoc') return splice(source, start, end, `kbd:[${key}]`, 'kbd:['.length, key.length);
  const insert = '`<kbd>' + key + '</kbd>`{=html}';
  return splice(source, start, end, insert, '`<kbd>'.length, key.length);
}

export function editButton(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const label = source.slice(start, end).trim() || 'OK';
  if (format === 'asciidoc') return splice(source, start, end, `btn:[${label}]`, 'btn:['.length, label.length);
  const insert = '`<b class="button">' + label + '</b>`{=html}';
  return splice(source, start, end, insert, '`<b class="button">'.length, label.length);
}

export function editMenu(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'asciidoc') return splice(source, start, end, 'menu:File[Save]', 'menu:'.length, 'File'.length);
  return splice(source, start, end, 'File › Save', 0, 'File'.length);
}

export function editPageBreak(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'asciidoc') return insertBlock(source, start, end, '<<<');
  return insertBlock(source, start, end, '``` =html\n<div style="page-break-after: always"></div>\n```');
}

export function editXref(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const label = source.slice(start, end).trim() || 'section';
  if (format === 'asciidoc') {
    const insert = `<<id,${label}>>`;
    return splice(source, start, end, insert, 2, 'id'.length);
  }
  const insert = `[${label}](#id)`;
  return splice(source, start, end, insert, insert.indexOf('#id') + 1, 'id'.length);
}

export type MarkupTool =
  | 'title'
  | 'heading'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'underline'
  | 'highlight'
  | 'superscript'
  | 'subscript'
  | 'code'
  | 'codeblock'
  | 'link'
  | 'xref'
  | 'kbd'
  | 'button'
  | 'menu'
  | 'quote'
  | 'admonition'
  | 'sidebar'
  | 'example'
  | 'literal'
  | 'list'
  | 'numbered'
  | 'checklist'
  | 'description'
  | 'table'
  | 'footnote'
  | 'rule'
  | 'pagebreak';

export function editMarkup(
  id: MarkupTool,
  format: MarkupEditorFormat,
  source: string,
  start: number,
  end: number
): SourceEdit {
  switch (id) {
    case 'title':
      return editTitle(format, source, start, end);
    case 'heading':
      return editHeading(format, source, start, end);
    case 'bold':
      return editBold(source, start, end);
    case 'italic':
      return editItalic(source, start, end);
    case 'strike':
      return editStrike(format, source, start, end);
    case 'underline':
      return editUnderline(format, source, start, end);
    case 'highlight':
      return editHighlight(format, source, start, end);
    case 'superscript':
      return editSuperscript(source, start, end);
    case 'subscript':
      return editSubscript(source, start, end);
    case 'code':
      return editCode(format, source, start, end);
    case 'codeblock':
      return editCodeBlock(format, source, start, end);
    case 'link':
      return editLink(format, source, start, end);
    case 'xref':
      return editXref(format, source, start, end);
    case 'kbd':
      return editKbd(format, source, start, end);
    case 'button':
      return editButton(format, source, start, end);
    case 'menu':
      return editMenu(format, source, start, end);
    case 'quote':
      return editQuote(format, source, start, end);
    case 'admonition':
      return editAdmonition(format, source, start, end);
    case 'sidebar':
      return editSidebar(format, source, start, end);
    case 'example':
      return editExample(format, source, start, end);
    case 'literal':
      return editLiteral(format, source, start, end);
    case 'numbered':
      return editList(format, true, source, start, end);
    case 'checklist':
      return editChecklist(format, source, start, end);
    case 'description':
      return editDescription(format, source, start, end);
    case 'table':
      return editTable(format, source, start, end);
    case 'footnote':
      return editFootnote(format, source, start, end);
    case 'rule':
      return editRule(format, source, start, end);
    case 'pagebreak':
      return editPageBreak(format, source, start, end);
    default:
      return editList(format, false, source, start, end);
  }
}
