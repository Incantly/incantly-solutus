// @vitest-environment node
/**
 * Shape fixing and ink rotation (docs/features/board/design.md 7.3, 7.4; requirement R5.4; docs/state-machines.md B23;
 * handoff review BR-21): a rough shape held still for 500 ms becomes a clean shape, only when the fit is under 6%, in
 * one undo step that gives the ink back; and a stroke that is turned is drawn, hit, selected, erased and lassoed
 * where it is turned. Only the public API is used.
 */
import { describe, expect, it } from 'vitest';
import {
  FIT_MAX, HOLD_MACHINE, HOLD_MIN_LENGTH_PX, HOLD_MIN_POINTS, HOLD_MS, HOLD_SLOP_PX, HoldWatch, fixPreview, fixStrokes, frameOf, handlesOf, inkTouches, loadBoard, pickShape, recogniseStroke,
  saveBoard, shapeBounds, shapeGeometry, strokePoints, strokesToFix,
} from '../../src/index';
import type { ShapeRecord } from '../../src/index';
import { dump } from './helpers';
import { drawPath, line, pointCount, pointsOf, sample, strokes } from './ink-helpers';
import { add, drag, get, ofKind, shapeRig, shapesOf } from './shape-helpers';
import type { BoardRig } from './shape-helpers';

type Pt = readonly [number, number];

// ---------------------------------------------------------------------------------------------------------------
// rough shapes, with a small steady wobble so no two points are on a clean curve

const wobble = (i: number, amount: number): number => amount * Math.sin(i * 2.3 + 0.4);

function roughLine(x0: number, y0: number, x1: number, y1: number, n = 30, amount = 2.5): Pt[] {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  return Array.from({ length: n + 1 }, (_v, i) => {
    const t = i / n;
    const w = wobble(i, amount);
    return [x0 + (x1 - x0) * t + nx * w, y0 + (y1 - y0) * t + ny * w] as Pt;
  });
}

/** An ellipse of radii `rx, ry` drawn a little more than once round. */
function roughEllipse(cx: number, cy: number, rx: number, ry: number, n = 56, amount = 2): Pt[] {
  return Array.from({ length: n + 1 }, (_v, i) => {
    const a = (i / n) * Math.PI * 2.06;
    const w = wobble(i, amount);
    return [cx + (rx + w) * Math.cos(a), cy + (ry + w) * Math.sin(a)] as Pt;
  });
}

/** A closed polygon through the corners, each side sampled, ending a little past the first corner. */
function roughPolygon(corners: readonly Pt[], per = 12, amount = 2): Pt[] {
  const out: Pt[] = [];
  let k = 0;
  for (let c = 0; c < corners.length; c++) {
    const a = corners[c] as Pt;
    const b = corners[(c + 1) % corners.length] as Pt;
    for (let i = 0; i < per; i++) {
      const t = i / per;
      const w = wobble(k++, amount);
      out.push([a[0] + (b[0] - a[0]) * t + w, a[1] + (b[1] - a[1]) * t - w] as Pt);
    }
  }
  const first = corners[0] as Pt;
  out.push([first[0] + 1, first[1] + 1]);
  return out;
}

/** A shaft, then the two strokes of a head at its tip, in one stroke. */
function roughArrow(): Pt[] {
  const shaft = roughLine(100, 200, 300, 200, 20, 1.5);
  const head: Pt[] = [];
  for (let i = 1; i <= 5; i++) head.push([300 - (30 * i) / 5, 200 - (22 * i) / 5]);
  for (let i = 4; i >= 0; i--) head.push([300 - (30 * i) / 5, 200 - (22 * i) / 5]);
  for (let i = 1; i <= 5; i++) head.push([300 - (30 * i) / 5, 200 + (22 * i) / 5]);
  return [...shaft, ...head];
}

