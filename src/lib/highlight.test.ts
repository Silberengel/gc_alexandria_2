import { describe, expect, it } from 'vitest';
import { highlightAsciidoctorHtml, highlightCodeBlocks } from './highlight';

describe('highlightCodeBlocks', () => {
  it('colorizes language-tagged listing blocks', () => {
    const input = `<div class="listingblock">
<div class="content">
<pre class="highlightjs highlight"><code class="language-json hljs" data-lang="json">{"a":1}</code></pre>
</div>
</div>`;
    const out = highlightCodeBlocks(input);
    expect(out).toContain('hljs-attr');
    expect(out).toContain('hljs-number');
    expect(out).toContain('&quot;a&quot;');
  });

  it('colorizes Djot/markdown fenced blocks and adds highlight classes', () => {
    const input = '<pre><code class="language-json">{"a":1}\n</code></pre>';
    const out = highlightCodeBlocks(input);
    expect(out).toContain('class="highlightjs highlight"');
    expect(out).toContain('hljs-attr');
    expect(out).toContain('hljs-number');
  });

  it('leaves already-highlighted markup alone', () => {
    const input =
      '<pre class="highlight"><code class="language-js hljs"><span class="hljs-keyword">const</span> x</code></pre>';
    expect(highlightCodeBlocks(input)).toBe(input);
  });

  it('skips blocks without a language', () => {
    const input = '<pre class="highlight"><code>plain</code></pre>';
    expect(highlightCodeBlocks(input)).toBe(input);
  });

  it('auto-detects JSON when language is missing or none', () => {
    const input =
      '<pre class="highlightjs highlight"><code class="language-none hljs">{"title":"x","n":1}</code></pre>';
    const out = highlightCodeBlocks(input);
    expect(out).toContain('hljs-attr');
    expect(out).toContain('hljs-string');
    expect(out).toContain('hljs-number');
  });

  it('keeps highlightAsciidoctorHtml as an alias', () => {
    expect(highlightAsciidoctorHtml).toBe(highlightCodeBlocks);
  });
});
