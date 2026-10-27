import hljs from 'highlight.js/lib/common';
import { isMathCodeBlock } from './katex-math';

hljs.configure({ ignoreUnescapedHTML: true });

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function ensureClass(attrs: string, className: string): string {
  if (new RegExp(`\\b${className}\\b`).test(attrs)) return attrs;
  if (/\bclass="/i.test(attrs)) {
    return attrs.replace(/\bclass="/i, `class="${className} `);
  }
  if (/\bclass='/i.test(attrs)) {
    return attrs.replace(/\bclass='/i, `class='${className} `);
  }
  return `${attrs} class="${className}"`;
}

function guessLang(source: string, declared: string): string {
  let lang = declared.replace(/^language-/i, '');
  if (/^none$/i.test(lang)) lang = '';
  if (lang) return lang;
  const trimmed = source.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return 'json';
  }
  return '';
}

/**
 * Colorize fenced / listing `pre > code` blocks with highlight.js.
 * Covers Asciidoctor (`pre.highlight > code.language-*`) and Djot/markdown
 * (`pre > code.language-*`). Adds `highlight` / `hljs` classes so the shared
 * theme CSS applies.
 */
export function highlightCodeBlocks(html: string): string {
  if (!html.includes('<pre') || !html.includes('<code')) return html;

  return html.replace(
    /<pre([^>]*)>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (full, preAttrs: string, codeAttrs: string, body: string) => {
      if (body.includes('hljs-')) return full;

      const langFromClass = /\blanguage-([\w#+.-]+)\b/i.exec(codeAttrs)?.[1];
      const langFromData = /\bdata-lang=["']?([\w#+.-]+)/i.exec(codeAttrs)?.[1];
      const source = decodeBasicEntities(body);
      const declared = langFromClass || langFromData || '';
      // Leave latex/tex/math (and `$…$`-wrapped bodies) for KaTeX.
      if (isMathCodeBlock(source, declared)) return full;
      const lang = guessLang(source, declared);
      if (!lang) return full;

      const resolved = hljs.getLanguage(lang) ? lang : lang.toLowerCase();
      let value: string;
      try {
        value = hljs.getLanguage(resolved)
          ? hljs.highlight(source, { language: resolved, ignoreIllegals: true }).value
          : hljs.highlightAuto(source).value;
      } catch {
        return full;
      }

      const newPreAttrs = ensureClass(ensureClass(preAttrs, 'highlight'), 'highlightjs');
      const newCodeAttrs = ensureClass(codeAttrs, 'hljs');
      return `<pre${newPreAttrs}><code${newCodeAttrs}>${value}</code></pre>`;
    }
  );
}

/** @deprecated Prefer {@link highlightCodeBlocks}; kept for AsciiDoc call sites. */
export const highlightAsciidoctorHtml = highlightCodeBlocks;
