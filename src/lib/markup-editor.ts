import { cleanTrackingUrl } from './clean-url';

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

const EXAMPLE_DOC_TITLE = 'Title of the document';
const EXAMPLE_SECTION_HEADING = 'A second-level header';

export function editHeading(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).replace(/[\r\n]+/g, ' ').trim();
  const { from, to, text } = lineBounds(source, start, end);
  const stripped = text.replace(/^(#{1,6}|={1,6})\s+/, '').trim();
  const heading = selected || stripped || EXAMPLE_SECTION_HEADING;
  const block = `${format === 'asciidoc' ? '==' : '##'} ${heading}`;
  if (!selected && !stripped) return selectInner(insertBlock(source, start, end, block), heading);
  const value = source.slice(0, from) + block + source.slice(to);
  return selectInner({ value, selectionStart: from + block.length, selectionEnd: from + block.length }, heading);
}

const EXAMPLE_QUOTE_LINES = [
  "‘Hope’ is the thing with feathers —",
  'That perches in the soul —',
  'And sings the tune without the words —',
  'And never stops — at all —',
  '',
  'And sweetest — in the Gale — is heard —',
  'And sore must be the storm —',
  'That could abash the little Bird',
  'That kept so many warm —',
  '',
  'I’ve heard it in the chillest land —',
  'And on the strangest Sea —',
  'Yet, never, in Extremity,',
  'It asked a crumb — of Me.'
];

const EXAMPLE_QUOTE_SOURCE = 'Hope Is The Thing With Feathers, by Emily Dickinson';
/** Generic attribution when wrapping a selection (examples stay for empty inserts). */
const QUOTE_ATTR_PLACEHOLDER = 'attribution';

export function editQuote(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).replace(/^\n+|\n+$/g, '');
  if (format === 'djot') {
    if (selected) {
      const quoted = selected
        .split('\n')
        .map((line) => (line.startsWith('> ') ? line : `> ${line}`))
        .join('\n');
      return selectInner(
        insertBlock(source, start, end, `{source="${QUOTE_ATTR_PLACEHOLDER}"}\n${quoted}`),
        QUOTE_ATTR_PLACEHOLDER
      );
    }
    const body = EXAMPLE_QUOTE_LINES.map((line) => (line ? `> ${line}` : '>')).join('\n');
    return insertBlock(source, start, end, `{source="${EXAMPLE_QUOTE_SOURCE}"}\n${body}`);
  }
  if (selected) {
    return selectInner(
      insertBlock(
        source,
        start,
        end,
        `[quote, ${QUOTE_ATTR_PLACEHOLDER}]\n____\n${selected}\n____`
      ),
      QUOTE_ATTR_PLACEHOLDER
    );
  }
  return insertBlock(
    source,
    start,
    end,
    `[quote, Emily Dickinson, Hope Is The Thing With Feathers]\n____\n${EXAMPLE_QUOTE_LINES.join('\n')}\n____`
  );
}

const EXAMPLE_UL_DJOT = `* a bullet
* another bullet

 1. numbered list within a bulleted list
 2. make sure indented items have a blank line above them
* yet another bullet

 * indented bullet
 * and so on`;

const EXAMPLE_OL_DJOT = `1. first item
2. second item
3. third item

  1. first indented item
  2. second indented item

    * bullet under numbered list

  3. third indented item`;

const EXAMPLE_UL_ASCIIDOC = `* a bullet
* another bullet
. numbered list within a bulleted list
. no blank lines between the rows
* yet another bullet
** indented bullet
** and so on`;

const EXAMPLE_OL_ASCIIDOC = `. first item
. second item
. third item
.. first indented item
.. second indented item
*** bullet under numbered list
*** another bullet
.. third indented item
... a deeper indent`;

export function editList(
  format: MarkupEditorFormat,
  ordered: boolean,
  source: string,
  start: number,
  end: number
): SourceEdit {
  const selected = source.slice(start, end).replace(/^\n+|\n+$/g, '');
  if (!selected) {
    const block =
      format === 'asciidoc'
        ? ordered
          ? EXAMPLE_OL_ASCIIDOC
          : EXAMPLE_UL_ASCIIDOC
        : ordered
          ? EXAMPLE_OL_DJOT
          : EXAMPLE_UL_DJOT;
    return insertBlock(source, start, end, block);
  }
  const prefix = format === 'asciidoc' ? (ordered ? '. ' : '* ') : ordered ? '1. ' : '* ';
  return prefixLines(source, start, end, prefix);
}

export function editStrike(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'asciidoc') return wrapInline(source, start, end, '[.line-through]#', '#', 'struck');
  return wrapInline(source, start, end, '{-', '-}', 'struck');
}

const EXAMPLE_INLINE_CODE = 'inline code';

const EXAMPLE_JSON_CODE = `{
  "content": "This is just an example. Substitute your own language for the json above, as necessary",
  "created_at": 1792962501,
  "tags": [
    [
      "test",
      "123"
    ]
  ]
}`;

