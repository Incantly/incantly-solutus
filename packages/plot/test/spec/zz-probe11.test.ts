/** TEMP PROBE 11 - deleted before commit. Corner output composition. */
import { describe, expect, it } from 'vitest';
import { fillRegion } from '@incantly/plot';

describe('probe11', () => {
  it('corner output', () => {
    const V = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 600, heightPx: 600 };
    const p = fillRegion(
      {
        test: (x, y) => x > 0 && y > 0,
        boundaries: [
          { residual: (x, _y) => x, strict: true, enclosure: (x0, x1) => ({ lo: x0, hi: x1, def: 2 }) },
          { residual: (_x, y) => y, strict: true, enclosure: (_x0, _x1, y0, y1) => ({ lo: y0, hi: y1, def: 2 }) },
        ],
        enclosure: (x0, x1, y0, y1) => {
          const ax = x0 > 0 ? 'true' : x1 <= 0 ? 'false' : 'maybe';
          const ay = y0 > 0 ? 'true' : y1 <= 0 ? 'false' : 'maybe';
          if (ax === 'false' || ay === 'false') return 'false';
          if (ax === 'true' && ay === 'true') return 'true';
          return 'maybe';
        },
      },
      V,
    );
    if (!p.ok) throw new Error('fill failed');
    console.log(`rects=${p.value.rects.length / 4} polys=${p.value.polygons.length} borders=${p.value.borders.length}`);
    // smallest rects (sub-cell fills?)
    const areas: number[] = [];
    for (let i = 0; i + 3 < p.value.rects.length; i += 4) {
      areas.push(Math.abs((p.value.rects[i + 2] ?? 0) - (p.value.rects[i] ?? 0)) * Math.abs((p.value.rects[i + 3] ?? 0) - (p.value.rects[i + 1] ?? 0)));
    }
    areas.sort((a, b) => a - b);
    console.log(`smallest rect areas: ${areas.slice(0, 8).join(',')}`);
    // any output within 3px of origin (300,300)?
    let near = 0;
    for (let i = 0; i + 3 < p.value.rects.length; i += 4) {
      const cx = ((p.value.rects[i] ?? 0) + (p.value.rects[i + 2] ?? 0)) / 2;
      const cy = ((p.value.rects[i + 1] ?? 0) + (p.value.rects[i + 3] ?? 0)) / 2;
      if (Math.hypot(cx - 300, cy - 300) < 3) near += 1;
    }
    console.log(`rects near origin: ${near}`);
    expect(true).toBe(true);
  });
});