/** A spiral, which no clean shape of the list fits. */
function spiral(): Pt[] {
  return Array.from({ length: 90 }, (_v, i) => {
    const a = i * 0.22;
    const r = 8 + i * 1.3;
    return [300 + r * Math.cos(a), 300 + r * Math.sin(a)] as Pt;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// driving the pen

/** The pen goes down and through the points and stays down. Returns the time of the last move. */
function holdStroke(rig: BoardRig, path: readonly Pt[], t0 = 0): number {
  let t = t0;
  path.forEach(([x, y], i) => {
    rig.host.sample(sample({ x, y, phase: i === 0 ? 'down' : 'move', time: t }));
    t += 8;
  });
  return t - 8;
}

const penRig = (tool = 'pen'): BoardRig => shapeRig(tool);

/** The shape a fixed stroke became: the one shape of the page that is not ink. */
function fixed(rig: BoardRig): ShapeRecord {
  const list = shapesOf(rig).filter((s) => s.kind !== 'ink');
  expect(list).toHaveLength(1);
  return list[0] as ShapeRecord;
}

/** The corners of a polygon result, however the board chose to store it. */
function corners(s: ShapeRecord): number {
  if (s.kind === 'line') return (s.props as { points: number[] }).points.length / 2;
  if (s.kind === 'rect') return 4;
  if (s.kind === 'triangle') return 3;
  if (s.kind === 'diamond') return 4;
  return Number.NaN;
}

describe('the hold fixes a rough shape (design 7.3)', () => {
  it('a rough line held still for 500 ms becomes a line from the first point to the last, and the ink is gone', () => {
    const rig = penRig();
    const path = roughLine(100, 100, 400, 140);
    const last = holdStroke(rig, path);
    rig.host.tick(last + HOLD_MS);
    expect(strokes(rig)).toHaveLength(0);
    const s = fixed(rig);
    expect(s.kind).toBe('line');
    const g = shapeGeometry(s, rig.core.store.kinds);
    const pts = (s.props as { points: number[] }).points;
    const a = g?.toPage(pts[0] as number, pts[1] as number);
    const b = g?.toPage(pts[pts.length - 2] as number, pts[pts.length - 1] as number);
    const first = path[0] as Pt;
    const lastP = path[path.length - 1] as Pt;
    expect(Math.hypot((a?.x ?? 0) - first[0], (a?.y ?? 0) - first[1])).toBeLessThan(25);
    expect(Math.hypot((b?.x ?? 0) - lastP[0], (b?.y ?? 0) - lastP[1])).toBeLessThan(25);
  });

  it('a rough circle becomes an ellipse with the same middle and size', () => {
    const rig = penRig();
    const last = holdStroke(rig, roughEllipse(300, 300, 80, 80));
    rig.host.tick(last + HOLD_MS);
    const s = fixed(rig);
    expect(s.kind).toBe('ellipse');
    const g = shapeGeometry(s, rig.core.store.kinds);
    expect(g?.pageCx).toBeGreaterThan(290);
    expect(g?.pageCx).toBeLessThan(310);
    expect(g?.pageCy).toBeGreaterThan(290);
    expect(g?.pageCy).toBeLessThan(310);
    const { w, h } = s.props as { w: number; h: number };
    expect(w).toBeGreaterThan(140);
    expect(w).toBeLessThan(180);
    expect(Math.abs(w - h)).toBeLessThan(2);
  });

  it('a rough ellipse becomes an ellipse that is wider than tall', () => {
    const rig = penRig();
    const last = holdStroke(rig, roughEllipse(300, 300, 130, 55));
    rig.host.tick(last + HOLD_MS);
    const s = fixed(rig);
    expect(s.kind).toBe('ellipse');
    const { w, h } = s.props as { w: number; h: number };
    expect(w).toBeGreaterThan(h * 1.8);
  });

  it.each([
    [3, 'triangle', [[250, 100], [400, 330], [100, 330]]],
    [5, 'house', [[100, 300], [100, 160], [200, 80], [300, 160], [300, 300]]],
    [6, 'L shape', [[100, 100], [250, 100], [250, 200], [400, 200], [400, 300], [100, 300]]],
  ] as const)('a rough %i-cornered shape (%s) becomes a polygon with that many corners', (n, _name, corn) => {
    const rig = penRig();
    const last = holdStroke(rig, roughPolygon(corn as readonly Pt[]));
    rig.host.tick(last + HOLD_MS);
    expect(strokes(rig)).toHaveLength(0);
    expect(corners(fixed(rig))).toBe(n);
  });

  it('a rough rectangle becomes a rectangle shape with its size', () => {
    const rig = penRig();
    const last = holdStroke(rig, roughPolygon([[100, 100], [400, 100], [400, 250], [100, 250]]));
    rig.host.tick(last + HOLD_MS);
    const s = fixed(rig);
    expect(corners(s)).toBe(4);
    const g = shapeGeometry(s, rig.core.store.kinds);
    const xs = [g?.corners[0], g?.corners[2], g?.corners[4], g?.corners[6]] as number[];
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(270);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(330);
  });

  it('a line with a head becomes an arrow, from the tail to the tip', () => {
    const rig = penRig();
    const last = holdStroke(rig, roughArrow());
    rig.host.tick(last + HOLD_MS);
    const s = fixed(rig);
    expect(s.kind).toBe('arrow');
    const g = shapeGeometry(s, rig.core.store.kinds);
    const p = s.props as { start: [number, number]; end: [number, number]; endHead: string };
    const a = g?.toPage(p.start[0], p.start[1]);
    const b = g?.toPage(p.end[0], p.end[1]);
    expect(Math.hypot((a?.x ?? 0) - 100, (a?.y ?? 0) - 200)).toBeLessThan(15);
    expect(Math.hypot((b?.x ?? 0) - 300, (b?.y ?? 0) - 200)).toBeLessThan(15);
    expect(p.endHead).not.toBe('none');
  });

  it('no match leaves the ink: a spiral held for a second is still ink, and nothing else is made', () => {
    const rig = penRig();
    const last = holdStroke(rig, spiral());
    rig.host.tick(last + 1000);
    expect(strokes(rig)).toHaveLength(1);
    expect(shapesOf(rig)).toHaveLength(1);
  });

  it('the clean shape keeps the colour and the width of the pen it was drawn with', () => {
    const rig = penRig();
    rig.styles.pen = { ...rig.styles.pen, color: '#aa3300', size: 7 };
    const last = holdStroke(rig, roughEllipse(300, 300, 80, 80));
    rig.host.tick(last + HOLD_MS);
    expect(fixed(rig).props).toMatchObject({ stroke: '#aa3300', size: 7 });
  });
});

describe('the hold: when it fires (B23)', () => {
  it('not before 500 ms after the last move: at 499 ms the ink is still ink, at 500 it is fixed', () => {
    const rig = penRig();
    const last = holdStroke(rig, roughEllipse(300, 300, 80, 80));
    expect(rig.host.tick(last + HOLD_MS - 1)).toBe(true);
    expect(strokes(rig)).toHaveLength(0);
    expect(shapesOf(rig)).toHaveLength(0);
    rig.host.tick(last + HOLD_MS);
    expect(ofKind(rig, 'ellipse')).toHaveLength(1);
  });

  it('the stroke is not stored while the pen is still moving and the hold has not come', () => {
    const rig = penRig();
    holdStroke(rig, roughEllipse(300, 300, 80, 80));
    expect(shapesOf(rig)).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(0);
  });

  it('a tiny jitter of 3 pixels or less does not start the count again', () => {
    const rig = penRig();
    const path = roughEllipse(300, 300, 80, 80);
    const last = holdStroke(rig, path);
    const end = path[path.length - 1] as Pt;
    rig.host.sample(sample({ x: end[0] + 2, y: end[1] + 1, phase: 'move', time: last + 300 }));
    rig.host.tick(last + HOLD_MS);
    expect(ofKind(rig, 'ellipse')).toHaveLength(1);
    expect(HOLD_SLOP_PX).toBe(3);
  });

  it('a move of more than 3 pixels starts the count again', () => {
    const rig = penRig();
    const path = roughEllipse(300, 300, 80, 80);
    const last = holdStroke(rig, path);
    const end = path[path.length - 1] as Pt;
    rig.host.sample(sample({ x: end[0] + 12, y: end[1] + 9, phase: 'move', time: last + 300 }));
    rig.host.tick(last + HOLD_MS);
    expect(shapesOf(rig)).toHaveLength(0);
    rig.host.tick(last + 300 + HOLD_MS);
    expect(shapesOf(rig).filter((s) => s.kind !== 'ink')).toHaveLength(1);
  });

  it('a pen that comes up before the hold stores the stroke as ink and nothing is fixed later', () => {
    const rig = penRig();
    drawPath(rig, roughEllipse(300, 300, 80, 80));
    expect(strokes(rig)).toHaveLength(1);
    rig.host.tick(100_000);
    expect(strokes(rig)).toHaveLength(1);
    expect(ofKind(rig, 'ellipse')).toHaveLength(0);
  });

  it('a short stroke is never fixed: under 40 pixels long, or under 8 points', () => {
    expect(HOLD_MIN_LENGTH_PX).toBe(40);
    expect(HOLD_MIN_POINTS).toBe(8);
    const tiny = penRig();
    const t1 = holdStroke(tiny, roughEllipse(300, 300, 5, 5, 30, 0.2));
    tiny.host.tick(t1 + 2000);
    expect(tiny.core.store.shapesOn(tiny.core.pages.current as string).filter((s) => s.kind === 'ellipse')).toHaveLength(0);
    const few = penRig();
    const t2 = holdStroke(few, line(100, 100, 400, 100, 5));
    few.host.tick(t2 + 2000);
    expect(ofKind(few, 'line')).toHaveLength(0);
    // the same stroke with enough points is a line
    const enough = penRig();
    const t3 = holdStroke(enough, line(100, 100, 400, 100, 12));
    enough.host.tick(t3 + 2000);
    expect(ofKind(enough, 'line')).toHaveLength(1);
  });

  it('the highlighter never fixes', () => {
    const rig = penRig('highlighter');
    const last = holdStroke(rig, roughEllipse(300, 300, 80, 80));
    rig.host.tick(last + 5000);
    expect(shapesOf(rig)).toHaveLength(0);
    rig.host.sample(sample({ x: 380, y: 300, phase: 'up', time: last + 5100 }));
    expect(strokes(rig)).toHaveLength(1);
    expect(ofKind(rig, 'ellipse')).toHaveLength(0);
  });

  it('the host can turn the hold off', () => {
    const rig = penRig();
    rig.styles.fixHold = false;
    const last = holdStroke(rig, roughEllipse(300, 300, 80, 80));
    rig.host.tick(last + 5000);
    expect(shapesOf(rig)).toHaveLength(0);
    rig.host.sample(sample({ x: 380, y: 300, phase: 'up', time: last + 5100 }));
    expect(strokes(rig)).toHaveLength(1);
  });

  it('once fixed the rest of the gesture is ignored: more moves add no ink, and the pen comes up to nothing', () => {
    const rig = penRig();
    const last = holdStroke(rig, roughEllipse(300, 300, 80, 80));
    rig.host.tick(last + HOLD_MS);
    const before = shapesOf(rig).map((s) => s.id);
    for (let i = 1; i <= 6; i++) rig.host.sample(sample({ x: 380 + i * 20, y: 300 + i * 10, phase: 'move', time: last + 600 + i * 8 }));
    rig.host.sample(sample({ x: 520, y: 360, phase: 'up', time: last + 700 }));
    expect(shapesOf(rig).map((s) => s.id)).toEqual(before);
    expect(strokes(rig)).toHaveLength(0);
    // a fire happens once
    expect(rig.host.tick(last + 5000)).toBe(false);
    expect(shapesOf(rig).map((s) => s.id)).toEqual(before);
    // and the next stroke works as usual
    drawPath(rig, line(0, 500, 200, 500, 12), {}, last + 10_000);
    expect(strokes(rig)).toHaveLength(1);
  });

  it('a cancel of the stroke before the hold drops it: nothing is stored and nothing fires later', () => {
    const rig = penRig();
    const last = holdStroke(rig, roughEllipse(300, 300, 80, 80));
    rig.host.cancel();
    rig.host.tick(last + 5000);
    expect(shapesOf(rig)).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(0);
  });

  it('changing the tool before the hold drops the stroke too', () => {
    const rig = penRig();
    const last = holdStroke(rig, roughEllipse(300, 300, 80, 80));
    rig.host.setTool('eraser');
    rig.host.tick(last + 5000);
    expect(shapesOf(rig)).toHaveLength(0);
  });
});

describe('a fix is one undo step, and undo gives the ink back (design 7.3)', () => {
  it('the stroke is its own step and the fix is the next: one undo gives back the ink, a second removes it', () => {
    const rig = penRig();
    const last = holdStroke(rig, roughEllipse(300, 300, 80, 80));
    rig.host.tick(last + HOLD_MS);
    expect(rig.core.history.undoSteps).toBe(2);
    rig.core.history.undo();
    expect(ofKind(rig, 'ellipse')).toHaveLength(0);
    expect(strokes(rig)).toHaveLength(1);
    rig.core.history.undo();
    expect(shapesOf(rig)).toHaveLength(0);
  });

  it('the ink that comes back is the ink that was drawn: all its points, in place', () => {
    const rig = penRig();
    const path = roughEllipse(300, 300, 80, 80);
    const last = holdStroke(rig, path);
    rig.host.tick(last + HOLD_MS);
    rig.core.history.undo();
    const ink = strokes(rig)[0] as ShapeRecord;
    const page = strokePoints(ink as Parameters<typeof strokePoints>[0]);
    expect(page.length / 2).toBe(pointCount(ink));
    expect(page.length / 2).toBeGreaterThan(30);
    const xs = page.filter((_v, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(220, -1);
    expect(Math.max(...xs)).toBeGreaterThan(375);
  });

  it('redo makes the clean shape again', () => {
    const rig = penRig();
    const last = holdStroke(rig, roughEllipse(300, 300, 80, 80));
    rig.host.tick(last + HOLD_MS);
    const made = fixed(rig);
    rig.core.history.undo();
    rig.core.history.redo();
    expect(get(rig, made.id)).toEqual(made);
    expect(strokes(rig)).toHaveLength(0);
  });

  it('the toolbar Fix: the newest stroke is fixed in one step, with no hold', () => {
    const rig = penRig();
    drawPath(rig, roughEllipse(300, 300, 80, 80));
    drawPath(rig, roughLine(100, 600, 400, 620), {}, 5000);
    const steps = rig.core.history.undoSteps;
    const target = strokesToFix(rig.core);
    expect(target).toEqual([(strokes(rig)[1] as ShapeRecord).id]);
    const r = fixStrokes(rig.core, target);
    expect(r.ok && r.value).toHaveLength(1);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    expect(ofKind(rig, 'line')).toHaveLength(1);
    expect(strokes(rig)).toHaveLength(1);
    rig.core.history.undo();
    expect(strokes(rig)).toHaveLength(2);
    expect(ofKind(rig, 'line')).toHaveLength(0);
  });

  it('the toolbar Fix works on the selected strokes, all in one step', () => {
    const rig = penRig();
    drawPath(rig, roughEllipse(300, 300, 80, 80));
    drawPath(rig, roughLine(100, 600, 400, 620), {}, 5000);
    drawPath(rig, spiral(), {}, 10_000);
    const [a, b, c] = strokes(rig) as [ShapeRecord, ShapeRecord, ShapeRecord];
    rig.core.selection.set([a.id, b.id, c.id]);
    const steps = rig.core.history.undoSteps;
    const r = fixStrokes(rig.core, strokesToFix(rig.core));
    expect(r.ok && r.value).toHaveLength(2);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    expect(strokes(rig).map((s) => s.id)).toEqual([c.id]);
    rig.core.history.undo();
    expect(strokes(rig)).toHaveLength(3);
  });

  it('a stroke that fits nothing is left, and no undo step is made', () => {
    const rig = penRig();
    drawPath(rig, spiral());
    const steps = rig.core.history.undoSteps;
    const r = fixStrokes(rig.core, strokesToFix(rig.core));
    expect(r.ok && r.value).toEqual([]);
    expect(rig.core.history.undoSteps).toBe(steps);
    expect(strokes(rig)).toHaveLength(1);
  });

  it('a locked stroke and a highlighter stroke are left alone', () => {
    const rig = penRig();
    drawPath(rig, roughEllipse(300, 300, 80, 80));
    rig.host.setTool('highlighter');
    drawPath(rig, roughEllipse(600, 300, 80, 80), {}, 5000);
    const [a, b] = strokes(rig) as [ShapeRecord, ShapeRecord];
    rig.core.store.change('user', (tx) => void tx.update(a.id, { locked: true }));
    const r = fixStrokes(rig.core, [a.id, b.id]);
    expect(r.ok && r.value).toEqual([]);
    expect(strokes(rig)).toHaveLength(2);
    expect(fixPreview(b as Parameters<typeof fixPreview>[0])).toBeUndefined();
  });

  it('the clean shape takes the place of the ink in the stack, with its opacity', () => {
    const rig = penRig();
    drawPath(rig, roughEllipse(300, 300, 80, 80));
    const ink = strokes(rig)[0] as ShapeRecord;
    rig.core.store.change('user', (tx) => void tx.update(ink.id, { opacity: 0.5 }));
    const r = fixStrokes(rig.core, [ink.id]);
    if (!r.ok) throw new Error(r.message);
    const made = get(rig, r.value[0] as string);
    expect(made.opacity).toBe(0.5);
    expect(made.index).toBe(ink.index);
    expect(made.page).toBe(ink.page);
  });
});

describe('the 6% rule (design 7.3)', () => {
  const xy = (path: readonly Pt[]): number[] => path.flatMap(([x, y]) => [x, y]);

  it('the limit is 6%', () => {
    expect(FIT_MAX).toBe(0.06);
  });

  it('a clean fit has a mean distance far under the limit and is accepted', () => {
    const r = recogniseStroke(xy(roughLine(0, 0, 300, 0, 30, 1)));
    expect(r?.kind).toBe('line');
    expect(r?.fit).toBeLessThan(FIT_MAX);
  });

  it('every shape the recogniser gives has a fit under 6%', () => {
    const cases: readonly (readonly Pt[])[] = [
      roughLine(0, 0, 300, 40),
      roughEllipse(100, 100, 70, 70),
      roughEllipse(100, 100, 120, 50),
      roughPolygon([[0, 0], [200, 0], [100, 180]]),
      roughPolygon([[100, 300], [100, 160], [200, 80], [300, 160], [300, 300]]),
      roughArrow(),
    ];
    for (const path of cases) {
      const r = recogniseStroke(xy(path));
      expect(r).toBeDefined();
      expect(r?.fit ?? 1).toBeLessThan(FIT_MAX);
    }
  });

  it('a line that bows by 25% of its length is not a line', () => {
    const n = 30;
    const path: Pt[] = Array.from({ length: n + 1 }, (_v, i) => [(i / n) * 300, Math.sin((i / n) * Math.PI) * 75] as Pt);
    expect(recogniseStroke(xy(path))?.kind).not.toBe('line');
  });

  it('a line that bows by 2% of its length is a line', () => {
    const n = 30;
    const path: Pt[] = Array.from({ length: n + 1 }, (_v, i) => [(i / n) * 300, Math.sin((i / n) * Math.PI) * 6] as Pt);
    expect(recogniseStroke(xy(path))?.kind).toBe('line');
  });

  it('a closed loop that is far from every ellipse and polygon is left as ink (the hold fixes nothing)', () => {
    const rig = penRig();
    // a circle with seven big lobes: mean distance well over 6% of its size
    const lobes: Pt[] = Array.from({ length: 70 }, (_v, i) => {
      const a = (i / 70) * Math.PI * 2;
      const r = 100 * (1 + 0.32 * Math.sin(7 * a));
      return [300 + r * Math.cos(a), 300 + r * Math.sin(a)] as Pt;
    });
    expect(recogniseStroke(xy(lobes))).toBeUndefined();
    const last = holdStroke(rig, lobes);
    rig.host.tick(last + 1000);
    expect(strokes(rig)).toHaveLength(1);
    expect(shapesOf(rig)).toHaveLength(1);
  });

  it('a shape with more than 6 corners is not made into a polygon', () => {
    const r = recogniseStroke(xy(roughPolygon([[0, 0], [100, 0], [100, 100], [200, 100], [200, 200], [0, 200], [0, 100], [-100, 100]])));
    expect(r?.kind === 'polygon' ? r.points.length / 2 : 0).toBeLessThanOrEqual(6);
  });

  it('fewer than 8 points, or a stroke that is not made of numbers, is never fixed', () => {
    expect(recogniseStroke(xy(line(0, 0, 200, 0, 5)))).toBeUndefined();
    expect(recogniseStroke([])).toBeUndefined();
    expect(recogniseStroke(xy(line(0, 0, 200, 0, 12)).map((v, i) => (i === 7 ? Number.NaN : v)))).toBeUndefined();
    expect(recogniseStroke(new Array<number>(40).fill(5))).toBeUndefined();
  });
});

describe('the hold watch (B23)', () => {
  it('starts idle and the table has the three states of the document', () => {
    expect(new HoldWatch().state).toBe('idle');
    expect(Object.keys(HOLD_MACHINE).sort()).toEqual(['fired', 'idle', 'watching']);
  });

  /** A watch that has been walked along a line of `n` points, `len` pixels long, the last move at time 100. */
  function watched(n: number, len: number): HoldWatch {
    const w = new HoldWatch();
    w.begin(0, 0, 0);
    for (let i = 1; i < n; i++) w.move((len * i) / (n - 1), 0, (100 * i) / (n - 1));
    return w;
  }

  it('is due 500 ms after the last move of a stroke of 8 points and 40 pixels', () => {
    const w = watched(8, 40);
    expect(w.due(599)).toBe(false);
    expect(w.due(600)).toBe(true);
  });

  it('is never due for a stroke under 8 points or under 40 pixels', () => {
    expect(watched(7, 400).due(10_000)).toBe(false);
    expect(watched(30, 39).due(10_000)).toBe(false);
    expect(watched(30, 40).due(10_000)).toBe(true);
  });

  it('a fire happens once: fire in fired and in idle have no row', () => {
    const w = watched(10, 100);
    expect(w.state).toBe('watching');
    expect(w.fire()).toBe(true);
    expect(w.state).toBe('fired');
    expect(w.fire()).toBe(false);
    expect(w.due(10_000)).toBe(false);
    w.end();
    expect(w.state).toBe('idle');
    expect(w.fire()).toBe(false);
  });

  it('a move in fired has no row and changes nothing; begin in watching or fired has no row', () => {
    const w = watched(10, 100);
    expect(w.begin(5, 5, 5)).toBe(false);
    w.fire();
    w.move(500, 500, 9999);
    expect(w.state).toBe('fired');
    expect(w.begin(5, 5, 5)).toBe(false);
    w.cancel();
    expect(w.state).toBe('idle');
    expect(w.begin(5, 5, 5)).toBe(true);
  });

  it('a move within 3 pixels of where it last moved does not restart the count; further does', () => {
    const w = watched(10, 100);
    w.move(102, 1, 300);
    expect(w.due(600)).toBe(true);
    w.move(110, 1, 300);
    expect(w.due(600)).toBe(false);
    expect(w.due(800)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// BR-21: a stroke's rotation is drawn, hit and selected

describe('ink rotation is drawn, hit and selected (BR-21)', () => {
  /** A stroke along y = 100 from x = 0 to 200 (page units), turned a quarter turn about the middle of its points. */
  function turnedStroke(rig: BoardRig): ShapeRecord {
    drawPath(rig, line(0, 100, 200, 100, 20));
    const ink = strokes(rig)[0] as ShapeRecord;
    rig.core.store.change('user', (tx) => void tx.update(ink.id, { rotation: Math.PI / 2 }));
    return get(rig, ink.id);
  }

  it('the points of a turned stroke are where it is drawn: about its middle, a quarter turn', () => {
    const rig = penRig();
    const ink = turnedStroke(rig);
    const page = strokePoints(ink as Parameters<typeof strokePoints>[0]);
    const xs = page.filter((_v, i) => i % 2 === 0);
    const ys = page.filter((_v, i) => i % 2 === 1);
    // a horizontal stroke through (100, 100) is a vertical one through x = 100
    for (const x of xs) expect(x).toBeCloseTo(100, 3);
    expect(Math.min(...ys)).toBeCloseTo(0, 3);
    expect(Math.max(...ys)).toBeCloseTo(200, 3);
  });

  it('the draw item carries the turn and the point it turns about', () => {
    const rig = penRig();
    const ink = turnedStroke(rig);
    const item = rig.core.drawList.itemOf(ink, 1);
    expect(item?.k).toBe('ink');
    if (item?.k === 'ink') {
      expect(item.rot).toBeCloseTo(Math.PI / 2, 9);
      // the middle of the points' box in the stroke's own coordinates
      expect(item.ox + item.px).toBeCloseTo(100, 3);
      expect(item.oy + item.py).toBeCloseTo(100, 3);
    }
  });

  it('a stroke that is not turned has no turn in its draw item', () => {
    const rig = penRig();
    drawPath(rig, line(0, 100, 200, 100, 20));
    const item = rig.core.drawList.itemOf(strokes(rig)[0] as ShapeRecord, 1);
    expect(item?.k === 'ink' && item.rot).toBe(0);
  });

  it('a click hits the stroke where it is turned, and not where it was', () => {
    const rig = penRig();
    const ink = turnedStroke(rig);
    expect(pickShape(rig.core, 100, 30, 4)?.id).toBe(ink.id);
    expect(pickShape(rig.core, 100, 170, 4)?.id).toBe(ink.id);
    expect(pickShape(rig.core, 20, 100, 4)).toBeUndefined();
    expect(pickShape(rig.core, 180, 100, 4)).toBeUndefined();
  });

  it('the page box of a turned stroke covers where it is turned, and its geometry has the same box', () => {
    const rig = penRig();
    const ink = turnedStroke(rig);
    const b = shapeBounds(ink, rig.core.store.kinds);
    expect(b?.minX).toBeLessThan(100);
    expect(b?.maxX).toBeGreaterThan(100);
    expect(b?.maxX ?? 0).toBeLessThan(120);
    expect(b?.minY).toBeLessThan(1);
    expect(b?.maxY).toBeGreaterThan(199);
  });

  it('the select tool selects it where it is turned: a click, and a box that meets the turned stroke only', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(0, 100, 200, 100, 20));
    const ink = strokes(rig)[0] as ShapeRecord;
    rig.core.store.change('user', (tx) => void tx.update(ink.id, { rotation: Math.PI / 2 }));
    rig.host.setTool('select');
    drag(rig, [60, 10], [140, 40]);
    expect(rig.core.selection.ids).toEqual([ink.id]);
    drag(rig, [10, 90], [50, 110], 0, 6, 1000);
    expect(rig.core.selection.ids).toEqual([]);
  });

  it('the lasso selects it where it is turned', () => {
    const rig = shapeRig('pen');
    const ink = turnedStroke(rig);
    rig.host.setTool('lasso');
    drawPath(rig, [[60, -20], [140, -20], [140, 220], [60, 220], [60, -18]], {}, 5000);
    expect(rig.core.selection.ids).toEqual([ink.id]);
    drawPath(rig, [[-20, 60], [220, 60], [220, 140], [-20, 140], [-20, 62]], {}, 6000);
    // a loop round the old place of the stroke holds only the middle of the turned one, which is less than half of it
    expect(rig.core.selection.ids).toEqual([]);
  });

  it('the eraser touches it where it is turned', () => {
    const rig = penRig();
    const ink = turnedStroke(rig) as Parameters<typeof inkTouches>[0];
    expect(inkTouches(ink, 90, 30, 110, 30, 4)).toBe(true);
    expect(inkTouches(ink, 10, 90, 30, 110, 4)).toBe(false);
  });

  it('erasing part of a turned stroke cuts it where it is drawn, and the pieces stay in place', () => {
    const rig = penRig();
    turnedStroke(rig);
    rig.styles.eraser = { mode: 'partial', radius: 6 };
    rig.host.setTool('eraser');
    drawPath(rig, line(80, 100, 120, 100, 6), {}, 5000);
    const pieces = strokes(rig);
    expect(pieces).toHaveLength(2);
    const all = pieces.flatMap((p) => Array.from(strokePoints(p as Parameters<typeof strokePoints>[0])));
    const ys = all.filter((_v, i) => i % 2 === 1);
    const xs = all.filter((_v, i) => i % 2 === 0);
    for (const x of xs) expect(x).toBeCloseTo(100, 2);
    // nothing is left within the radius of the cut at y = 100
    expect(ys.some((y) => Math.abs(y - 100) < 3)).toBe(false);
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
    expect(Math.max(...ys)).toBeCloseTo(200, 1);
  });

  it('turning a stroke with the rotate handle writes only its rotation; the points array is the same one', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(0, 100, 200, 100, 20));
    rig.host.setTool('select');
    const ink = strokes(rig)[0] as ShapeRecord;
    rig.core.selection.set([ink.id]);
    const before = pointsOf(ink);
    const steps = rig.core.history.undoSteps;
    // the middle of the stroke is (100, 100); the rotate handle is above the box; turn a quarter turn
    const top = shapeBounds(ink, rig.core.store.kinds);
    drag(rig, [100, (top?.minY ?? 90) - 26], [200, 100], 0, 12, 2000);
    const turned = get(rig, ink.id);
    expect(turned.rotation).toBeCloseTo(Math.PI / 2, 4);
    expect(pointsOf(turned)).toBe(before);
    expect(rig.core.history.undoSteps).toBe(steps + 1);
    rig.core.history.undo();
    expect(get(rig, ink.id).rotation).toBe(0);
  });

  it('a stroke and a shape selected together turn together about the middle of their box', () => {
    const rig = shapeRig('pen');
    drawPath(rig, line(0, 100, 100, 100, 10));
    rig.host.setTool('select');
    const ink = strokes(rig)[0] as ShapeRecord;
    const box = add(rig, 'rect', 200, 80, { w: 100, h: 40, fill: '#ffcc00' });
    rig.core.selection.set([ink.id, box.id]);
    // the box that holds both is x 0..300 and its middle is (150, 100): a half turn swaps the places of the two
    const frame = frameOf(rig.core, [ink.id, box.id]);
    const grip = frame === undefined ? undefined : handlesOf(rig.core, frame, 1).find((h) => h.kind === 'rotate');
    expect(grip).toBeDefined();
    drag(rig, [grip?.x ?? 0, grip?.y ?? 0], [frame?.cx ?? 0, (frame?.cy ?? 0) + 200], 0, 12, 3000);
    const c = shapeGeometry(get(rig, box.id), rig.core.store.kinds);
    const xs = strokePoints(get(rig, ink.id) as Parameters<typeof strokePoints>[0]).filter((_v, i) => i % 2 === 0);
    const inkCx = (Math.min(...xs) + Math.max(...xs)) / 2;
    // they swapped sides and kept the distance between their middles (200) and their height
    expect(c?.pageCx ?? 0).toBeLessThan(inkCx);
    expect(inkCx - (c?.pageCx ?? 0)).toBeCloseTo(200, 0);
    expect(c?.pageCy).toBeCloseTo(100, 1);
    expect(Math.abs(Math.abs(get(rig, ink.id).rotation) - Math.PI)).toBeLessThan(1e-6);
    expect(Math.abs(Math.abs(get(rig, box.id).rotation) - Math.PI)).toBeLessThan(1e-6);
  });

  it('the rotation of a stroke is saved and loaded', () => {
    const rig = penRig();
    const ink = turnedStroke(rig);
    const text = saveBoard(rig.core.store);
    if (!text.ok) throw new Error(text.message);
    const loaded = loadBoard(text.value);
    if (!loaded.ok) throw new Error(loaded.message);
    const back = loaded.value.store.get(ink.id) as ShapeRecord | undefined;
    expect(back?.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(dump(loaded.value.store)).toBeDefined();
  });

  it('a hold fixes a stroke where it is drawn, not where it is turned: a turned stroke is fixed at its place on the page', () => {
    const rig = penRig();
    drawPath(rig, roughEllipse(100, 100, 80, 80));
    const ink = strokes(rig)[0] as ShapeRecord;
    rig.core.store.change('user', (tx) => void tx.update(ink.id, { rotation: Math.PI / 3 }));
    const turnedPoints = strokePoints(get(rig, ink.id) as Parameters<typeof strokePoints>[0]);
    const r = fixStrokes(rig.core, [ink.id]);
    expect(r.ok && r.value).toHaveLength(1);
    const made = get(rig, (r.ok ? r.value[0] : '') as string);
    expect(made.kind).toBe('ellipse');
    const g = shapeGeometry(made, rig.core.store.kinds);
    const xs = turnedPoints.filter((_v, i) => i % 2 === 0);
    const ys = turnedPoints.filter((_v, i) => i % 2 === 1);
    expect(g?.pageCx).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 0);
    expect(g?.pageCy).toBeCloseTo((Math.min(...ys) + Math.max(...ys)) / 2, 0);
  });
});
