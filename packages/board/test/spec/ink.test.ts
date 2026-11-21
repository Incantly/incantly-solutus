// @vitest-environment node
/**
 * Ink (docs/features/board/design.md 4, 6.1 to 6.3; requirements R2.3, R4.1 to R4.4; state-machines B7): samples to
 * points (0.5 px filter, simulated pressure, tilt), the outline (pressure to width, round caps, one winding, cached
 * until the stroke changes), a stroke is one undo step, nothing is stored while drawing, predicted samples are never
 * stored, and a stored record's points are never changed in place (BR-10).
 */
import { describe, expect, it } from 'vitest';
import { FIRST_KEY, InkSampler, MIN_DISTANCE_PX, MIN_PRESSURE_STEP, OutlineCache, outlineOf } from '../../src/index';
import type { Diff, Nib, Outline, ShapeRecord } from '../../src/index';
import { copyOf, drawPath, line, makeRig, pointCount, pointsOf, sample, strokes } from './ink-helpers';

const cam = (x = 0, y = 0, zoom = 1): { x: number; y: number; zoom: number } => ({ x, y, zoom });

describe('samples to points (design 6.1)', () => {
  it('screen pixels become page units through the camera; the first sample is the origin of the stroke', () => {
    const s = new InkSampler(3);
    const camera = cam(100, 50, 2);
    expect(s.add(sample({ x: 20, y: 10, pressure: 0.6 }), camera)).toBe(true);
    expect(s.add(sample({ x: 30, y: 10, pressure: 0.6 }), camera)).toBe(true);
    expect([s.originX, s.originY]).toEqual([110, 55]);
    const a = s.buffer.array;
    expect([a[0], a[1]]).toEqual([0, 0]);
    expect(a[3]).toBeCloseTo(5, 5);
    expect(a[4]).toBeCloseTo(0, 5);
    expect(s.buffer.count).toBe(2);
  });

  it('a sample closer than 0.5 screen pixels to the last kept one is dropped', () => {
    expect(MIN_DISTANCE_PX).toBe(0.5);
    const s = new InkSampler(3);
    s.add(sample({ x: 0, y: 0 }), cam());
    expect(s.add(sample({ x: 0.3, y: 0, time: 8 }), cam())).toBe(false);
    expect(s.add(sample({ x: 0.2, y: 0.2, time: 16 }), cam())).toBe(false);
    expect(s.buffer.count).toBe(1);
  });

  it('the filter measures from the last kept sample, so slow steps still add up', () => {
    const s = new InkSampler(3);
    const kept = [0, 0.3, 0.6, 0.9, 1.2].map((x, i) => s.add(sample({ x, y: 0, time: i * 8 }), cam()));
    expect(kept).toEqual([true, false, true, false, true]);
  });

  it('a sample 0.5 pixel or more away is kept', () => {
    const s = new InkSampler(3);
    s.add(sample({ x: 0, y: 0 }), cam());
    expect(s.add(sample({ x: 0.5, y: 0, time: 8 }), cam())).toBe(true);
  });

  it('a close sample is kept when the pressure changed by more than 0.05, and dropped when it changed by less', () => {
    expect(MIN_PRESSURE_STEP).toBe(0.05);
    const s = new InkSampler(3);
    s.add(sample({ x: 0, y: 0, pressure: 0.5 }), cam());
    expect(s.add(sample({ x: 0.1, y: 0, pressure: 0.56, time: 8 }), cam())).toBe(true);
    expect(s.add(sample({ x: 0.2, y: 0, pressure: 0.59, time: 16 }), cam())).toBe(false);
    expect(s.buffer.count).toBe(2);
  });

  it('the 0.5 px is in screen pixels, not page units, at any zoom', () => {
    const zoomedIn = new InkSampler(3);
    zoomedIn.add(sample({ x: 0, y: 0 }), cam(0, 0, 4));
    // 0.6 screen pixels is only 0.15 page units, and is kept
    expect(zoomedIn.add(sample({ x: 0.6, y: 0, time: 8 }), cam(0, 0, 4))).toBe(true);
    const zoomedOut = new InkSampler(3);
    zoomedOut.add(sample({ x: 0, y: 0 }), cam(0, 0, 0.25));
    // 0.3 screen pixels is 1.2 page units, and is dropped
    expect(zoomedOut.add(sample({ x: 0.3, y: 0, time: 8 }), cam(0, 0, 0.25))).toBe(false);
  });

  it('a sample that is not a number is ignored and stores nothing', () => {
    const s = new InkSampler(3);
    s.add(sample({ x: 0, y: 0 }), cam());
    expect(s.add(sample({ x: Number.NaN, y: 3, time: 8 }), cam())).toBe(false);
    expect(s.add(sample({ x: 4, y: Number.POSITIVE_INFINITY, time: 16 }), cam())).toBe(false);
    expect(s.buffer.count).toBe(1);
  });

  it('a pen with a sensor stores its pressure, kept inside 0 to 1', () => {
    const s = new InkSampler(3);
    s.add(sample({ x: 0, y: 0, pressure: 0.25 }), cam());
    s.add(sample({ x: 5, y: 0, pressure: 1.7, time: 8 }), cam());
    s.add(sample({ x: 10, y: 0, pressure: -0.3, time: 16 }), cam());
    const a = s.buffer.array;
    expect([a[2], a[5], a[8]]).toEqual([0.25, 1, 0]);
  });

  it('a stroke stores x, y, pressure (3 numbers a point), and tilt (5 numbers) only when the sampler is made for it', () => {
    const flat = new InkSampler(3);
    const tilted = new InkSampler(5);
    for (const s of [flat, tilted]) {
      s.add(sample({ x: 0, y: 0, tiltX: 20, tiltY: -30 }), cam());
      s.add(sample({ x: 5, y: 0, tiltX: 21, tiltY: -29, time: 8 }), cam());
    }
    expect(flat.buffer.copy()).toHaveLength(6);
    expect(tilted.buffer.copy()).toHaveLength(10);
    const t = tilted.buffer.array;
    expect([t[3], t[4], t[8], t[9]]).toEqual([20, -30, 21, -29]);
  });

  it('PointBuffer.copy shares no memory with the buffer', () => {
    const s = new InkSampler(3);
    s.add(sample({ x: 0, y: 0 }), cam());
    s.add(sample({ x: 8, y: 0, time: 8 }), cam());
    const out = s.buffer.copy();
    out[0] = 999;
    expect(s.buffer.array[0]).toBe(0);
    s.reset();
    expect(out[3]).toBeCloseTo(8, 5);
  });
});

