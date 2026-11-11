/**
 * Implicit curve tracer.
 *
 * Docs: `docs/features/curves-loci/design.md` section 6 (quadtree with
 * certainty over 32px cells, 2px final / 6px draft leaves, corner hash,
 * marching squares with Newton-corrected crossings, saddle decider,
 * small-feature probes with isolated markers, singular joins, linking by
 * edge keys with deterministic sorted chains, closed flags, complete flag,
 * time targets). Derived quantities (tangents, intersections, asymptotes)
 * are kernel-side; see the test report.
 */
import { describe, expect, it } from 'vitest';
import { fieldFromRelation, traceImplicit } from '@incantly/plot';
import {
  HEAVY_TIMEOUT,
  TIMEOUT,
  VIEW_SQ,
  boundsOf,
  circleFieldEnc,
  expectFiniteMarkers,
  expectMarkerMapping,
  expectOk,
  markersOf,
  pairs,
  pxOf,
  pyOf,
  rel2,
  xOfPx,
  yOfPy,
} from './helpers';

const FAR = { x0: 100, x1: 110, y0: 100, y1: 110, widthPx: 800, heightPx: 600 };

describe('CL6 fieldFromRelation: language relations become traced fields', () => {
  it('CL6: x^2 + y^2 == 4 traces the circle of radius 2', () => {
    const field = expectOk(fieldFromRelation(rel2('x^2 + y^2 == 4')));
    const p = expectOk(traceImplicit(field, VIEW_SQ));
    expect(p.paths.length).toBeGreaterThan(0);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const path of p.paths) {
      const b = boundsOf(path);
      if (b === undefined) continue;
      minX = Math.min(minX, xOfPx(VIEW_SQ, b.minX));
      maxX = Math.max(maxX, xOfPx(VIEW_SQ, b.maxX));
    }
    expect(Math.abs(minX - -2) < 0.1 && Math.abs(maxX - 2) < 0.1).toBe(true);
  }, TIMEOUT);

  it('CL6: the level shifts the traced set (level 5 gives radius 3)', () => {
    const field = expectOk(fieldFromRelation(rel2('x^2 + y^2 == 4'), 5));
    const p = expectOk(traceImplicit(field, VIEW_SQ));
    let maxR = 0;
    for (const path of p.paths) {
      for (const pt of pairs(path)) maxR = Math.max(maxR, Math.hypot(xOfPx(VIEW_SQ, pt.x), yOfPy(VIEW_SQ, pt.y)));
    }
    expect(Math.abs(maxR - 3) < 0.15).toBe(true);
  }, TIMEOUT);

  it('CL6: the default level is 0', () => {
    const a = expectOk(traceImplicit(expectOk(fieldFromRelation(rel2('x^2 + y^2 == 4'))), VIEW_SQ));
    const b = expectOk(traceImplicit(expectOk(fieldFromRelation(rel2('x^2 + y^2 == 4'), 0)), VIEW_SQ));
    expect(b.paths.length).toBe(a.paths.length);
    for (let i = 0; i < a.paths.length; i += 1) {
      expect(Array.from(b.paths[i] ?? [])).toEqual(Array.from(a.paths[i] ?? []));
    }
  }, TIMEOUT);
});

