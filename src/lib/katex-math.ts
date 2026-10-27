import katex from 'katex';

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render a TeX string to KaTeX HTML (safe for `{@html}`). */
export function renderKatexHtml(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(decodeBasicEntities(tex), {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      // HTML-only: MathML tags are often stripped by DOMPurify.
      output: 'html',
      trust: false
    });
  } catch {
    return displayMode ? `\\[${escapeHtml(tex)}\\]` : `\\(${escapeHtml(tex)}\\)`;
  }
}

function renderTex(tex: string, displayMode: boolean): string {
  return renderKatexHtml(tex, displayMode);
}

/** TeX-ish cues so `$10.50` / `$primary-color` stay literal. */
function hasTexCue(tex: string): boolean {
  // Do not treat kebab-case hyphens (`primary-color`) as minus operators.
  if (/\\|_|\^|=|\{|\}|[+*/<>]/.test(tex)) return true;
  if (/(?:^|[^A-Za-z])-(?:[^A-Za-z]|$)/.test(tex)) return true;
  return false;
}

function isAcceptableMathBody(tex: string, opts: { display: boolean; explicit: boolean }): boolean {
  const t = tex.trim();
  if (!t) return false;
  // Currency-like body with no TeX markup.
  if (/^\d/.test(t) && !hasTexCue(t)) return false;
  if (hasTexCue(t)) return true;
  // Placeholders like `$...$` / `$ $` stay literal.
  if (/^[.\s…]+$/.test(t)) return false;
  // Display / code-wrapped letter formulas (`$x$`, `$$E$$`) without operators.
  if ((opts.display || opts.explicit) && /[A-Za-z]/.test(t)) return true;
  return false;
}

export type MathSpan = { tex: string; display: boolean };

/**
 * If `text` is entirely a `$…$` / `$$…$$` math span, return it.
 * `explicit` relaxes cues (inline code / latex fences that already chose delimiters).
 */
export function extractWholeMath(text: string, explicit = true): MathSpan | null {
  const t = text.trim();
  if (!t) return null;

  if (t.startsWith('$$') && t.endsWith('$$') && t.length >= 5) {
    const tex = t.slice(2, -2);
    if (isAcceptableMathBody(tex, { display: true, explicit })) {
      return { tex: tex.trim(), display: true };
    }
    return null;
  }

  if (t.startsWith('$') && t.endsWith('$') && t.length >= 3 && !t.startsWith('$$')) {
    const tex = t.slice(1, -1);
    if (tex.includes('\n')) return null;
    if (isAcceptableMathBody(tex, { display: false, explicit })) {
      return { tex, display: false };
    }
  }
  return null;
}

const MATH_LANG = /^(?:language-)?(?:latex|tex|math|katex)$/i;

export function isMathCodeLanguage(lang: string | undefined | null): boolean {
  if (!lang) return false;
  return MATH_LANG.test(lang.trim());
}

/** True when a listing body should be left for KaTeX instead of highlight.js. */
export function isMathCodeBlock(source: string, lang?: string | null): boolean {
  if (isMathCodeLanguage(lang ?? '')) return true;
  return extractWholeMath(source, true) != null;
}

type TextSegment =
  | { type: 'text'; value: string }
  | { type: 'math'; tex: string; display: boolean };

function pushText(out: TextSegment[], value: string): void {
  if (!value) return;
  const last = out[out.length - 1];
  if (last?.type === 'text') last.value += value;
  else out.push({ type: 'text', value });
}

function pushMath(out: TextSegment[], span: MathSpan): void {
  out.push({ type: 'math', tex: span.tex, display: span.display });
}

/**
 * Scan plain text for `$$…$$` then `$…$`, skipping currency (`$12`) and empty bodies.
 */