const EXAMPLE_LITERAL = `The autumn wind begins to blow,
The golden leaves fall soft and slow.
A quiet chill upon the air,
As winter whispers everywhere.`;

export function editCode(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end);
  if (selected.includes('\n')) return editCodeBlock(format, source, start, end);
  return wrapInline(source, start, end, '`', '`', EXAMPLE_INLINE_CODE);
}

const EXAMPLE_INLINE_TEX = 'E = mc^2';
const EXAMPLE_DISPLAY_TEX = `x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}`;

/** Inline `$…$` or display `$$…$$` TeX (works for Djot and AsciiDoc). */
export function editTex(
  mode: 'inline' | 'display',
  source: string,
  start: number,
  end: number
): SourceEdit {
  const selected = source.slice(start, end).replace(/^\n+|\n+$/g, '');
  if (mode === 'inline') {
    const inner = selected.replace(/\n/g, ' ').trim() || EXAMPLE_INLINE_TEX;
    return selectInner(splice(source, start, end, `$${inner}$`, 1, inner.length), inner);
  }
  const inner = selected || EXAMPLE_DISPLAY_TEX;
  return selectInner(insertBlock(source, start, end, `$$\n${inner}\n$$`), inner);
}

/** Language-tagged source block (Djot fence / AsciiDoc [source]). */
export function editCodeBlock(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).replace(/^\n+|\n+$/g, '');
  if (selected) {
    const block =
      format === 'asciidoc'
        ? `[source,language]\n----\n${selected}\n----`
        : '```language\n' + selected + '\n```';
    return selectInner(insertBlock(source, start, end, block), 'language');
  }
  const block =
    format === 'asciidoc'
      ? `[source,json]\n----\n${EXAMPLE_JSON_CODE}\n----`
      : '```json\n' + EXAMPLE_JSON_CODE + '\n```';
  return selectInner(insertBlock(source, start, end, block), EXAMPLE_JSON_CODE);
}

const EXAMPLE_TABLE_ASCIIDOC = `.A table with a title, header and footer, horizontal alignment, and column width
[cols="5,2,>3", options="footer"]
|===
|Column 1 |Column 2 |Column 3

|Cell in column 1, row 1
|Cell in column 2, row 1
|Cell in column 3, row 1

|Cell in column 1, row 2
|Cell in column 2, row 2
|Cell in column 3, row 2

|Cell in column 1, row 3
|Cell in column 2, row 3
|Cell in column 3, row 3

|Cell in column 1, row 4
|Cell in column 2, row 4
|Cell in column 3, row 4
|===`;

export function editTable(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  // Djot marks the prior row as a header only when the separator has no spaces
  // around the dashes (`|----|`). Markdown's `| --- |` is a data row of em dashes.
  const block =
    format === 'asciidoc'
      ? EXAMPLE_TABLE_ASCIIDOC
      : '| Header | Header |\n|----|----|\n| Cell | Cell |';
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

const EXAMPLE_LINK_LABEL = 'display text';
const EXAMPLE_LINK_URL = 'https://example.com';

export function editLink(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).trim();
  const selectedIsUrl = /^https?:\/\//i.test(selected);
  if (format === 'asciidoc') {
    if (selectedIsUrl) {
      const insert = `link:${selected}[${EXAMPLE_LINK_LABEL}]`;
      return splice(source, start, end, insert, `link:${selected}[`.length, EXAMPLE_LINK_LABEL.length);
    }
    const label = selected || EXAMPLE_LINK_LABEL;
    const insert = `link:${EXAMPLE_LINK_URL}[${label}]`;
    return splice(source, start, end, insert, 'link:'.length, EXAMPLE_LINK_URL.length);
  }
  if (selectedIsUrl) {
    const insert = `[${EXAMPLE_LINK_LABEL}](${selected})`;
    return splice(source, start, end, insert, 1, EXAMPLE_LINK_LABEL.length);
  }
  const label = selected || EXAMPLE_LINK_LABEL;
  const insert = `[${label}](${EXAMPLE_LINK_URL})`;
  return splice(source, start, end, insert, 1, label.length);
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
  const scrubbed = cleanTrackingUrl(file.url) || file.url.trim();
  const url = scrubbed.replace(/"/g, '%22');
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
 * Document title. Djot: `# …`. AsciiDoc: one `= …` at the top of the file —
 * a later `=` is a level-0 section, which article documents reject.
 */
export function editTitle(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).replace(/[\r\n]+/g, ' ').trim();
  if (format === 'djot') {
    const { from, to, text } = lineBounds(source, start, end);
    const stripped = text.replace(/^#\s+/, '').trim();
    const title = selected || stripped || EXAMPLE_DOC_TITLE;
    const block = `# ${title}`;
    if (!selected && !stripped) return selectInner(insertBlock(source, start, end, block), title);
    const value = source.slice(0, from) + block + source.slice(to);
    return selectInner({ value, selectionStart: from + block.length, selectionEnd: from + block.length }, title);
  }
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
  const title = selected || EXAMPLE_DOC_TITLE;
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

const EXAMPLE_CHECKLIST_DJOT = `- [ ] this is an unchecked box
- [x] this is a checked one`;

const EXAMPLE_CHECKLIST_ASCIIDOC = `* [ ] this is an unchecked box
* [x] this is a checked one`;

export function editChecklist(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).replace(/^\n+|\n+$/g, '');
  if (!selected) {
    return insertBlock(
      source,
      start,
      end,
      format === 'asciidoc' ? EXAMPLE_CHECKLIST_ASCIIDOC : EXAMPLE_CHECKLIST_DJOT
    );
  }
  return prefixLines(source, start, end, format === 'asciidoc' ? '* [ ] ' : '- [ ] ');
}

const EXAMPLE_DESCRIPTION_DJOT = `: term

  description

: another term

  another description`;

const EXAMPLE_DESCRIPTION_ASCIIDOC = `term:: description

another term:: another description`;

export function editDescription(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).trim();
  if (!selected) {
    return insertBlock(
      source,
      start,
      end,
      format === 'asciidoc' ? EXAMPLE_DESCRIPTION_ASCIIDOC : EXAMPLE_DESCRIPTION_DJOT
    );
  }
  if (format === 'asciidoc') {
    // Selection is the description; "term" is the editable placeholder.
    const line = `term:: ${selected}`;
    const edit = insertBlock(source, start, end, line);
    return selectInner(edit, 'term');
  }
  return selectInner(insertBlock(source, start, end, `: term\n\n  ${selected}`), 'term');
}

const EXAMPLE_CALLOUT =
  "This is a callout block. Use it to catch the reader's attention, to focus on certain information.";

export function editAdmonition(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).replace(/^\n+|\n+$/g, '');
  const inner = selected || EXAMPLE_CALLOUT;
  if (format === 'djot') {
    return selectInner(insertBlock(source, start, end, `::: note\n${inner}\n:::`), inner);
  }
  if (selected.includes('\n') || !selected) {
    return selectInner(insertBlock(source, start, end, `[NOTE]\n====\n${inner}\n====`), inner);
  }
  return selectInner(insertBlock(source, start, end, `NOTE: ${inner}`), inner);
}

