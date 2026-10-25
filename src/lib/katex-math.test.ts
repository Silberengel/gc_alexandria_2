import { describe, expect, it } from 'vitest';
import { renderAsciidoctorMath } from './katex-math';

describe('renderAsciidoctorMath', () => {
  it('renders inline TeX delimiters', () => {
    const out = renderAsciidoctorMath('<p>\\(\\frac{a}{b}\\)</p>');
    expect(out).toContain('class="katex"');
    expect(out).not.toContain('\\(');
    expect(out).toContain('katex-html');
  });

  it('renders display TeX delimiters', () => {
    const out = renderAsciidoctorMath(
      '<div class="stemblock"><div class="content">\\[E = mc^2\\]</div></div>'
    );
    expect(out).toContain('katex-display');
    expect(out).not.toContain('\\[');
  });

  it('leaves non-math HTML alone', () => {
    const html = '<p>no math here</p>';
    expect(renderAsciidoctorMath(html)).toBe(html);
  });
});