describe('simulated pressure (R4.2, design 6.1 item 3)', () => {
  /** The pressures a mouse stroke at `step` pixels every `dt` ms stores. */
  const mouseStroke = (n: number, step: number, dt: number): readonly number[] => {
    const s = new InkSampler(3);
    for (let i = 0; i < n; i++) s.add(sample({ device: 'mouse', pressure: Number.NaN, x: i * step, y: 0, time: i * dt }), cam());
    const out: number[] = [];
    for (let i = 0; i < s.buffer.count; i++) out.push(s.buffer.array[i * 3 + 2] as number);
    return out;
  };

  it('a mouse line gets a pressure for every point, inside 0 to 1', () => {
    const p = mouseStroke(30, 3, 16);
    expect(p.length).toBe(30);
    expect(p.every((v) => Number.isFinite(v) && v > 0 && v <= 1)).toBe(true);
  });

  it('fast is thin: the same line drawn fast ends with a lower pressure than drawn slowly', () => {
    const slow = mouseStroke(40, 1, 16);
    const fast = mouseStroke(40, 30, 4);
    expect(fast[fast.length - 1] as number).toBeLessThan((slow[slow.length - 1] as number) - 0.2);
  });

  it('pressure follows speed: a stroke that speeds up gets thinner, one that slows down gets thicker', () => {
    const s = new InkSampler(3);
    let x = 0;
    for (let i = 0; i < 60; i++) {
      x += i < 30 ? 1 : 25;
      s.add(sample({ device: 'mouse', pressure: Number.NaN, x, y: 0, time: i * 8 }), cam());
    }
    const a = s.buffer.array;
    const atSlow = a[(25 - 1) * 3 + 2] as number;
    const atFast = a[(s.buffer.count - 1) * 3 + 2] as number;
    expect(atFast).toBeLessThan(atSlow);
  });

  it('the first point of a simulated stroke is a middling pressure, not NaN or 0', () => {
    const p = mouseStroke(1, 1, 8);
    expect(p[0]).toBeGreaterThan(0.2);
    expect(p[0]).toBeLessThan(1);
  });

  it('a stroke made with a pen that has no sensor (NaN) stores simulated pressure through the pen tool', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 120, 0, 24), { pressure: Number.NaN });
    const [stroke] = strokes(rig);
    expect(stroke).toBeDefined();
    const a = pointsOf(stroke as ShapeRecord);
    const pressures = Array.from({ length: a.length / 3 }, (_v, i) => a[i * 3 + 2] as number);
    expect(pressures.every((v) => Number.isFinite(v) && v > 0 && v <= 1)).toBe(true);
  });
});