describe('CL6 step 1: quadtree with certainty, 2px final leaves, 6px draft', () => {
  it('CL6§1: an empty view discards coarse cells and completes', () => {
    const p = expectOk(traceImplicit(
      { residual: (x, y) => x * x + y * y - 4, enclosure: circleFieldEnc(2) }, FAR,
    ));
    expect(p.paths).toEqual([]);
    expect(p.stats.complete).toBe(true);
    expect(p.stats.intervalEvals).toBeLessThanOrEqual(2000);
  }, TIMEOUT);

  it('CL6§1: def 0 cells are discarded (no curve where undefined)', () => {
    const p = expectOk(traceImplicit(
      {
        residual: (x, y) => (x < 0 ? Number.NaN : x * x + y * y - 4),
        enclosure: (x0, x1, y0, y1) => (x1 < 0 ? { lo: 0, hi: 0, def: 0 } : circleFieldEnc(2)(x0, x1, y0, y1)),
      },
      VIEW_SQ,
    ));
    for (const path of p.paths) {
      for (const pt of pairs(path)) expect(xOfPx(VIEW_SQ, pt.x) >= -0.05, `vertex at x=${xOfPx(VIEW_SQ, pt.x)}`).toBe(true);
    }
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL6§1: cost follows curve length, not area', () => {
    const big = expectOk(traceImplicit(
      { residual: (x, y) => x * x + y * y - 4, enclosure: circleFieldEnc(2) }, VIEW_SQ,
    ));
    const small = expectOk(traceImplicit(
      { residual: (x, y) => x * x + y * y - 0.25, enclosure: circleFieldEnc(0.5) }, VIEW_SQ,
    ));
    expect(small.stats.evals).toBeLessThan(big.stats.evals);
    expect(small.stats.complete && big.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL6§1+§3: final leaves resolve the circle to half a pixel', () => {
    const p = expectOk(traceImplicit(
      { residual: (x, y) => x * x + y * y - 4, enclosure: circleFieldEnc(2) }, VIEW_SQ,
    ));
    for (const path of p.paths) {
      for (const pt of pairs(path)) {
        const r = Math.hypot(xOfPx(VIEW_SQ, pt.x), yOfPy(VIEW_SQ, pt.y));
        expect(Math.abs(r - 2) * 60 < 0.5, `radius ${r}`).toBe(true);
      }
    }
  }, TIMEOUT);

  it('CL6§1: draft leaves are coarser than final ones', () => {
    const field = { residual: (x: number, y: number) => x * x + y * y - 4, enclosure: circleFieldEnc(2) };
    const draft = expectOk(traceImplicit(field, VIEW_SQ, { quality: 'draft' }));
    const final = expectOk(traceImplicit(field, VIEW_SQ, { quality: 'final' }));
    expect(draft.stats.samples).toBeLessThan(final.stats.samples);
    for (const path of draft.paths) {
      for (const pt of pairs(path)) {
        const r = Math.hypot(xOfPx(VIEW_SQ, pt.x), yOfPy(VIEW_SQ, pt.y));
        expect(Math.abs(r - 2) * 60 < 5, `draft radius ${r}`).toBe(true);
      }
    }
  }, TIMEOUT);

  it('CL6 targets: draft is cheaper than final (certain path)', () => {
    const field = { residual: (x: number, y: number) => x * x + y * y - 4, enclosure: circleFieldEnc(2) };
    const draft = expectOk(traceImplicit(field, VIEW_SQ, { quality: 'draft' }));
    const final = expectOk(traceImplicit(field, VIEW_SQ, { quality: 'final' }));
    expect(draft.stats.evals).toBeLessThan(final.stats.evals);
  }, TIMEOUT);

  it('CL6 targets: draft is cheaper than final (heuristic path)', () => {
    const field = { residual: (x: number, y: number) => x * x + y * y - 4 };
    const draft = expectOk(traceImplicit(field, VIEW_SQ, { quality: 'draft' }));
    const final = expectOk(traceImplicit(field, VIEW_SQ, { quality: 'final' }));
    expect(draft.stats.evals).toBeLessThan(final.stats.evals);
  }, TIMEOUT);

  it('CL6§1+§6: a line crossing the view ends at its borders', () => {
    const p = expectOk(traceImplicit({ residual: (x, y) => x + y }, VIEW_SQ));
    expect(p.paths.length).toBeGreaterThanOrEqual(1);
    expect(p.closed.every((c) => c === false)).toBe(true);
    for (const path of p.paths) {
      const pts = pairs(path);
      const ends = [pts[0], pts[pts.length - 1]];
      for (const e of ends) {
        if (e === undefined) continue;
        const atBorder = e.x <= 2 || e.x >= VIEW_SQ.widthPx - 2 || e.y <= 2 || e.y >= VIEW_SQ.heightPx - 2;
        expect(atBorder, `end at (${e.x}, ${e.y})`).toBe(true);
      }
    }
  }, TIMEOUT);
});

describe('CL6 step 2: each shared corner is evaluated once', () => {
  it('CL6§2: no residual input is evaluated twice', () => {
    const seen = new Set<string>();
    let calls = 0;
    let dupes = 0;
    const p = expectOk(traceImplicit(
      {
        residual: (x, y) => {
          calls += 1;
          const k = `${x},${y}`;
          if (seen.has(k)) dupes += 1;
          else seen.add(k);
          return x * x + y * y - 4;
        },
        enclosure: circleFieldEnc(2),
      },
      VIEW_SQ,
    ));
    expect(calls).toBeGreaterThan(0);
    expect(dupes).toBe(0);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL6§2: stats.evals honestly counts residual evaluations', () => {
    let calls = 0;
    const p = expectOk(traceImplicit(
      {
        residual: (x, y) => {
          calls += 1;
          return x * x + y * y - 4;
        },
        enclosure: circleFieldEnc(2),
      },
      VIEW_SQ,
    ));
    expect(p.stats.evals).toBe(calls);
  }, TIMEOUT);
});

describe('CL6 step 3: marching squares with Newton-corrected crossings', () => {
  it('CL6§3: the polyline is smooth, with no stair-stepping', () => {
    const p = expectOk(traceImplicit(
      { residual: (x, y) => x * x + y * y - 4, enclosure: circleFieldEnc(2) }, VIEW_SQ,
    ));
    for (const path of p.paths) {
      const pts = pairs(path);
      for (let i = 2; i < pts.length; i += 1) {
        const a = pts[i - 2];
        const b = pts[i - 1];
        const c = pts[i];
        if (a === undefined || b === undefined || c === undefined) continue;
        const v1x = b.x - a.x;
        const v1y = b.y - a.y;
        const v2x = c.x - b.x;
        const v2y = c.y - b.y;
        const n1 = Math.hypot(v1x, v1y);
        const n2 = Math.hypot(v2x, v2y);
        if (n1 === 0 || n2 === 0) continue;
        const cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
        const deg = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
        expect(deg < 30, `turn ${deg}deg`).toBe(true);
      }
    }
  }, TIMEOUT);

  it('CL6§3: a saddle resolves into diagonals across the view', () => {
    const p = expectOk(traceImplicit({ residual: (x, y) => x * x - y * y }, VIEW_SQ));
    for (const t of [-4, -3, -2, -1, 1, 2, 3, 4]) {
      const nearDiag = (sx: number, sy: number): boolean => p.paths.some((path) =>
        pairs(path).some((q) => Math.hypot(q.x - pxOf(VIEW_SQ, t * sx), q.y - pyOf(VIEW_SQ, t * sy)) < 3),
      );
      expect(nearDiag(1, 1), `diagonal near (${t}, ${t})`).toBe(true);
      expect(nearDiag(1, -1), `diagonal near (${t}, ${-t})`).toBe(true);
    }
  }, TIMEOUT);
});

describe('CL6 step 4: small features become isolated markers, never misses', () => {
  it('CL6§4: a touching point emits an isolated marker at the origin', () => {
    const p = expectOk(traceImplicit(expectOk(fieldFromRelation(rel2('x^2 + y^2 == 0'))), VIEW_SQ));
    const found = markersOf(p.markers, 'isolated');
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.some((m) => Math.hypot(m.px - pxOf(VIEW_SQ, 0), m.py - pyOf(VIEW_SQ, 0)) < 2)).toBe(true);
  }, TIMEOUT);

  it('CL6§4: a touching point draws no curve', () => {
    const p = expectOk(traceImplicit(expectOk(fieldFromRelation(rel2('x^2 + y^2 == 0'))), VIEW_SQ));
    expect(p.paths).toEqual([]);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL6§4: a sub-quarter-pixel loop collapses to an isolated marker', () => {
    const r = 0.1 / 60; // 0.1px loop in a 60px/unit view
    const p = expectOk(traceImplicit(
      { residual: (x, y) => x * x + y * y - r * r, enclosure: circleFieldEnc(r) }, VIEW_SQ,
    ));
    const found = markersOf(p.markers, 'isolated');
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.some((m) => Math.hypot(m.px - pxOf(VIEW_SQ, 0), m.py - pyOf(VIEW_SQ, 0)) < 2)).toBe(true);
  }, TIMEOUT);

  it('CL6§4: a two-pixel loop still draws segments', () => {
    const r = 2 / 60;
    const p = expectOk(traceImplicit(
      { residual: (x, y) => x * x + y * y - r * r, enclosure: circleFieldEnc(r) }, VIEW_SQ,
    ));
    expect(p.paths.length).toBeGreaterThan(0);
    for (const path of p.paths) {
      for (const pt of pairs(path)) {
        const rPx = Math.hypot(pt.x - pxOf(VIEW_SQ, 0), pt.y - pyOf(VIEW_SQ, 0));
        expect(Math.abs(rPx - 2) < 2, `loop radius ${rPx}px`).toBe(true);
      }
    }
  }, TIMEOUT);
});

