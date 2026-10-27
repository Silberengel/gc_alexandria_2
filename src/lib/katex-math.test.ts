import { describe, expect, it } from 'vitest';
import {
  extractWholeMath,
  findDollarMathInText,
  preprocessAsciidocDollarMath,
  preprocessDjotDollarMath,
  renderAsciidoctorMath,
  renderMathInHtml,
  renderMathInText,
  splitMathSegments
} from './katex-math';

describe('extractWholeMath', () => {
  it('extracts inline and display spans', () => {
    expect(extractWholeMath('$E=mc^2$')).toEqual({ tex: 'E=mc^2', display: false });
    expect(extractWholeMath('$$\nE = mc^2\n$$')).toEqual({ tex: 'E = mc^2', display: true });
  });

  it('rejects empty, currency-like, and placeholder bodies', () => {
    expect(extractWholeMath('$$')).toBeNull();
    expect(extractWholeMath('$ $')).toBeNull();
    expect(extractWholeMath('$...$')).toBeNull();
    expect(extractWholeMath('$10.50$')).toBeNull();
  });
});

describe('findDollarMathInText', () => {
  it('renders TeX cues and leaves currency alone', () => {
    const segs = findDollarMathInText(
      'Greek $\\Psi$ and price $10.50 and $primary-color and $E=mc^2$'
    );
    const math = segs.filter((s) => s.type === 'math');
    expect(math).toHaveLength(2);
    expect(math[0]).toMatchObject({ tex: '\\Psi', display: false });
    expect(math[1]).toMatchObject({ tex: 'E=mc^2', display: false });
    const text = segs
      .filter((s) => s.type === 'text')
      .map((s) => s.value)
      .join('');
    expect(text).toContain('$10.50');
    expect(text).toContain('$primary-color');
  });

  it('leaves empty delimiters alone', () => {
    const segs = findDollarMathInText('Empty $$\nJust $ $');
    expect(segs.every((s) => s.type === 'text')).toBe(true);
  });
});

describe('splitMathSegments', () => {
  it('promotes math in inline code and latex fences', () => {
    const segs = splitMathSegments('Inline `$E=mc^2$` and\n\n```latex\n$$\nx^2\n$$\n```\n');
    const math = segs.filter((s) => s.type === 'math');
    expect(math.some((m) => m.tex === 'E=mc^2' && !m.display)).toBe(true);
    expect(math.some((m) => m.tex.includes('x^2') && m.display)).toBe(true);
  });

  it('keeps syntax placeholders in backticks as text', () => {
    const segs = splitMathSegments('rule: `$...$` and `$$...$$`');
    expect(segs.every((s) => s.type === 'text')).toBe(true);
  });
});

describe('renderMathInHtml', () => {
  it('renders inline TeX delimiters', () => {
    const out = renderMathInHtml('<p>\\(\\frac{a}{b}\\)</p>');
    expect(out).toContain('class="katex"');
    expect(out).not.toContain('\\(');
    expect(out).toContain('katex-html');
  });

  it('renders display TeX delimiters', () => {
    const out = renderMathInHtml(
      '<div class="stemblock"><div class="content">\\[E = mc^2\\]</div></div>'
    );
    expect(out).toContain('katex-display');
    expect(out).not.toContain('\\[');
  });

  it('replaces math-only code and listings', () => {
    const inline = renderMathInHtml('<p>see <code>$E=mc^2$</code></p>');
    expect(inline).toContain('class="katex"');
    expect(inline).not.toContain('<code>');

    const block = renderMathInHtml(
      '<pre><code class="language-latex">$$\nE=mc^2\n$$\n</code></pre>'
    );
    expect(block).toContain('katex-display');
    expect(block).not.toContain('<pre>');
  });

  it('renders bare dollar math in text nodes', () => {
    const out = renderMathInHtml('<p>A $3 \\times 3$ matrix. Price $10.50</p>');
    expect(out).toContain('class="katex"');
    expect(out).toContain('$10.50');
  });

  it('leaves non-math HTML alone', () => {
    const html = '<p>no math here</p>';
    expect(renderMathInHtml(html)).toBe(html);
  });

  it('keeps renderAsciidoctorMath as an alias', () => {
    expect(renderAsciidoctorMath('<p>\\(a\\)</p>')).toContain('katex');
  });
});

describe('renderMathInText', () => {
  it('escapes prose and injects KaTeX', () => {
    const out = renderMathInText('a <b> and $\\Psi$');
    expect(out).toContain('&lt;b&gt;');
    expect(out).toContain('class="katex"');
  });
});

describe('preprocessDjotDollarMath', () => {
  it('rewrites bare dollars to native Djot math so underscores stay TeX', () => {
    const src =
      'Maxwell $\\left.\\frac{\\partial T}{\\partial P}\\right|_{s} = \\left.\\frac{\\partial v}{\\partial s}\\right|_{P}$.';
    const out = preprocessDjotDollarMath(src);
    expect(out).toContain('$`\\left.');
    expect(out).toContain('\\right|_{s}');
    expect(out).toContain('\\right|_{P}');
    expect(out).not.toMatch(/\$_/);
  });

  it('leaves inline code and fences alone', () => {
    const src = 'rule `$...$` and\n\n```latex\n$$E=mc^2$$\n```\n';
    expect(preprocessDjotDollarMath(src)).toBe(src);
  });

  it('does not let mid-line ``` abort later display math', () => {
    const src = [
      '``const price = `$${amount}```',
      '',
      '$$A=\\begin{bmatrix}1&2\\\\0&1\\end{bmatrix}$$',
      '',
      '$$\\left.\\frac{\\partial T}{\\partial P}\\right|_s=1$$'
    ].join('\n');
    const out = preprocessDjotDollarMath(src);
    expect(out).toContain('$$`A=');
    expect(out).toContain('\\right|_s');
    expect(out).toContain('$$`');
  });
});

describe('preprocessAsciidocDollarMath', () => {
  it('rewrites bare dollars so Asciidoctor cannot strip $$', () => {
    const out = preprocessAsciidocDollarMath(
      'Inline $E=mc^2$ and\n\n$$x = 1$$\n\nPrice $10.50\n'
    );
    expect(out).toContain('latexmath:[E=mc^2]');
    expect(out).toMatch(/\+\+\+\\\[/);
    expect(out).toContain('$10.50');
  });

  it('leaves listing fences alone', () => {
    const src = '[source,latex]\n----\n$$E=mc^2$$\n----\n';
    expect(preprocessAsciidocDollarMath(src)).toBe(src);
  });
});