export function findDollarMathInText(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const dollar = text.indexOf('$', i);
    if (dollar < 0) {
      pushText(out, text.slice(i));
      break;
    }
    pushText(out, text.slice(i, dollar));

    // Display $$…$$
    if (text[dollar + 1] === '$') {
      const close = text.indexOf('$$', dollar + 2);
      if (close < 0) {
        pushText(out, '$$');
        i = dollar + 2;
        continue;
      }
      const tex = text.slice(dollar + 2, close);
      if (isAcceptableMathBody(tex, { display: true, explicit: false })) {
        pushMath(out, { tex: tex.trim(), display: true });
        i = close + 2;
        continue;
      }
      pushText(out, '$$');
      i = dollar + 2;
      continue;
    }

    // Inline $…$ on the same line. Lone `$12.50` / `$primary-color` have no
    // closer (or fail the body check); only advance past this `$` so a later
    // opener like `$E=mc^2$` is still found.
    const lineEnd = text.indexOf('\n', dollar + 1);
    const lineLimit = lineEnd < 0 ? text.length : lineEnd;
    const close = text.indexOf('$', dollar + 1);
    if (close < 0 || close > lineLimit || close === dollar + 1) {
      pushText(out, '$');
      i = dollar + 1;
      continue;
    }
    const tex = text.slice(dollar + 1, close);
    if (isAcceptableMathBody(tex, { display: false, explicit: false })) {
      pushMath(out, { tex, display: false });
      i = close + 1;
      continue;
    }
    pushText(out, '$');
    i = dollar + 1;
  }
  return out;
}

const FENCE_OPEN = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1[ \t]*(?:\n|$)/;

/**
 * Split plaintext into prose and math, honoring ``` / ` fences when they wrap math.
 */
export function splitMathSegments(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const fence = text.slice(i).match(FENCE_OPEN);
    if (fence && fence.index === 0) {
      const lang = (fence[2] ?? '').trim().split(/\s+/)[0] ?? '';
      const body = fence[3] ?? '';
      const whole = extractWholeMath(body, true);
      if (whole || isMathCodeLanguage(lang)) {
        if (whole) pushMath(out, whole);
        else {
          // language-latex without outer $$ — treat body as display TeX
          const tex = body.trim();
          if (tex) pushMath(out, { tex, display: true });
          else pushText(out, fence[0]!);
        }
      } else {
        pushText(out, fence[0]!);
      }
      i += fence[0]!.length;
      continue;
    }

    if (text[i] === '`') {
      let ticks = 0;
      while (text[i + ticks] === '`') ticks += 1;
      if (ticks >= 3) {
        // Unclosed fence — emit rest as text
        pushText(out, text.slice(i));
        break;
      }
      const close = text.indexOf('`'.repeat(ticks), i + ticks);
      if (close < 0) {
        pushText(out, text.slice(i));
        break;
      }
      const body = text.slice(i + ticks, close);
      const whole = extractWholeMath(body, true);
      if (whole) pushMath(out, whole);
      else pushText(out, text.slice(i, close + ticks));
      i = close + ticks;
      continue;
    }

    // Take until next ` or end; then run dollar scan on the chunk
    let next = text.indexOf('`', i);
    if (next < 0) next = text.length;
    // Also stop early enough that `$` scanning covers the chunk
    const chunk = text.slice(i, next);
    for (const seg of findDollarMathInText(chunk)) {
      if (seg.type === 'text') pushText(out, seg.value);
      else pushMath(out, seg);
    }
    i = next;
  }
  return out;
}

/** Render math segments; escape non-math with `escape`. */
export function renderMathSegments(
  segments: TextSegment[],
  escape: (s: string) => string = escapeHtml
): string {
  return segments
    .map((seg) => {
      if (seg.type === 'math') return renderTex(seg.tex, seg.display);
      return escape(seg.value);
    })
    .join('');
}

/** Plaintext → HTML with KaTeX (escapes non-math). */
export function renderMathInText(text: string, escape: (s: string) => string = escapeHtml): string {
  if (!text.includes('$') && !text.includes('`')) return escape(text);
  return renderMathSegments(splitMathSegments(text), escape);
}

const SKIP_MATH_TAGS = new Set(['pre', 'code', 'script', 'style', 'kbd', 'samp']);

function replaceDelimitedTex(html: string): string {
  if (!html.includes('\\(') && !html.includes('\\[')) return html;
  let out = html.replace(/\\\[([\s\S]+?)\\\]/g, (_full, tex: string) => renderTex(tex, true));
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_full, tex: string) => renderTex(tex, false));
  return out;
}