/** The vertical extent of an outline (its height) and the other numbers of its bounds. */
const height = (o: Outline): number => o.bounds.maxY - o.bounds.minY;

/** A straight horizontal stroke of `n` points 10 apart at one pressure (stride 3). */
function flatLine(pressure: number, n = 11, tilt?: readonly [number, number]): { points: Float32Array; stride: 3 | 5 } {
  const stride = tilt === undefined ? 3 : 5;
  const points = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) {
    points[i * stride] = i * 10;
    points[i * stride + 1] = 0;
    points[i * stride + 2] = pressure;
    if (tilt !== undefined) {
      points[i * stride + 3] = tilt[0];
      points[i * stride + 4] = tilt[1];
    }
  }
  return { points, stride };
}

const outline = (pressure: number, nib: Nib, size = 10, tilt?: readonly [number, number]): Outline => {
  const f = flatLine(pressure, 11, tilt);
  return outlineOf(f.points, f.stride, { size, nib, tolerance: 0.05 });
};

describe('outline (design 6.2)', () => {
  it('width comes from pressure: harder is wider, and full pressure is the nib size', () => {
    const widths = [0.1, 0.3, 0.6, 0.9, 1].map((p) => height(outline(p, 'pen')));
    for (let i = 1; i < widths.length; i++) expect(widths[i] as number).toBeGreaterThan(widths[i - 1] as number);
    expect(widths[4]).toBeGreaterThan(9);
    expect(widths[4]).toBeLessThan(10.5);
    expect(widths[0]).toBeLessThan(widths[4] as number / 1.5);
  });

  it('a stroke that presses harder along its length gets wider along its length', () => {
    const n = 21;
    const points = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      points[i * 3] = i * 10;
      points[i * 3 + 2] = 0.1 + (0.9 * i) / (n - 1);
    }
    const o = outlineOf(points, 3, { size: 12, nib: 'pen', tolerance: 0.05 });
    const reach = (from: number, to: number): number => {
      let m = 0;
      for (let i = 0; i < o.vertices.length; i += 2) {
        const x = o.vertices[i] as number;
        if (x >= from && x <= to) m = Math.max(m, Math.abs(o.vertices[i + 1] as number));
      }
      return m;
    };
    expect(reach(150, 190)).toBeGreaterThan(reach(10, 50) * 1.4);
  });

  it('the highlighter nib has one width whatever the pressure', () => {
    expect(height(outline(0.2, 'highlighter', 18))).toBeCloseTo(height(outline(1, 'highlighter', 18)), 3);
    expect(height(outline(1, 'highlighter', 18))).toBeGreaterThan(17);
  });

  it('round caps: the stroke reaches half a width past each end, and the cap has many corners', () => {
    const o = outline(1, 'highlighter', 20);
    expect(o.bounds.minX).toBeLessThan(-9);
    expect(o.bounds.minX).toBeGreaterThan(-11);
    expect(o.bounds.maxX).toBeGreaterThan(109);
    expect(o.bounds.maxX).toBeLessThan(111);
    const behind: number[] = [];
    for (let i = 0; i < o.vertices.length; i += 2) {
      const x = o.vertices[i] as number;
      const y = o.vertices[i + 1] as number;
      if (x < -0.5) behind.push(Math.hypot(x, y));
    }
    // a flat end would have no vertex behind the first point; a round one has a fan of them, all on the circle
    expect(behind.length).toBeGreaterThanOrEqual(3);
    for (const d of behind) expect(d).toBeLessThanOrEqual(10.2);
  });

  it('a stroke of one point (a tap) is a round dot the width of the nib', () => {
    const o = outlineOf(new Float32Array([0, 0, 0.6]), 3, { size: 20, nib: 'highlighter', tolerance: 0.05 });
    expect(o.vertices.length / 2).toBeGreaterThan(8);
    expect(o.bounds.maxX - o.bounds.minX).toBeGreaterThan(19);
    expect(o.bounds.maxX - o.bounds.minX).toBeLessThan(21);
    expect(height(o)).toBeCloseTo(o.bounds.maxX - o.bounds.minX, 1);
  });

  it('a stroke with no points has no triangles', () => {
    const o = outlineOf(new Float32Array(0), 3, { size: 10, nib: 'pen', tolerance: 0.1 });
    expect(o.indices.length).toBe(0);
  });

  it('all triangles have one winding, so their union is the stroke, even over a sharp turn (6.2 item 4)', () => {
    const pts: [number, number][] = [[0, 0], [40, 0], [80, 3], [20, 30], [60, 32], [10, 70], [15, 72], [90, 20], [92, 60]];
    const points = new Float32Array(pts.length * 3);
    pts.forEach(([x, y], i) => {
      points[i * 3] = x;
      points[i * 3 + 1] = y;
      points[i * 3 + 2] = 0.7;
    });
    for (const nib of ['pen', 'marker', 'pencil', 'highlighter'] as const) {
      const o = outlineOf(points, 3, { size: 14, nib, tolerance: 0.05 });
      expect(o.indices.length).toBeGreaterThan(0);
      expect(o.indices.length % 3).toBe(0);
      let positive = 0;
      let negative = 0;
      for (let i = 0; i < o.indices.length; i += 3) {
        const a = (o.indices[i] as number) * 2;
        const b = (o.indices[i + 1] as number) * 2;
        const c = (o.indices[i + 2] as number) * 2;
        const v = o.vertices;
        const area = ((v[b] as number) - (v[a] as number)) * ((v[c + 1] as number) - (v[a + 1] as number)) - ((v[c] as number) - (v[a] as number)) * ((v[b + 1] as number) - (v[a + 1] as number));
        if (area > 1e-9) positive++;
        else if (area < -1e-9) negative++;
      }
      expect(Math.min(positive, negative), `${nib}: triangles of both windings`).toBe(0);
      expect(positive + negative).toBeGreaterThan(0);
    }
  });

  it('a turn of more than 30 degrees gets an arc on the outside, so the line does not pinch (6.2 item 3)', () => {
    const corner = (angle: number): number => {
      const pts = [[0, 0], [50, 0], [50 + 50 * Math.cos(angle), 50 * Math.sin(angle)]];
      const points = new Float32Array(9);
      pts.forEach(([x, y], i) => {
        points[i * 3] = x as number;
        points[i * 3 + 1] = y as number;
        points[i * 3 + 2] = 1;
      });
      return outlineOf(points, 3, { size: 16, nib: 'highlighter', tolerance: 0.05 }).vertices.length;
    };
    // a gentle bend has no arc; a sharp one adds vertices for it
    expect(corner((150 * Math.PI) / 180)).toBeGreaterThan(corner((10 * Math.PI) / 180));
  });

  it('the pen nib ignores tilt; the marker and the highlighter get wider across it', () => {
    const base = height(outline(1, 'pen', 10, [0, 0]));
    for (const tilt of [[60, 0], [0, 60], [60, 60]] as const) expect(height(outline(1, 'pen', 10, tilt))).toBeCloseTo(base, 6);
    for (const nib of ['marker', 'highlighter'] as const) {
      const wider = Math.max(...([[60, 0], [0, 60], [60, 60]] as const).map((t) => height(outline(1, nib, 10, t))));
      expect(wider, nib).toBeGreaterThan(height(outline(1, nib, 10, [0, 0])) * 1.05);
    }
  });
});

