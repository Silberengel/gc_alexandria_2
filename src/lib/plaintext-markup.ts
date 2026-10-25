/**
 * Light markup for catalog plaintext bodies (imwald PlaintextMarkup).
 * Single markers only — not CommonMark doubles.
 */

export type PlaintextLineKind = 'normal' | 'quote' | 'greentext';

export type PreparedLine = {
  kind: PlaintextLineKind;
  /** Visible list marker (`• ` / `1. `) or empty. Greentext keeps `>` here. */
  prefix: string;
  body: string;
};

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string };

const BULLET_LINE = /^(\s*)([*\-])\s+(.*)$/;
const ORDERED_LINE = /^(\s*)(\d+)\.\s+(.*)$/;
const QUOTE_LINE = /^(\s*)>\s+(.*)$/;
const GREENTEXT_LINE = /^(\s*)>(?! )(.+)$/;
const BOLD = /\*([^*\n]+)\*/;
const ITALIC = /_([^_\n]+)_/;

export function prepareLine(line: string): PreparedLine {
  const green = GREENTEXT_LINE.exec(line);
  if (green) {
    return { kind: 'greentext', prefix: `${green[1]}>`, body: green[2] ?? '' };
  }
  const quote = QUOTE_LINE.exec(line);
  if (quote) {
    return { kind: 'quote', prefix: quote[1] ?? '', body: quote[2] ?? '' };
  }
  const bullet = BULLET_LINE.exec(line);
  if (bullet) {
    return { kind: 'normal', prefix: `${bullet[1]}• `, body: bullet[3] ?? '' };
  }
  const ordered = ORDERED_LINE.exec(line);
  if (ordered) {
    return {
      kind: 'normal',
      prefix: `${ordered[1]}${ordered[2]}. `,
      body: ordered[3] ?? ''
    };
  }
  return { kind: 'normal', prefix: '', body: line };
}

export function prepareLines(text: string): PreparedLine[] {
  if (text === '') return [{ kind: 'normal', prefix: '', body: '' }];
  return text.split('\n').map(prepareLine);
}

/** Tokenize inline `*bold*` / `_italic_` left-to-right. Unmatched markers stay literal. */
export function tokenizeInline(text: string): InlineToken[] {
  if (!text) return [];
  const out: InlineToken[] = [];
  let i = 0;
  while (i < text.length) {
    const from = text.slice(i);
    const bold = BOLD.exec(from);
    const italic = ITALIC.exec(from);
    let next: RegExpExecArray | null = null;
    let kind: 'bold' | 'italic' = 'bold';
    if (bold && italic) {
      if (bold.index! <= italic.index!) {
        next = bold;
        kind = 'bold';
      } else {
        next = italic;
        kind = 'italic';
      }
    } else if (bold) {
      next = bold;
      kind = 'bold';
    } else if (italic) {
      next = italic;
      kind = 'italic';
    }
    if (!next || next.index == null) {
      out.push({ type: 'text', value: text.slice(i) });
      break;
    }
    const start = i + next.index;
    if (start > i) out.push({ type: 'text', value: text.slice(i, start) });
    out.push({ type: kind, value: next[1] ?? '' });
    i = start + next[0].length;
  }
  return out;
}