function replaceMathCodeElements(html: string): string {
  // Fenced / listing blocks first
  let out = html.replace(
    /<pre([^>]*)>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (full, _preAttrs: string, codeAttrs: string, body: string) => {
      const langFromClass = /\blanguage-([\w#+.-]+)\b/i.exec(codeAttrs)?.[1];
      const langFromData = /\bdata-lang=["']?([\w#+.-]+)/i.exec(codeAttrs)?.[1];
      const lang = langFromClass || langFromData || '';
      const source = decodeBasicEntities(body);
      const whole = extractWholeMath(source, true);
      if (whole) return renderTex(whole.tex, whole.display);
      if (isMathCodeLanguage(lang)) {
        const tex = source.trim();
        if (!tex) return full;
        return renderTex(tex, true);
      }
      return full;
    }
  );

  // Inline <code>…</code> not already inside <pre>
  out = out.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, (full, attrs: string, body: string) => {
    if (/\bhljs\b/i.test(attrs)) return full;
    const source = decodeBasicEntities(body);
    // Skip if body still has nested tags (highlighted spans)
    if (/<[a-z]/i.test(source)) return full;
    const whole = extractWholeMath(source, true);
    if (!whole) return full;
    return renderTex(whole.tex, whole.display);
  });

  return out;
}

function mapHtmlTextNodesForMath(html: string, transform: (text: string) => string): string {
  let out = '';
  let i = 0;
  let skip = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end < 0) {
        out += html.slice(i);
        break;
      }
      const tag = html.slice(i, end + 1);
      const name = /^<\/?\s*([a-zA-Z0-9]+)/.exec(tag)?.[1]?.toLowerCase();
      if (name && SKIP_MATH_TAGS.has(name)) {
        const closing = /^<\s*\//.test(tag);
        const selfClosing = /\/>\s*$/.test(tag);
        if (!selfClosing) skip = Math.max(0, skip + (closing ? -1 : 1));
      }
      out += tag;
      i = end + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const text = html.slice(i, next === -1 ? html.length : next);
    out += skip > 0 ? text : transform(text);
    if (next === -1) break;
    i = next;
  }
  return out;
}

function replaceDollarMathInHtmlText(html: string): string {
  if (!html.includes('$')) return html;
  return mapHtmlTextNodesForMath(html, (text) => {
    if (!text.includes('$')) return text;
    return findDollarMathInText(text)
      .map((seg) => {
        if (seg.type === 'math') return renderTex(seg.tex, seg.display);
        return seg.value;
      })
      .join('');
  });
}

/**
 * Replace TeX in rendered HTML: math-only code/listings, `\(...\)`/`\[…\]`, then `$…$`/`$$…$$` in text.
 */
export function renderMathInHtml(html: string): string {
  if (!html) return html;
  let out = replaceMathCodeElements(html);
  out = replaceDelimitedTex(out);
  out = replaceDollarMathInHtmlText(out);
  return out;
}

/**
 * Replace Asciidoctor latexmath / stem (TeX) delimiters with KaTeX HTML.
 * @deprecated Prefer {@link renderMathInHtml}.
 */
export function renderAsciidoctorMath(html: string): string {
  return renderMathInHtml(html);
}

const AD_FENCE_LINE = /^(----|\.\.\.\.|====|\*\*\*\*|____|\+\+\+\+)\s*$/;

/** Djot native math: `$`tex`` / `$$`tex`` — verbatim body, so `_` is not emphasis. */
function toDjotNativeMath(tex: string, display: boolean): string {
  let n = 1;
  while (tex.includes('`'.repeat(n))) n += 1;
  const ticks = '`'.repeat(n);
  const padL = tex.startsWith('`') ? ' ' : '';
  const padR = tex.endsWith('`') ? ' ' : '';
  return `${display ? '$$' : '$'}${ticks}${padL}${tex}${padR}${ticks}`;
}

/** Whole-line Djot/CommonMark fence opener or closer (` ```lang ` / ` ``` `). */
const DJOT_FENCE_LINE = /^( {0,3})(```+|~~~+)([^\n`]*)$/;

/**
 * Protect bare `$…$` / `$$…$$` from Djot emphasis (`_` / `*`) by rewriting to native math.
 * Leaves fenced and inline code alone (HTML pass still KaTeX’s those).
 *
 * Fence matching is line-based so a mid-line ``` (e.g. `` `$${amount}``` ``) cannot
 * swallow the rest of the document and skip later display math.
 */
