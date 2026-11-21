/**
 * R9: export. `refreshPictures`, `editor.getHTML()` with pictures, `figureToMarkdown` and `docToMarkdown`.
 * Docs: design.md section 12 and 1.7, requirements R9.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { docToMarkdown, figureToMarkdown, refreshPictures } from '../../src/index';
import { Viewport, boxes, destroyAll, docOf, figureAttrs, figureJson, makeEditor, para, undoSteps } from './helpers';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Viewport);
});
afterEach(() => {
  destroyAll();
  Viewport.reset();
  vi.unstubAllGlobals();
});

const PIC = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

/** The SVG text inside a `data:image/svg+xml` URL. */
function svgOf(url: string): string {
  const comma = url.indexOf(',');
  const head = url.slice(0, comma);
  const body = url.slice(comma + 1);
  return head.includes(';base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
}

/** An editor whose figures are all out of view, so nothing mounts. */
function quiet(content: JSONContent) {
  const made = makeEditor(content);
  for (const b of boxes(made.editor)) Viewport.set(b, false);
  return made;
}

const three = () =>
  docOf(
    figureJson({ id: 'fig_1', script: 'f(x) = x^2\nP = (1, 1)', mode: 'graphing', width: 'full', height: 300 }),
    figureJson({ id: 'fig_2', script: 'A = (0, 0)\nB = (3, 4)\ns = Segment(A, B)', mode: 'geometry', width: 480, height: 240 }),
    figureJson({ id: 'fig_3', script: 'a = 1', mode: 'figure', width: 'full', height: 200 }),
    para('x'),
  );

describe('refreshPictures (R9.1)', () => {
  it('makes each figure\'s picture again as an SVG data URL, without mounting anything', async () => {
    const { editor } = quiet(three());
    const report = await refreshPictures(editor);
    expect(report.failed).toEqual([]);
    expect(report.updated).toBe(3);
    for (const id of ['fig_1', 'fig_2', 'fig_3']) {
      const pic = figureAttrs(editor, id)?.picture;
      expect(pic, id).toMatch(/^data:image\/svg\+xml/);
      expect(svgOf(pic as string)).toContain('<svg');
    }
    expect(document.querySelectorAll('.inc-app')).toHaveLength(0);
    expect(editor.view.dom.querySelectorAll('.inc-tt-box[data-state="live"]')).toHaveLength(0);
  });

  it('draws a figure at its own size, and a full-width figure at 720 px', async () => {
    const { editor } = quiet(three());
    await refreshPictures(editor);
    const full = svgOf(figureAttrs(editor, 'fig_1')?.picture as string);
    expect(full).toMatch(/width="720(px)?"/);
    expect(full).toMatch(/height="300(px)?"/);
    const px = svgOf(figureAttrs(editor, 'fig_2')?.picture as string);
    expect(px).toMatch(/width="480(px)?"/);
    expect(px).toMatch(/height="240(px)?"/);
  });

  it('draws different pictures for different scripts', async () => {
    const { editor } = quiet(three());
    await refreshPictures(editor);
    const a = figureAttrs(editor, 'fig_1')?.picture;
    const b = figureAttrs(editor, 'fig_2')?.picture;
    expect(a).not.toBe(b);
  });

  it('writes all pictures in one transaction that is not an undo step', async () => {
    const { editor } = quiet(three());
    let changes = 0;
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) changes++;
    });
    const steps = undoSteps(editor);
    await refreshPictures(editor);
    expect(changes).toBe(1);
    expect(undoSteps(editor)).toBe(steps);
  });

  it('leaves the scripts and other attributes as they were', async () => {
    const { editor } = quiet(three());
    await refreshPictures(editor);
    expect(figureAttrs(editor, 'fig_2')).toMatchObject({ script: 'A = (0, 0)\nB = (3, 4)\ns = Segment(A, B)', mode: 'geometry', width: 480, height: 240, caption: '', version: 1 });
  });

  it('reports a figure it could not draw in "failed" with its id and an error, and still draws the others', async () => {
    const content = docOf(figureJson({ id: 'fig_bad', script: 'x = 1\n'.repeat(20000) }), figureJson({ id: 'fig_ok', script: 'a = 1', mode: 'figure', height: 200 }), para('x'));
    const { editor } = quiet(content);
    const report = await refreshPictures(editor);
    expect(report.failed.map((f) => f.id)).toContain('fig_bad');
    const e = report.failed.find((f) => f.id === 'fig_bad')?.error;
    expect(e?.ok).toBe(false);
    expect(e?.message.length).toBeGreaterThan(0);
    expect(figureAttrs(editor, 'fig_ok')?.picture).toMatch(/^data:image\/svg\+xml/);
    expect(report.updated).toBe(1);
  });

  it('accounts for a 3D figure (PNG, which needs a canvas outside a browser) without throwing', async () => {
    const content = docOf(figureJson({ id: 'fig_3d', script: 'A = (1, 2, 3)', mode: 'graphing3d', height: 240 }), para('x'));
    const { editor } = quiet(content);
    const report = await refreshPictures(editor);
    const updated = report.updated;
    const failed = report.failed.filter((f) => f.id === 'fig_3d');
    expect(updated + failed.length).toBe(1);
    if (updated === 1) expect(figureAttrs(editor, 'fig_3d')?.picture).toMatch(/^data:image\/png/);
    else expect(failed[0]?.error.kind).toBe('export_failed');
  });

  it('does nothing for a document with no figure', async () => {
    const { editor } = makeEditor(docOf(para('text')));
    const report = await refreshPictures(editor);
    expect(report).toEqual({ updated: 0, failed: [] });
  });
});

