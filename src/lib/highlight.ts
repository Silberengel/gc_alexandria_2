import hljs from 'highlight.js/lib/common';

hljs.configure({ ignoreUnescapedHTML: true });

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Colorize Asciidoctor `pre.highlight > code.language-*` blocks with highlight.js.
 * Works in browser and Node (no DOM required).
 */
export function highlightAsciidoctorHtml(html: string): string {
  if (!html.includes('language-') && !html.includes('data-lang=')) return html;

  return html.replace(
    /<pre([^>]*\bclass="[^"]*\bhighlight\b[^"]*"[^>]*)>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (full, preAttrs: string, codeAttrs: string, body: string) => {
      if (body.includes('hljs-')) return full;

      const langFromClass = /\blanguage-([\w#+.-]+)\b/i.exec(codeAttrs)?.[1];
      const langFromData = /\bdata-lang=["']?([\w#+.-]+)/i.exec(codeAttrs)?.[1];
      let lang = (langFromClass || langFromData || '').replace(/^language-/i, '');
      if (/^none$/i.test(lang)) lang = '';

      const source = decodeBasicEntities(body);
      if (!lang) {
        const trimmed = source.trim();
        if (
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
          lang = 'json';
        }
      }
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

      let attrs = codeAttrs;
      if (!/\bhljs\b/.test(attrs)) {
        attrs = /\bclass="/i.test(attrs)
          ? attrs.replace(/\bclass="/i, 'class="hljs ')
          : `${attrs} class="hljs"`;
      }
      return `<pre${preAttrs}><code${attrs}>${value}</code></pre>`;
    }
  );
}