export function preprocessDjotDollarMath(src: string): string {
  if (!src.includes('$')) return src;
  const lines = src.split('\n');
  const out: string[] = [];
  let fenceMarker: string | null = null;

  for (const line of lines) {
    const fence = DJOT_FENCE_LINE.exec(line);
    if (fenceMarker) {
      out.push(line);
      if (fence && fence[2]!.charAt(0) === fenceMarker.charAt(0) && fence[2]!.length >= fenceMarker.length) {
        fenceMarker = null;
      }
      continue;
    }
    if (fence) {
      fenceMarker = fence[2]!;
      out.push(line);
      continue;
    }
    out.push(
      transformSkippingInlineBackticks(line, (segment) =>
        findDollarMathInText(segment)
          .map((p) => (p.type === 'text' ? p.value : toDjotNativeMath(p.tex, p.display)))
          .join('')
      )
    );
  }

  return out.join('\n');
}

/**
 * Protect bare `$…$` / `$$…$$` from Asciidoctor (which strips `$$`) by rewriting to stem/latexmath.
 * Skips listing/literal/passthrough fences and inline backticks; math inside those is handled in HTML.
 */
export function preprocessAsciidocDollarMath(src: string): string {
  if (!src.includes('$')) return src;
  const lines = src.split('\n');
  const out: string[] = [];
  let fence: string | null = null;

  const transformProse = (line: string): string => {
    if (!line.includes('$')) return line;
    // Skip lines that are only AsciiDoc stem/latexmath macros already
    if (/^\s*(?:stem|latexmath|asciimath):/.test(line)) return line;

    return transformSkippingInlineBackticks(line, (segment) => {
      const parts = findDollarMathInText(segment);
      return parts
        .map((p) => {
          if (p.type === 'text') return p.value;
          // Passthrough keeps `\[…\]` so Asciidoctor cannot strip `$$`.
          if (p.display) return `+++\\[${p.tex}\\]+++`;
          const esc = p.tex.replace(/]/g, '\\]');
          return `latexmath:[${esc}]`;
        })
        .join('');
    });
  };

  // Also handle multiline $$ blocks outside fences
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (fence) {
      out.push(line);
      if (trimmed === fence) fence = null;
      i += 1;
      continue;
    }

    if (AD_FENCE_LINE.test(trimmed)) {
      fence = trimmed;
      out.push(line);
      i += 1;
      continue;
    }

    // Multiline display math starting on this line
    const displayStart = line.indexOf('$$');
    if (displayStart >= 0) {
      const after = line.slice(displayStart + 2);
      const sameClose = after.indexOf('$$');
      if (sameClose >= 0) {
        out.push(transformProse(line));
        i += 1;
        continue;
      }
      // Gather until closing $$
      const before = line.slice(0, displayStart);
      const buf: string[] = [after];
      let j = i + 1;
      let closed = false;
      let trailing = '';
      for (; j < lines.length; j++) {
        const L = lines[j]!;
        const c = L.indexOf('$$');
        if (c >= 0) {
          buf.push(L.slice(0, c));
          trailing = L.slice(c + 2);
          closed = true;
          break;
        }
        buf.push(L);
      }
      if (closed) {
        const tex = buf.join('\n').trim();
        if (isAcceptableMathBody(tex, { display: true, explicit: false })) {
          if (before) out.push(transformProse(before));
          out.push('[latexmath]');
          out.push('++++');
          out.push(tex);
          out.push('++++');
          if (trailing.trim()) out.push(transformProse(trailing));
          i = j + 1;
          continue;
        }
      }
    }

    out.push(transformProse(line));
    i += 1;
  }

  return out.join('\n');
}

function transformSkippingInlineBackticks(line: string, transform: (segment: string) => string): string {
  if (!line.includes('`')) return transform(line);
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const open = line.indexOf('`', i);
    if (open < 0) {
      out.push(transform(line.slice(i)));
      break;
    }
    if (open > i) out.push(transform(line.slice(i, open)));
    let ticks = 0;
    while (line[open + ticks] === '`') ticks += 1;
    const close = line.indexOf('`'.repeat(ticks), open + ticks);
    if (close < 0) {
      out.push(line.slice(open));
      break;
    }
    // Keep backtick spans intact (HTML pass renders math inside <code>)
    out.push(line.slice(open, close + ticks));
    i = close + ticks;
  }
  return out.join('');
}
