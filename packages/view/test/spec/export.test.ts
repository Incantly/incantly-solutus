/**
 * graphics-view/design.md 14 (export): request validation, regions,
 * viewports, and the deterministic SVG surface.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_EXPORT_SIDE_PX,
  MAX_SVG_ELEMENTS,
  SvgSurface,
  exportViewport,
  maths,
  normalizeExport,
  svgEscape,
  svgId,
  svgRound,
} from '@incantly/view';
import type { ExportContext, ExportRequest } from '@incantly/view';
import { errOf, okValue } from './helpers';

const VIEW = { x0: maths(-8), x1: maths(8), y0: maths(-6), y1: maths(6) };

function ctx(over: Partial<ExportContext> = {}): ExportContext {
  return { viewBounds: VIEW, objectBounds: [], nowT: 1.5, equalRatio: true, pxPerUnit: 50, ...over };
}

function req(over: Partial<ExportRequest> = {}): ExportRequest {
  return { format: 'svg', region: 'view', background: 'view', includeGrid: true, includeAxes: true, ...over };
}

describe('design 14.1 export requests', () => {
  it('14.1 view region uses the current bounds; defaults apply', () => {
    const e = okValue(normalizeExport(req(), ctx()), 'view');
    expect(e.region).toEqual(VIEW);
    expect(e.format).toBe('svg');
    expect(e.scale).toBe(1);
    expect(e.layers).toBe('all');
    expect(e.includeWidgets).toBe(false);
    expect(e.time).toBeNull();
    expect(e.textAs).toBe('text');
  });

  it('14.1 default output is 1200 wide with the region aspect', () => {
    const e = okValue(normalizeExport(req(), ctx()), 'dflt');
    expect(e.widthPx).toBe(1200);
    expect(e.heightPx).toBe(900);
  });

  it('14.1 explicit size keeps aspect; scale is preserved for the canvas', () => {
    const e = okValue(normalizeExport(req({ size: { widthPx: 600 } }), ctx()), 'size');
    expect(e.widthPx).toBe(600);
    expect(e.heightPx).toBe(450);
    const s2 = okValue(normalizeExport(req({ size: { widthPx: 600 }, scale: 2 }), ctx()), 'scale');
    expect(s2.widthPx).toBe(600);
    expect(s2.heightPx).toBe(450);
    expect(s2.scale).toBe(2);
  });

  it('14.1 explicit height wins over aspect', () => {
    const e = okValue(normalizeExport(req({ size: { widthPx: 600, heightPx: 600 } }), ctx()), 'h');
    expect(e.widthPx).toBe(600);
    expect(e.heightPx).toBe(600);
  });

  it('14.2 objects region unions bboxes with a 5% pad', () => {
    const e = okValue(
      normalizeExport(req({ region: 'objects' }), ctx({
        objectBounds: [
          { x0: maths(0), x1: maths(10), y0: maths(0), y1: maths(10) },
          { x0: maths(-2), x1: maths(2), y0: maths(1), y1: maths(3) },
        ],
      })),
      'objects',
    );
    expect(e.region.x0).toBeLessThanOrEqual(-2);
    expect(e.region.x1).toBeGreaterThanOrEqual(10);
    const w = e.region.x1 - e.region.x0;
    // 5% of 12 units on each side is 0.6; 12 px at 50 px/unit is only 0.24, so 5% wins.
    expect(w).toBeGreaterThanOrEqual(12.5);
    expect(w).toBeLessThanOrEqual(13.2);
  });

  it('14.2 objects pad is at least 12 px on each side (0.24 units at 50 px/unit)', () => {
    const e = okValue(
      normalizeExport(req({ region: 'objects' }), ctx({
        objectBounds: [{ x0: maths(0), x1: maths(1), y0: maths(0), y1: maths(1) }],
      })),
      'minpad',
    );
    // 5% of 1 unit is 0.05, below 12 px = 0.24 units, so the pad is 0.24 each side: width >= 1.48.
    expect(e.region.x1 - e.region.x0).toBeGreaterThanOrEqual(1.48 - 1e-9);
    expect(e.region.x1 - e.region.x0).toBeLessThanOrEqual(2);
    expect(e.region.x0).toBeLessThanOrEqual(-0.24 + 1e-9);
  });

  it('14.2 the pixel minimum follows the source scale (100 px/unit gives 0.12 units)', () => {
    const e = okValue(
      normalizeExport(req({ region: 'objects' }), ctx({
        pxPerUnit: 100,
        objectBounds: [{ x0: maths(0), x1: maths(1), y0: maths(0), y1: maths(1) }],
      })),
      'minpad100',
    );
    expect(e.region.x1 - e.region.x0).toBeGreaterThanOrEqual(1.24 - 1e-9);
    expect(e.region.x1 - e.region.x0).toBeLessThanOrEqual(1.5);
  });



  it('14.2 custom regions pass through; empty ones fail', () => {
    const e = okValue(normalizeExport(req({ region: { x0: 0, x1: 2, y0: 0, y1: 2 } }), ctx()), 'custom');
    expect(e.region).toEqual({ x0: 0, x1: 2, y0: 0, y1: 2 });
    expect(normalizeExport(req({ region: { x0: 2, x1: 0, y0: 0, y1: 2 } }), ctx()).ok).toBe(false);
    expect(normalizeExport(req({ region: { x0: 0, x1: 0, y0: 0, y1: 2 } }), ctx()).ok).toBe(false);
  });

  it('14.2 layers, background, time and textAs pass through', () => {
    const e = okValue(
      normalizeExport(req({ layers: [1], background: 'transparent', time: 2.5, textAs: 'paths' }), ctx()),
      'opts',
    );
    expect(e.layers).toEqual([1]);
    expect(e.background).toBe('transparent');
    expect(e.time).toBe(2.5);
    expect(e.textAs).toBe('paths');
  });

  it('14.2 the limits are 16,384 px a side and 50,000 SVG elements', () => {
    expect(MAX_EXPORT_SIDE_PX).toBe(16384);
    expect(MAX_SVG_ELEMENTS).toBe(50000);
  });

  it('14.2 a PNG wider than 16384 px fails with limit', () => {
    const big = errOf(normalizeExport(req({ format: 'png', size: { widthPx: 20000 } }), ctx()), 'huge');
    expect(big.kind).toBe('limit');
  });

  it('14.2 a PNG exactly 16384 px wide is allowed', () => {
    expect(normalizeExport(req({ format: 'png', size: { widthPx: 16384, heightPx: 100 } }), ctx()).ok).toBe(true);
  });

  it('14.2 a PNG taller than 16384 px fails with limit', () => {
    const big = errOf(normalizeExport(req({ format: 'png', size: { widthPx: 100, heightPx: 20000 } }), ctx()), 'tall');
    expect(big.kind).toBe('limit');
  });

  it('14.2 the PNG side cap counts size times scale (canvas is size * scale)', () => {
    const e = errOf(normalizeExport(req({ format: 'png', scale: 3, size: { widthPx: 6000 } }), ctx()), 'scaled');
    expect(e.kind).toBe('limit');
    expect(normalizeExport(req({ format: 'png', scale: 3, size: { widthPx: 600 } }), ctx()).ok).toBe(true);
  });

  it('14.2 a zero or negative size fails (bad_export reads as a core error)', () => {
    expect(normalizeExport(req({ size: { widthPx: 0 } }), ctx()).ok).toBe(false);
    expect(normalizeExport(req({ size: { widthPx: -5 } }), ctx()).ok).toBe(false);
    expect(normalizeExport(req({ size: { widthPx: 100, heightPx: 0 } }), ctx()).ok).toBe(false);
  });



  it('14.2 unknown formats fail', () => {
    expect(normalizeExport(req({ format: 'pdf' as never }), ctx()).ok).toBe(false);
  });

  it('14.2 export viewports keep equal ratio from an equal source', () => {
    const e = okValue(normalizeExport(req({ region: { x0: 0, x1: 10, y0: 0, y1: 6 }, size: { widthPx: 1000 } }), ctx()), 'eq');
    const v = okValue(exportViewport(e, true), 'viewport');
    expect(v.scaleX).toBe(v.scaleY);
    expect(v.width).toBe(1000);
  });

  it('14.2 export viewports follow the region exactly for free sources', () => {
    const e = okValue(normalizeExport(req({ region: { x0: 0, x1: 10, y0: 0, y1: 5 }, size: { widthPx: 1000, heightPx: 1000 } }), ctx()), 'free');
    const v = okValue(exportViewport(e, false), 'viewport');
    expect(v.scaleX).toBe(100);
    expect(v.scaleY).toBe(200);
  });
});

describe('design 14.2 svg helpers', () => {
  it('14.2 svgRound keeps 2 decimals', () => {
    expect(svgRound(10.126)).toBe(10.13);
    expect(svgRound(10.124)).toBe(10.12);
    expect(svgRound(5)).toBe(5);
  });

  it('14.2 svgEscape escapes markup', () => {
    expect(svgEscape('<a>&"b"')).toBe('&lt;a&gt;&amp;&quot;b&quot;');
  });

  it('14.2 svgId keeps names usable and deterministic', () => {
    expect(svgId('A')).toBe('A');
    expect(svgId('a b')).not.toContain(' ');
    expect(svgId('a b')).toBe(svgId('a b'));
  });
});

describe('design 14.2 the svg surface', () => {
  const stroke = { color: { r: 1, g: 0, b: 0, a: 1 }, width: 2, dash: [] as const, dashPhase: 0, cap: 'butt', join: 'miter', miterLimit: 4, opacity: 1 } as const;
  const textStyle = { size: 14, bold: false, italic: false, family: 'f', align: 'left', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, background: 'none' } as const;

  it('14.5 same calls give the same bytes', () => {
    const paint = (s: SvgSurface): void => {
      s.setCurrentId('c');
      s.path(new Float32Array([0, 0, 10.126, 10.129]));
      s.stroke({ ...stroke, dash: [4, 3] });
      s.setCurrentId('c');
      s.text({ text: 'hi', math: false }, { x: 5, y: 6 } as never, textStyle);
    };
    const a = new SvgSurface({ textAs: 'text' });
    paint(a);
    const b = new SvgSurface({ textAs: 'text' });
    paint(b);
    expect(a.toString(100, 80, { r: 1, g: 1, b: 1, a: 1 })).toBe(b.toString(100, 80, { r: 1, g: 1, b: 1, a: 1 }));
  });

  it('14.2 curve paths emit with 2 decimals, dashes and ids', () => {
    const s = new SvgSurface({ textAs: 'text' });
    s.setCurrentId('c');
    s.path(new Float32Array([0, 0, 10.126, 10.129]));
    s.stroke({ ...stroke, dash: [4, 3] });
    const doc = s.toString(100, 80, { r: 1, g: 1, b: 1, a: 1 });
    expect(doc).toContain('d="M0,0L10.13,10.13"');
    expect(doc).toContain('stroke-dasharray="4,3"');
    expect(doc).toContain('id="c"');
  });

  it('14.2 repeated ids stay unique with deterministic suffixes', () => {
    const s = new SvgSurface({ textAs: 'text' });
    s.setCurrentId('c');
    s.path(new Float32Array([0, 0, 1, 1]));
    s.stroke(stroke);
    s.setCurrentId('c');
    s.path(new Float32Array([0, 0, 2, 2]));
    s.stroke(stroke);
    const doc = s.toString(100, 80, { r: 1, g: 1, b: 1, a: 1 });
    expect(doc).toContain('id="c"');
    expect(doc).toContain('id="c-2"');
  });

  it('14.2 hatch fills become pattern defs; clips become clipPaths', () => {
    const s = new SvgSurface({ textAs: 'text' });
    s.path(new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]));
    s.fill({ kind: 'hatch', spec: { kind: 'lines', angle: 45, spacing: 8 }, color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 0.2 });
    s.clipRect({ x0: 0, x1: 50, y0: 0, y1: 50 } as never);
    const doc = s.toString(100, 80, { r: 1, g: 1, b: 1, a: 1 });
    expect(doc).toContain('<pattern');
    expect(doc).toContain('url(#');
    expect(doc).toContain('<clipPath');
  });

  it('14.2 labels emit as text, or as paths when glyphs are supplied', () => {
    const t = new SvgSurface({ textAs: 'text' });
    t.text({ text: 'A', math: false }, { x: 5, y: 6 } as never, textStyle);
    expect(t.toString(100, 80, { r: 1, g: 1, b: 1, a: 1 })).toContain('<text');
    const p = new SvgSurface({ textAs: 'paths', glyphPath: () => 'M0,0L1,1' });
    p.text({ text: 'A', math: false }, { x: 5, y: 6 } as never, textStyle);
    const doc = p.toString(100, 80, { r: 1, g: 1, b: 1, a: 1 });
    expect(doc).not.toContain('<text');
    expect(doc).toContain('<path');
  });

  it('14.2 paths mode without glyphs falls back to text (keeps working)', () => {
    const p = new SvgSurface({ textAs: 'paths' });
    p.text({ text: 'A', math: false }, { x: 5, y: 6 } as never, textStyle);
    expect(p.toString(100, 80, { r: 1, g: 1, b: 1, a: 1 })).toContain('<text');
  });

  it('14.2 elementCount tracks painted elements for the cap', () => {
    const s = new SvgSurface({ textAs: 'text' });
    expect(s.elementCount).toBe(0);
    s.path(new Float32Array([0, 0, 1, 1]));
    s.stroke(stroke);
    s.text({ text: 'A', math: false }, { x: 5, y: 6 } as never, textStyle);
    expect(s.elementCount).toBe(2);
  });

  it('14.2 documents carry size, background and defs', () => {
    const s = new SvgSurface({ textAs: 'text' });
    const doc = s.toString(1200, 900, { r: 255, g: 255, b: 255, a: 1 });
    expect(doc).toContain('width="1200"');
    expect(doc).toContain('viewBox="0 0 1200 900"');
    expect(doc).toContain('<defs>');
    expect(doc).toContain('fill="rgb(255,255,255)"');
    const none = s.toString(100, 80, 'none');
    expect(none).not.toContain('<rect');
  });

  it('14.2 images link by href set by the host', () => {
    const s = new SvgSurface({ textAs: 'text' });
    s.setImageHref('logo', 'data:image/png;base64,xx');
    s.image({ key: 'logo', widthPx: 10, heightPx: 10 }, { x0: 0, x1: 10, y0: 0, y1: 10 } as never, 1);
    expect(s.toString(100, 80, { r: 1, g: 1, b: 1, a: 1 })).toContain('<image');
  });

  it('14.2 save/restore group elements; measure stays deterministic', () => {
    const s = new SvgSurface({ textAs: 'text' });
    s.save();
    s.path(new Float32Array([0, 0, 1, 1]));
    s.stroke(stroke);
    s.restore();
    expect(s.toString(100, 80, { r: 1, g: 1, b: 1, a: 1 })).toContain('<g');
    expect(s.measure({ text: 'hello', math: false }, textStyle).width).toBe(42);
  });
});