describe('the outline is cached until the stroke changes (design 6.2 item 4, R4.3)', () => {
  const f = flatLine(0.8);

  it('the same stroke and zoom step give the very same outline', () => {
    const cache = new OutlineCache();
    const owner = {};
    const a = cache.get(owner, f.points, f.stride, { size: 8, nib: 'pen', tolerance: 0.25 });
    const b = cache.get(owner, f.points, f.stride, { size: 8, nib: 'pen', tolerance: 0.25 });
    expect(b).toBe(a);
    expect(cache.has(owner, 0.25)).toBe(true);
  });

  it('a changed stroke (a new record) gets a new outline; a new zoom step rebuilds', () => {
    const cache = new OutlineCache();
    const owner = {};
    const a = cache.get(owner, f.points, f.stride, { size: 8, nib: 'pen', tolerance: 0.25 });
    expect(cache.get({}, f.points, f.stride, { size: 8, nib: 'pen', tolerance: 0.25 })).not.toBe(a);
    expect(cache.get(owner, f.points, f.stride, { size: 8, nib: 'pen', tolerance: 0.5 })).not.toBe(a);
  });

  it('the draw list gives a stored stroke the same outline every frame, and panning never rebuilds it', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 100, 40, 12));
    const [stroke] = strokes(rig);
    const first = rig.core.drawList.itemOf(stroke as ShapeRecord, 1);
    const again = rig.core.drawList.itemOf(stroke as ShapeRecord, 1);
    expect(first).toBeDefined();
    expect(again?.outline).toBe(first?.outline);
    rig.core.camera?.panBy(300, -120);
    expect(rig.core.drawList.itemOf(stroke as ShapeRecord, 1)?.outline).toBe(first?.outline);
  });

  it('moving a stroke does not rebuild its outline (design 6.2 item 4: "Moving or panning never rebuilds them")', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 100, 40, 12));
    const [stroke] = strokes(rig);
    const before = rig.core.drawList.itemOf(stroke as ShapeRecord, 1);
    const moved = rig.core.store.change('user', (tx) => {
      tx.update((stroke as ShapeRecord).id, { x: (stroke as ShapeRecord).x + 200 });
    });
    expect(moved.ok).toBe(true);
    const after = strokes(rig)[0] as ShapeRecord;
    expect(after.x).toBe((stroke as ShapeRecord).x + 200);
    expect(rig.core.drawList.itemOf(after, 1)?.outline).toBe(before?.outline);
  });
});