describe('getHTML after a refresh (R9.2)', () => {
  it('writes each figure as its picture with the script kept as data', async () => {
    const { editor } = quiet(three());
    await refreshPictures(editor);
    const dom = new DOMParser().parseFromString(editor.getHTML(), 'text/html');
    const figs = Array.from(dom.querySelectorAll('figure[data-incantly-figure]'));
    expect(figs).toHaveLength(3);
    for (const f of figs) expect(f.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(figs[1]?.textContent).toContain('s = Segment(A, B)');
  });
});

describe('figureToMarkdown (R9.2)', () => {
  it('writes the picture as an image, then the script in a fenced incantly block', () => {
    const md = figureToMarkdown({ script: 'f(x) = x^2\nP = (1, 1)', caption: 'A parabola', picture: PIC });
    expect(md).toContain(`![A parabola](${PIC})`);
    expect(md).toMatch(/```incantly\nf\(x\) = x\^2\nP = \(1, 1\)\n```/);
    expect(md.indexOf('![')).toBeLessThan(md.indexOf('```incantly'));
  });

  it('writes the block even when there is no picture', () => {
    const md = figureToMarkdown({ script: 'a = 1', caption: '', picture: null });
    expect(md).not.toContain('![');
    expect(md).toMatch(/```incantly\na = 1\n```/);
  });

  it('keeps a script that holds backticks inside a fence that closes only at its end', () => {
    const md = figureToMarkdown({ script: 'a = 1\n# ```\nb = 2', caption: '', picture: null });
    const lines = md.split('\n');
    const open = lines[0] as string;
    expect(open.startsWith('```')).toBe(true);
    expect(open.endsWith('incantly')).toBe(true);
    const fence = open.slice(0, open.indexOf('incantly'));
    expect(lines[lines.length - 1]).toBe(fence);
    expect(lines.slice(1, -1).some((l) => l.startsWith(fence))).toBe(false);
  });
});

describe('docToMarkdown (R9.2, design 12)', () => {
  const json: JSONContent = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Quadratics' }] },
      para('Some words before.'),
      figureJson({ id: 'fig_m', script: 'f(x) = x^2\nk = 3', caption: 'The parabola', picture: PIC }),
      { type: 'paragraph', content: [{ type: 'text', text: 'It is ' }, { type: 'incantlyFormula', attrs: { expr: 'k * 2', figure: 'fig_m', format: '' } }, { type: 'text', text: ' here.' }] },
    ],
  };

  it('writes headings and paragraphs as Markdown', () => {
    const md = docToMarkdown(json);
    expect(md).toContain('## Quadratics');
    expect(md).toContain('Some words before.');
  });

  it('writes the figure as its picture and its script in an incantly block', () => {
    const md = docToMarkdown(json);
    expect(md).toContain(`![The parabola](${PIC})`);
    expect(md).toMatch(/```incantly\nf\(x\) = x\^2\nk = 3\n```/);
  });

  it('writes a formula as its value in backticks', () => {
    const md = docToMarkdown(json);
    expect(md).toContain('It is `6` here.');
  });

  it('writes any other node as its text', () => {
    const md = docToMarkdown({ type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted words' }] }] }] });
    expect(md).toContain('quoted words');
  });

  it('keeps the order of the document', () => {
    const md = docToMarkdown(json);
    expect(md.indexOf('Quadratics')).toBeLessThan(md.indexOf('Some words'));
    expect(md.indexOf('Some words')).toBeLessThan(md.indexOf('```incantly'));
    expect(md.indexOf('```incantly')).toBeLessThan(md.indexOf('It is'));
  });

  it('does not throw for an empty document or one with a figure of bad attributes', () => {
    expect(() => docToMarkdown({ type: 'doc', content: [] })).not.toThrow();
    expect(() => docToMarkdown(docOf(figureJson({ id: 'fig_b', height: 'tall' })))).not.toThrow();
  });
});