describe('CL6 step 5: singular points join with sharp corners', () => {
  it('CL6§5: a lemniscate node is crossed, not rounded', () => {
    const p = expectOk(traceImplicit(
      expectOk(fieldFromRelation(rel2('(x^2+y^2)^2 == x^2-y^2'))), VIEW_SQ,
    ));
    const nearOrigin = p.paths.some((path) =>
      pairs(path).some((q) => Math.hypot(q.x - pxOf(VIEW_SQ, 0), q.y - pyOf(VIEW_SQ, 0)) < 2),
    );
    expect(nearOrigin).toBe(true);
  }, TIMEOUT);

  it('CL6§5: both lemniscate lobes are covered', () => {
    const p = expectOk(traceImplicit(
      expectOk(fieldFromRelation(rel2('(x^2+y^2)^2 == x^2-y^2'))), VIEW_SQ,
    ));
    let minX = Infinity;
    let maxX = -Infinity;
    for (const path of p.paths) {
      for (const pt of pairs(path)) {
        const x = xOfPx(VIEW_SQ, pt.x);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    expect(minX < -0.9 && maxX > 0.9).toBe(true);
  }, TIMEOUT);

  it('CL6§5: a cusp is traced up to its tip', () => {
    const p = expectOk(traceImplicit(expectOk(fieldFromRelation(rel2('y^2 == x^3'))), VIEW_SQ));
    const nearTip = p.paths.some((path) =>
      pairs(path).some((q) => Math.hypot(q.x - pxOf(VIEW_SQ, 0), q.y - pyOf(VIEW_SQ, 0)) < 2),
    );
    expect(nearTip).toBe(true);
    let maxX = -Infinity;
    for (const path of p.paths) for (const pt of pairs(path)) maxX = Math.max(maxX, xOfPx(VIEW_SQ, pt.x));
    // The branches leave the [-5, 5] view at |y| = 5, i.e. x = 25^(1/3) ≈ 2.924, so they reach close to that.
    expect(maxX > 2.9).toBe(true);
  }, TIMEOUT);
});

describe('CL6 step 6: linking by edge keys, deterministic sorted chains', () => {
  it('CL6§6: a smooth circle links into one closed chain', () => {
    const p = expectOk(traceImplicit(
      { residual: (x, y) => x * x + y * y - 4, enclosure: circleFieldEnc(2) }, VIEW_SQ,
    ));
    expect(p.paths.length).toBe(1);
    expect(p.closed).toEqual([true]);
  }, TIMEOUT);

  it('CL6§6: repeat traces are identical', () => {
    const field = { residual: (x: number, y: number) => x * x + y * y - 4, enclosure: circleFieldEnc(2) };
    const a = expectOk(traceImplicit(field, VIEW_SQ));
    const b = expectOk(traceImplicit(field, VIEW_SQ));
    expect(b.stats).toEqual(a.stats);
    expect(b.closed).toEqual(a.closed);
    expect(b.paths.length).toBe(a.paths.length);
    for (let i = 0; i < a.paths.length; i += 1) {
      expect(Array.from(b.paths[i] ?? [])).toEqual(Array.from(a.paths[i] ?? []));
    }
    expect(b.markers).toEqual(a.markers);
  }, TIMEOUT);

  it('CL6§6: chain order is sorted by first key', () => {
    const p = expectOk(traceImplicit({ residual: (x, y) => x * x - y * y }, VIEW_SQ));
    expect(p.paths.length).toBeGreaterThanOrEqual(2);
    const heads = p.paths.map((path) => [path[0] ?? 0, path[1] ?? 0] as const);
    for (let i = 1; i < heads.length; i += 1) {
      const a = heads[i - 1];
      const b = heads[i];
      expect(a !== undefined && b !== undefined && (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]))).toBe(true);
    }
  }, TIMEOUT);
});

