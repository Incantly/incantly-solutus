/** Full LaTeX through KaTeX (text-logic design 6.4): loaded on demand, `$…$` parts rendered, the rest escaped. */
import { describe, expect, it } from 'vitest';
import { fullLatexHtml, fullLatexReady, loadFullLatex } from '../src/katex';

describe('full LaTeX', () => {
  it('loads on demand and renders macros the subset lacks', async () => {
    expect(await loadFullLatex()).toBe(true);
    expect(fullLatexReady()).toBe(true);
    const html = fullLatexHtml('Stokes: $\\oint_{\\partial S} \\mathbf{F}$') as string;
    expect(html.startsWith('Stokes: ')).toBe(true);
    expect(html).toContain('class="katex"');
    expect(html).toContain('∮');
  });

  it('escapes the plain parts and keeps an unclosed $ as text', async () => {
    await loadFullLatex();
    expect(fullLatexHtml('<b>a</b> costs $5')).toBe('&lt;b&gt;a&lt;/b&gt; costs $5');
  });

  it('never makes a link, even from \\href', async () => {
    await loadFullLatex();
    const html = fullLatexHtml('$\\href{javascript:alert(1)}{x}$') as string;
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('javascript:');
  });

  it('shows a bad formula in place instead of failing', async () => {
    await loadFullLatex();
    const html = fullLatexHtml('$\\frac{1}$') as string;
    expect(html.length).toBeGreaterThan(0);
  });
});