describe('a stroke is stored when the pen comes up, as one undo step (R2.3, design 4, 6.3, B7)', () => {
  it('nothing is written to the store while drawing; the pen coming up writes one record', () => {
    const rig = makeRig();
    const diffs: Diff[] = [];
    rig.core.store.on((d) => diffs.push(d));
    const path = line(10, 10, 210, 90, 40);
    path.forEach(([x, y], i) => {
      if (i === path.length - 1) return;
      rig.host.sample(sample({ x, y, phase: i === 0 ? 'down' : 'move', time: i * 8 }));
      expect(strokes(rig)).toHaveLength(0);
    });
    expect(diffs).toHaveLength(0);
    expect(rig.core.live.state).toBe('drawing');
    expect(rig.core.live.count).toBeGreaterThan(30);
    const [x, y] = path[path.length - 1] as readonly [number, number];
    rig.host.sample(sample({ x, y, phase: 'up', time: 400 }));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.added).toHaveLength(1);
    expect(diffs[0]?.updated).toHaveLength(0);
    expect(diffs[0]?.removed).toHaveLength(0);
    expect(diffs[0]?.added[0]).toMatchObject({ kind: 'ink' });
    expect(rig.core.live.state).toBe('idle');
    expect(rig.core.live.count).toBe(0);
  });

  it('however many samples it had, a stroke is one undo step, and undo and redo bring it back whole', () => {
    const rig = makeRig();
    expect(rig.core.history.undoSteps).toBe(0);
    drawPath(rig, line(0, 0, 300, 120, 80));
    expect(rig.core.history.undoSteps).toBe(1);
    expect(strokes(rig)).toHaveLength(1);
    const kept = copyOf(strokes(rig)[0] as ShapeRecord);
    expect(rig.core.history.undo().ok).toBe(true);
    expect(strokes(rig)).toHaveLength(0);
    expect(rig.core.history.canUndo).toBe(false);
    expect(rig.core.history.redo().ok).toBe(true);
    expect(copyOf(strokes(rig)[0] as ShapeRecord)).toEqual(kept);
  });

  it('three strokes are three undo steps', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 100, 0));
    drawPath(rig, line(0, 20, 100, 20));
    drawPath(rig, line(0, 40, 100, 40));
    expect(rig.core.history.undoSteps).toBe(3);
    rig.core.history.undo();
    expect(strokes(rig)).toHaveLength(2);
  });

  it('a stroke is stored in page units relative to its origin: points start at 0, 0 and the shape sits where it began', () => {
    const rig = makeRig();
    rig.core.camera?.moveTo(-40, 25, 2, 0);
    drawPath(rig, line(100, 60, 200, 60, 10));
    const s = strokes(rig)[0] as ShapeRecord;
    // screen (100, 60) at zoom 2 and camera (-40, 25) is page (10, 55)
    expect(s.x).toBeCloseTo(10, 4);
    expect(s.y).toBeCloseTo(55, 4);
    const a = pointsOf(s);
    expect([a[0], a[1]]).toEqual([0, 0]);
    expect(a[(pointCount(s) - 1) * 3]).toBeCloseTo(50, 3);
  });

  it('jitter under 0.5 px is not stored', () => {
    const rig = makeRig();
    drawPath(rig, [[50, 50], [50.2, 50.1], [49.9, 50.2], [50.3, 49.8], [50.1, 50], [50.2, 50.2]]);
    const s = strokes(rig);
    expect(s).toHaveLength(1);
    expect(pointCount(s[0] as ShapeRecord)).toBe(1);
  });

  it('the stroke takes the style of the tool when it began: colour, size, nib, opacity', () => {
    const rig = makeRig();
    rig.styles.pen = { nib: 'pencil', size: 7, color: '#ff0000', opacity: 0.8 };
    drawPath(rig, line(0, 0, 80, 0));
    expect((strokes(rig)[0] as ShapeRecord).props).toMatchObject({ nib: 'pencil', size: 7, color: '#ff0000', opacity: 0.8 });
  });

  it('a stroke that is cancelled (a second finger, the palm, the page changed) stores nothing and is no undo step', () => {
    const rig = makeRig();
    rig.host.sample(sample({ x: 5, y: 5, phase: 'down' }));
    rig.host.sample(sample({ x: 50, y: 50, phase: 'move', time: 8 }));
    expect(rig.core.live.state).toBe('drawing');
    rig.host.cancel();
    expect(rig.core.live.state).toBe('idle');
    expect(strokes(rig)).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(0);
    rig.host.sample(sample({ x: 5, y: 5, phase: 'down' }));
    rig.host.sample(sample({ x: 60, y: 60, phase: 'cancel', time: 16 }));
    expect(strokes(rig)).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(0);
  });

  it('a stroke over the ink limit is refused with nothing changed and the machine idle (B7)', () => {
    const rig = makeRig({ core: { limits: { inkPointsPerPage: 12 } } });
    drawPath(rig, line(0, 0, 300, 0, 30));
    expect(strokes(rig)).toHaveLength(0);
    expect(rig.core.history.undoSteps).toBe(0);
    expect(rig.core.live.state).toBe('idle');
    // the board still takes a stroke that fits
    drawPath(rig, line(0, 10, 50, 10, 5));
    expect(strokes(rig)).toHaveLength(1);
  });

  it('LiveStroke.end with no stroke is bad_argument, and add or end when idle change nothing (B7: no row)', () => {
    const rig = makeRig();
    const r = rig.core.live.end(rig.core.store);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.kind).toBe('bad_argument');
    expect(rig.core.live.add(sample({ x: 1, y: 1 }), { x: 0, y: 0, zoom: 1 })).toBe(false);
    expect(rig.core.live.count).toBe(0);
    expect(rig.core.store.all('shape')).toHaveLength(0);
  });

  it('a second begin while a stroke is drawn is refused', () => {
    const rig = makeRig();
    const page = rig.core.pages.current as string;
    const style = { nib: 'pen' as const, size: 3, color: '#000000', opacity: 1 };
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(rig.core.live.begin(sample({ x: 0, y: 0 }), camera, page, style, false)).toBe(true);
    expect(rig.core.live.begin(sample({ x: 90, y: 90 }), camera, page, style, false)).toBe(false);
    rig.core.live.add(sample({ x: 10, y: 0, time: 8 }), camera);
    expect(rig.core.live.count).toBe(2);
  });
});

