/** Export (.kiro/specs/sdk R4; embed-files-export design 5, errors 4). */
import { describe, expect, it } from 'vitest';
import { EXPORT_LIMITS, SvgContext, createHeadlessApp } from '../../src/index';
import type { ApiError, CanvasFactory, ExportResult } from '../../src/index';

const done = (r: ExportResult | ApiError): ExportResult => {
  if (!r.ok) throw new Error(r.message);
  return r;
};
const refused = (r: ExportResult | ApiError): ApiError => {
  if (r.ok) throw new Error('expected an export error');
  return r;
};

describe('SVG (design 5.1)', () => {
  it('draws the figure as the screen does: points, curves, labels, axes', async () => {
    const app = createHeadlessApp({ mode: 'classic', script: '@view -5 5 -5 5\nA = (1, 2)\nc = Circle((0, 0), 2)\nf(x) = x^2', size: { width: 400, height: 400 } });
    const r = done(await app.export({ format: 'svg' }));
    expect(r).toMatchObject({ format: 'svg', width: 400, height: 400 });
    const svg = r.text as string;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"')).toBe(true);
    expect(svg).toContain('<rect width="100%" height="100%" fill="#ffffff"/>');
    // the point A at (1, 2): x = 200 + 40, y = 200 - 80
    expect(svg).toMatch(/<text [^>]*>A<\/text>/);
    expect(svg).toMatch(/M240 120|M24\d(\.\d+)? 12\d/);
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(5);
    expect(r.blob.type).toBe('image/svg+xml');
    expect(r.bytes).toBe(r.blob.size);
  });

  it('transparent leaves the background out; region all fits the objects', async () => {
    const app = createHeadlessApp({ script: 'A = (100, 100)\nB = (110, 105)' });
    const r = done(await app.export({ format: 'svg', transparent: true, region: 'all' }));
    expect(r.text).not.toContain('fill="#ffffff"');
    expect(r.text).toMatch(/<text [^>]*>A<\/text>/);
  });

  it('the axes and grid follow the figure', async () => {
    const on = done(await createHeadlessApp({ script: 'A = (1, 1)' }).export({ format: 'svg' })).text as string;
    const off = done(await createHeadlessApp({ script: '@axes off\n@grid off\nA = (1, 1)' }).export({ format: 'svg' })).text as string;
    expect(off.length).toBeLessThan(on.length);
    expect((off.match(/<path /g) ?? []).length).toBeLessThan(5);
  });
});

describe('PNG (design 5.1)', () => {
  /** A canvas that records into SVG and says how big it was made. */
  const made: { w: number; h: number }[] = [];
  const canvas: CanvasFactory = (w, h) => {
    made.push({ w, h });
    const ctx = new SvgContext(w, h);
    return { getContext: () => ctx, toBlob: (cb) => cb(new Blob([ctx.toString()], { type: 'image/png' })) };
  };

  it('renders at the scale asked, not by stretching pixels', async () => {
    const app = createHeadlessApp({ script: 'A = (1, 2)', size: { width: 300, height: 200 } });
    const r = done(await app.export({ format: 'png', scale: 3 }, { canvas }));
    expect(r).toMatchObject({ format: 'png', width: 900, height: 600 });
    expect(made.at(-1)).toEqual({ w: 900, h: 600 });
  });

  it('without a canvas it says so', async () => {
    const app = createHeadlessApp({ script: 'A = (1, 2)' });
    expect(refused(await app.export({ format: 'png' }, { canvas: () => undefined }))).toMatchObject({ area: 'export', kind: 'export_unsupported', detail: { supported: ['svg'] } });
  });

  it('beyond 8192 px a side or 64 megapixels is export_too_large with the largest scale', async () => {
    const app = createHeadlessApp({ size: { width: 1200, height: 800 } });
    const e = refused(await app.export({ format: 'png', scale: 8 }, { canvas }));
    expect(e).toMatchObject({ kind: 'export_too_large', detail: { limitMegapixels: EXPORT_LIMITS.megapixels } });
    expect((e.detail as { maxScale: number }).maxScale).toBe(6.8);
  });
});

describe('errors and time (errors 4; design 5.2)', () => {
  it('formats not in this build', async () => {
    const e = refused(await createHeadlessApp().export({ format: 'gif' }));
    expect(e).toMatchObject({ kind: 'export_unsupported', detail: { supported: ['png', 'svg'] } });
  });

  it('nothing to show is export_empty', async () => {
    expect(refused(await createHeadlessApp().export({ format: 'svg', region: 'all' })).kind).toBe('export_empty');
  });

  it('a time outside the film is export_bad_time', async () => {
    const app = createHeadlessApp({ script: '@clock 0..10\nP = (t, 0)' });
    expect(refused(await app.export({ format: 'svg', t: 20 })).kind).toBe('export_bad_time');
  });

  it('a time is drawn on a copy: the live figure does not move', async () => {
    const app = createHeadlessApp({ script: '@clock 0..10\n@view -1 11 -6 6\nP = (t, 0)', size: { width: 600, height: 600 } });
    const now = done(await app.export({ format: 'svg' })).text as string;
    const later = done(await app.export({ format: 'svg', t: 8 })).text as string;
    expect(later).not.toBe(now);
    expect(app.clock.t).toBe(0);
    expect(app.value('P')).toEqual({ x: 0, y: 0 });
  });
});
