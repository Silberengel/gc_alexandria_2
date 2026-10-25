import katex from 'katex';

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function renderTex(tex: string, displayMode: boolean): string {
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
    return displayMode ? `\\[${tex}\\]` : `\\(${tex}\\)`;
  }
}

/**
 * Replace Asciidoctor latexmath / stem (TeX) delimiters with KaTeX HTML.
 * Inline: `\(...\)`  ·  Display: `\[...\]`
 */
export function renderAsciidoctorMath(html: string): string {
  if (!html.includes('\\(') && !html.includes('\\[')) return html;

  let out = html.replace(/\\\[([\s\S]+?)\\\]/g, (_full, tex: string) => renderTex(tex, true));
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_full, tex: string) => renderTex(tex, false));
  return out;
}