describe('predicted samples are drawn but never stored (R4.4, design 6.3)', () => {
  it('a stroke with predicted samples stores only the real ones', () => {
    const rig = makeRig();
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    for (let i = 1; i <= 10; i++) {
      rig.host.sample(sample({ x: i * 10, y: 0, phase: 'move', time: i * 8 }));
      // two guesses ahead of the pen, far to the right
      rig.host.sample(sample({ x: 500 + i, y: 0, phase: 'move', predicted: true, time: i * 8 + 4 }));
      rig.host.sample(sample({ x: 520 + i, y: 0, phase: 'move', predicted: true, time: i * 8 + 5 }));
    }
    rig.host.sample(sample({ x: 100, y: 0, phase: 'up', time: 100 }));
    const s = strokes(rig);
    expect(s).toHaveLength(1);
    const a = pointsOf(s[0] as ShapeRecord);
    const xs = Array.from({ length: a.length / 3 }, (_v, i) => a[i * 3] as number);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100);
    expect(xs).toHaveLength(11);
  });

  it('the live stroke offers its predicted tail to the painter, and drops it with the next real sample', () => {
    const rig = makeRig();
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    rig.host.sample(sample({ x: 20, y: 0, phase: 'move', time: 8 }));
    rig.host.sample(sample({ x: 30, y: 0, phase: 'move', predicted: true, time: 10 }));
    rig.host.sample(sample({ x: 40, y: 0, phase: 'move', predicted: true, time: 12 }));
    rig.core.live.rebuild(1);
    const view = rig.core.live.view();
    expect(view.predicted?.count).toBe(2);
    expect([view.predicted?.xy[0], view.predicted?.xy[2]]).toEqual([30, 40]);
    rig.host.sample(sample({ x: 33, y: 0, phase: 'move', time: 16 }));
    rig.core.live.rebuild(1);
    expect(rig.core.live.view().predicted).toBeNull();
    expect(rig.core.live.count).toBe(3);
  });

  it('predicted samples change nothing in the store while the stroke is drawn', () => {
    const rig = makeRig();
    const diffs: Diff[] = [];
    rig.core.store.on((d) => diffs.push(d));
    rig.host.sample(sample({ x: 0, y: 0, phase: 'down' }));
    rig.host.sample(sample({ x: 90, y: 0, phase: 'move', predicted: true, time: 4 }));
    expect(diffs).toHaveLength(0);
    expect(rig.core.live.count).toBe(1);
  });
});