const EXAMPLE_SIDEBAR =
  'This is a sidebar. It is a way to divide up the flow of the text. On narrow screens, it will appear in the middle. On wider ones, it will sometimes appear to the right or left, with the rest of the page wrapping around it.';

export function editSidebar(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).replace(/^\n+|\n+$/g, '');
  const inner = selected || EXAMPLE_SIDEBAR;
  if (format === 'djot') {
    return selectInner(insertBlock(source, start, end, `::: sidebar\n${inner}\n:::`), inner);
  }
  return selectInner(insertBlock(source, start, end, `****\n${inner}\n****`), inner);
}

export function editExample(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  if (format === 'djot') return delimited(source, start, end, '::: example', ':::', 'example');
  return delimited(source, start, end, '====', '====', 'example');
}

/**
 * Preformatted text that is not source code.
 * Djot: an unlabeled fence. AsciiDoc: a `....` literal block.
 */
export function editLiteral(format: MarkupEditorFormat, source: string, start: number, end: number): SourceEdit {
  const selected = source.slice(start, end).replace(/^\n+|\n+$/g, '');
  const inner = selected || EXAMPLE_LITERAL;
  if (format === 'djot') {
    return selectInner(insertBlock(source, start, end, '```\n' + inner + '\n```'), inner);
  }
  return selectInner(insertBlock(source, start, end, `....\n${inner}\n....`), inner);
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
  const selected = source.slice(start, end).trim();
  if (format === 'asciidoc') {
    if (selected) {
      const insert = `menu:Menu[${selected}]`;
      return splice(source, start, end, insert, 'menu:'.length, 'Menu'.length);
    }
    return splice(source, start, end, 'menu:File[Save]', 'menu:'.length, 'File'.length);
  }
  if (selected) {
    const insert = `Menu › ${selected}`;
    return splice(source, start, end, insert, 0, 'Menu'.length);
  }
  return splice(source, start, end, 'File › Save', 0, 'File'.length);
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

/** Insert an NKBIP-03 `[[citation::mode::nevent]]` macro at the caret (selection replaced). */
export function editCitation(
  source: string,
  start: number,
  end: number,
  mode: string,
  neventOrBech32: string
): SourceEdit {
  let id = neventOrBech32.trim();
  while (id.toLowerCase().startsWith('nostr:')) id = id.slice(6);
  const insert = `[[citation::${mode}::${id}]]`;
  return splice(source, start, end, insert, 0, insert.length);
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
  | 'tex-inline'
  | 'tex-display'
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
  | 'rule';

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
    case 'tex-inline':
      return editTex('inline', source, start, end);
    case 'tex-display':
      return editTex('display', source, start, end);
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
    default:
      return editList(format, false, source, start, end);
  }
}
