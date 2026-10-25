import { describe, expect, it } from 'vitest';
import { highlightAsciidoctorHtml } from './highlight';

describe('highlightAsciidoctorHtml', () => {
  it('colorizes language-tagged listing blocks', () => {
    const input = `<div class="listingblock">
<div class="content">
<pre class="highlightjs highlight"><code class="language-json hljs" data-lang="json">{"a":1}</code></pre>
</div>
</div>`;
    const out = highlightAsciidoctorHtml(input);
    expect(out).toContain('hljs-attr');
    expect(out).toContain('hljs-number');
    expect(out).toContain('&quot;a&quot;');
  });

  it('leaves already-highlighted markup alone', () => {
    const input =
      '<pre class="highlight"><code class="language-js hljs"><span class="hljs-keyword">const</span> x</code></pre>';
    expect(highlightAsciidoctorHtml(input)).toBe(input);
  });

  it('skips blocks without a language', () => {
    const input = '<pre class="highlight"><code>plain</code></pre>';
    expect(highlightAsciidoctorHtml(input)).toBe(input);
  });

  it('auto-detects JSON when language is missing or none', () => {
    const input =
      '<pre class="highlightjs highlight"><code class="language-none hljs">{"title":"x","n":1}</code></pre>';
    const out = highlightAsciidoctorHtml(input);
    expect(out).toContain('hljs-attr');
    expect(out).toContain('hljs-string');
    expect(out).toContain('hljs-number');
  });
});