describe('stored records are never changed in place (design 4, B7 BR-10)', () => {
  it('a stored stroke and its props are frozen: a write in place fails', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 60, 10));
    const s = strokes(rig)[0] as ShapeRecord;
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.props)).toBe(true);
    expect(() => {
      (s as { x: number }).x = 99;
    }).toThrow(TypeError);
    expect(() => {
      (s.props as { size: number }).size = 99;
    }).toThrow(TypeError);
  });

  it('the stored points are not the live buffer: the next stroke does not change the stroke before it', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 100, 0, 20));
    const first = strokes(rig)[0] as ShapeRecord;
    const before = copyOf(first);
    drawPath(rig, line(0, 50, 400, 300, 50), { pressure: 0.2 }, 1000);
    expect(strokes(rig)).toHaveLength(2);
    expect(copyOf(first)).toEqual(before);
    const second = strokes(rig).find((s) => s.id !== first.id) as ShapeRecord;
    expect(pointsOf(second)).not.toBe(pointsOf(first));
  });

  it('a stroke put into the store with an array the caller keeps is copied: writing to the caller array changes nothing stored', () => {
    const rig = makeRig();
    const mine = new Float32Array([0, 0, 0.5, 10, 0, 0.5, 20, 0, 0.5]);
    const page = rig.core.pages.current as string;
    const r = rig.core.store.change('user', (tx) =>
      tx.put({
        id: 'shape:ink-1', page, kind: 'ink', x: 0, y: 0, rotation: 0, parent: null, index: FIRST_KEY, locked: false, opacity: 1, meta: {},
        props: { points: mine, stride: 3, nib: 'pen', size: 3, color: '#000000', opacity: 1 },
      }),
    );
    expect(r.ok).toBe(true);
    mine[3] = 777;
    const stored = rig.core.store.get('shape:ink-1') as ShapeRecord;
    expect(pointsOf(stored)[3]).toBe(10);
    expect(pointsOf(stored)).not.toBe(mine);
  });

  it('an erase cuts into new records and leaves the original record whole; undo gives back the same points', () => {
    const rig = makeRig();
    rig.styles.eraser = { mode: 'partial', radius: 6 };
    drawPath(rig, line(0, 100, 200, 100, 40));
    const original = strokes(rig)[0] as ShapeRecord;
    const before = copyOf(original);
    rig.host.setTool('eraser');
    drawPath(rig, line(100, 80, 100, 120, 8), { buttons: 1 }, 2000);
    expect(strokes(rig).some((s) => s.id === original.id)).toBe(false);
    expect(copyOf(original)).toEqual(before);
    rig.core.history.undo();
    const back = rig.core.store.get(original.id) as ShapeRecord;
    expect(copyOf(back)).toEqual(before);
  });
});