describe('CL6 output, certainty flags, budgets and targets', () => {
  it('CL6§7: the ImplicitPlot shape is paths, closed, markers and stats', () => {
    const p = expectOk(traceImplicit({ residual: (x, y) => x * x + y * y - 4 }, VIEW_SQ));
    expect(Array.isArray(p.paths)).toBe(true);
    expect(p.closed.length).toBe(p.paths.length);
    expect(Array.isArray(p.markers)).toBe(true);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL6 output: stats.samples counts the output points', () => {
    const p = expectOk(traceImplicit({ residual: (x, y) => x * x + y * y - 4 }, VIEW_SQ));
    let n = 0;
    for (const path of p.paths) n += path.length / 2;
    expect(p.stats.samples).toBe(n);
  }, TIMEOUT);

  it.each(['circle', 'line', 'empty'])('CL6: certain traces with an enclosure are rigorous (%s)', (which) => {
    const field = which === 'circle'
      ? { residual: (x: number, y: number) => x * x + y * y - 4, enclosure: circleFieldEnc(2) }
      : which === 'line'
        ? { residual: (x: number, y: number) => x + y, enclosure: ((_x0: number, _x1: number, _y0: number, _y1: number) => ({ lo: -20, hi: 20, def: 2 as const })) }
        : { residual: (x: number, y: number) => x * x + y * y + 1, enclosure: circleFieldEnc(2) };
    const p = expectOk(traceImplicit(field, which === 'empty' ? FAR : VIEW_SQ));
    expect(p.stats.rigorous).toBe(true);
  }, TIMEOUT);

  it.each(['circle', 'line', 'saddle'])('CL6: traces without an enclosure report rigorous false (%s)', (which) => {
    const residual = which === 'circle'
      ? (x: number, y: number) => x * x + y * y - 4
      : which === 'line' ? (x: number, y: number) => x + y : (x: number, y: number) => x * x - y * y;
    const p = expectOk(traceImplicit({ residual }, VIEW_SQ));
    expect(p.stats.rigorous).toBe(false);
  }, TIMEOUT);

  it('CL6: the default quality is final', () => {
    const field = { residual: (x: number, y: number) => x * x + y * y - 4 };
    const a = expectOk(traceImplicit(field, VIEW_SQ));
    const b = expectOk(traceImplicit(field, VIEW_SQ, { quality: 'final' }));
    expect(b.stats).toEqual(a.stats);
    expect(b.paths.length).toBe(a.paths.length);
  }, TIMEOUT);

  it('CL6 budgets: an explicit sample cap binds the output', () => {
    const p = expectOk(traceImplicit({ residual: (x, y) => x * x + y * y - 4 }, VIEW_SQ, { maxSamples: 100 }));
    expect(p.stats.samples).toBeLessThanOrEqual(100);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL6 budgets: exhausting maxEvals reports incomplete with empty output', () => {
    const p = expectOk(traceImplicit({ residual: (x, y) => x * x + y * y - 4 }, VIEW_SQ, { maxEvals: 100 }));
    expect(p.stats.complete).toBe(false);
    expect(p.paths).toEqual([]);
    const done = expectOk(traceImplicit({ residual: (x, y) => x * x + y * y - 4 }, VIEW_SQ, { maxEvals: 500000 }));
    expect(done.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL edge: an empty curve is defined and draws nothing', () => {
    const p = expectOk(traceImplicit(expectOk(fieldFromRelation(rel2('x^2 + y^2 == -1'))), VIEW_SQ));
    expect(p.paths).toEqual([]);
    expect(p.markers).toEqual([]);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL edge: an identically-zero field draws nothing and completes', () => {
    const p = expectOk(traceImplicit({ residual: (_x, _y) => 0 }, VIEW_SQ));
    expect(p.paths).toEqual([]);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL edge: x^2 == 4 draws two vertical lines', () => {
    const p = expectOk(traceImplicit(expectOk(fieldFromRelation(rel2('x^2 == 4'))), VIEW_SQ));
    for (const lx of [-2, 2]) {
      const near = p.paths.some((path) =>
        pairs(path).some((q) => Math.abs(q.x - pxOf(VIEW_SQ, lx)) < 2),
      );
      expect(near, `line at x=${lx}`).toBe(true);
    }
  }, TIMEOUT);

  it('CL6 output: vertices stay inside the view', () => {
    const p = expectOk(traceImplicit({ residual: (x, y) => x * x + y * y - 4 }, VIEW_SQ));
    for (const path of p.paths) {
      for (const pt of pairs(path)) {
        expect(pt.x >= -1 && pt.x <= VIEW_SQ.widthPx + 1 && pt.y >= -1 && pt.y <= VIEW_SQ.heightPx + 1).toBe(true);
      }
    }
  }, TIMEOUT);

  it.each(['circle', 'point'])('CL6 markers stay finite and mapped (%s)', (which) => {
    const p = which === 'circle'
      ? expectOk(traceImplicit({ residual: (x, y) => x * x + y * y - 4 }, VIEW_SQ))
      : expectOk(traceImplicit(expectOk(fieldFromRelation(rel2('x^2 + y^2 == 0'))), VIEW_SQ));
    expectFiniteMarkers(p);
    for (const m of p.markers) expectMarkerMapping(VIEW_SQ, m);
  }, TIMEOUT);

  it.each([
    ['circle (target 2ms)', 'x^2 + y^2 == 4'],
    ['lemniscate (target 3ms)', '(x^2+y^2)^2 == x^2-y^2'],
  ])('CL6 targets: %s completes within budget', (_label, text) => {
    const t0 = performance.now();
    const p = expectOk(traceImplicit(expectOk(fieldFromRelation(rel2(text))), VIEW_SQ));
    const ms = performance.now() - t0;
    expect(p.stats.complete).toBe(true);
    expect(p.stats.evals).toBeLessThanOrEqual(200000);
    expect(ms).toBeLessThan(15000);
  }, HEAVY_TIMEOUT);

  it('CL6 targets: sin(x)+sin(y)==sin(x*y) (target 15ms) completes within budget', () => {
    const t0 = performance.now();
    const p = expectOk(traceImplicit({ residual: (x, y) => Math.sin(x) + Math.sin(y) - Math.sin(x * y) }, VIEW_SQ));
    const ms = performance.now() - t0;
    expect(p.stats.complete).toBe(true);
    expect(p.stats.evals).toBeLessThanOrEqual(200000);
    expect(ms).toBeLessThan(30000);
  }, HEAVY_TIMEOUT);
});
