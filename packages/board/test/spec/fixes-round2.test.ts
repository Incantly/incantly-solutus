// @vitest-environment node
/**
 * The round 2 review's fixes (handoff/board/findings.md, BR-12 to BR-17): one test or more for each. BR-14 (the mode's
 * name) is tested in `packages/modes` and `apps/studio`.
 */
import { describe, expect, it } from 'vitest';
import {
  GATE_ALWAYS_MACHINE, GATE_MACHINE, IndexGrid, InkSampler, LiveStroke, Outliner, OutlineCache, PointerGate, mostlyInside, pointsInside,
} from '../../src/index';
import type { CameraView, InputSample, PenStyle, ShapeRecord } from '../../src/index';
import { drawPath, line, makeRig, sample, strokes } from './ink-helpers';
import { rng } from './helpers';

// ---------------------------------------------------------------------------------------------------------------
// BR-12

describe('BR-12: moving a stroke keeps the array its outline is cached by', () => {
  it('a patch to x, y, rotation or opacity writes a record that holds the same points array', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 100, 40, 12));
    const [stroke] = strokes(rig) as readonly [ShapeRecord];
    const points = (stroke.props as { points: Float32Array }).points;
    const moved = rig.core.store.change('user', (tx) => {
      tx.update(stroke.id, { x: stroke.x + 50, y: stroke.y - 20, rotation: 0.3, opacity: 0.5 });
    });
    expect(moved.ok).toBe(true);
    const [after] = strokes(rig) as readonly [ShapeRecord];
    expect(after).not.toBe(stroke);
    expect((after.props as { points: Float32Array }).points).toBe(points);
  });

  it('a drag of many strokes builds no outline again, and a change of points builds a new one', () => {
    const rig = makeRig();
    for (let i = 0; i < 20; i++) drawPath(rig, line(0, i * 30, 100, i * 30 + 10, 8), {}, i * 1000);
    const before = strokes(rig);
    const items = before.map((s) => rig.core.drawList.itemOf(s, 1));
    const moved = rig.core.store.change('user', (tx) => {
      for (const s of before) tx.update(s.id, { x: s.x + 300 });
    });
    expect(moved.ok).toBe(true);
    strokes(rig).forEach((s, i) => expect(rig.core.drawList.itemOf(s, 1)?.outline).toBe(items[i]?.outline));
    // new points are a new array, so a new outline
    const first = strokes(rig)[0] as ShapeRecord;
    const props = first.props as { points: Float32Array };
    const longer = new Float32Array([...props.points, 200, 60, 0.5]);
    rig.core.store.change('user', (tx) => {
      tx.update(first.id, { props: { points: longer } });
    });
    const changed = strokes(rig)[0] as ShapeRecord;
    expect(rig.core.drawList.itemOf(changed, 1)?.outline).not.toBe(items[0]?.outline);
  });

  it('an array the caller holds is still copied, so writing into it never changes the board (BR-10)', () => {
    const rig = makeRig();
    const mine = new Float32Array([0, 0, 0.5, 10, 10, 0.5]);
    const page = rig.core.pages.current as string;
    rig.core.store.change('user', (tx) => {
      tx.put({ id: tx.newId('shape'), page, kind: 'ink', x: 0, y: 0, rotation: 0, parent: null, index: 'a1', locked: false, opacity: 1, props: { points: mine, stride: 3, nib: 'pen', size: 3, color: '#000000', opacity: 1 }, meta: {} });
    });
    const [s] = strokes(rig) as readonly [ShapeRecord];
    expect((s.props as { points: Float32Array }).points).not.toBe(mine);
    mine[0] = 99;
    expect((s.props as { points: Float32Array }).points[0]).toBe(0);
  });

  it('the cache tells two strokes that share points but differ in size or nib apart', () => {
    const cache = new OutlineCache();
    const points = new Float32Array([0, 0, 0.5, 20, 0, 0.5, 40, 10, 0.5]);
    const a = cache.get(points, points, 3, { size: 4, nib: 'pen', tolerance: 0.25 });
    expect(cache.get(points, points, 3, { size: 4, nib: 'pen', tolerance: 0.25 })).toBe(a);
    expect(cache.get(points, points, 3, { size: 9, nib: 'pen', tolerance: 0.25 })).not.toBe(a);
    expect(cache.get(points, points, 3, { size: 9, nib: 'marker', tolerance: 0.25 })).not.toBe(cache.get(points, points, 3, { size: 9, nib: 'pen', tolerance: 0.25 }));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// BR-13

describe("BR-13: touchDraws 'always' works while a pen is near (B5)", () => {
  const pen = (phase: InputSample['phase'], time: number, pointer = 1): InputSample => sample({ device: 'pen', phase, time, pointer });
  const touch = (phase: InputSample['phase'], time: number, pointer: number): InputSample => sample({ device: 'touch', phase, time, pointer, pressure: Number.NaN });

  it('the tables differ in exactly one move: touchDown from penNear', () => {
    expect(GATE_MACHINE.penNear.touchDown).toBeUndefined();
    expect(GATE_ALWAYS_MACHINE.penNear.touchDown).toBe('touchDown');
    expect({ ...GATE_ALWAYS_MACHINE, penNear: GATE_MACHINE.penNear }).toEqual(GATE_MACHINE);
  });

  it('a finger draws while the pen hovers, and goes on drawing until it lifts', () => {
    const gate = new PointerGate({ touchDraws: 'always' });
    gate.admit(pen('hover', 0));
    expect(gate.state).toBe('penNear');
    expect(gate.admit(touch('down', 10, 7))).toBe('draw');
    expect(gate.state).toBe('touchDown');
    expect(gate.drawing).toBe(7);
    expect(gate.admit(touch('move', 18, 7))).toBe('draw');
    expect(gate.admit(touch('up', 26, 7))).toBe('draw');
    expect(gate.state).toBe('idle');
    expect(gate.touches).toBe(0);
  });

  it('a finger draws within the palm grace after the pen left', () => {
    const gate = new PointerGate({ touchDraws: 'always' });
    gate.admit(pen('hover', 0));
    gate.penAway();
    expect(gate.admit(touch('down', 20, 3))).toBe('draw');
  });

  it('while the pen is down a finger stays a second pointer: counted, never drawn', () => {
    const gate = new PointerGate({ touchDraws: 'always' });
    expect(gate.admit(pen('down', 0))).toBe('draw');
    expect(gate.admit(touch('down', 5, 7))).toBe('ignore');
    expect(gate.state).toBe('penDown');
    expect(gate.touches).toBe(1);
    expect(gate.drawing).toBe(-1);
    expect(gate.admit(touch('move', 9, 7))).toBe('ignore');
    expect(gate.admit(touch('up', 12, 7))).toBe('ignore');
    expect(gate.touches).toBe(0);
    expect(gate.admit(pen('up', 20))).toBe('draw');
  });

  it("the default gate still ignores a finger while a pen hovers, and 'never' ignores every finger", () => {
    const auto = new PointerGate();
    auto.admit(pen('hover', 0));
    expect(auto.admit(touch('down', 10, 7))).toBe('ignore');
    const never = new PointerGate({ touchDraws: 'never' });
    never.admit(pen('hover', 0));
    expect(never.admit(touch('down', 10, 7))).toBe('ignore');
  });

  it('two fingers still make a gesture with a pen near', () => {
    const gate = new PointerGate({ touchDraws: 'always' });
    gate.admit(pen('hover', 0));
    expect(gate.admit(touch('down', 10, 1))).toBe('draw');
    expect(gate.admit(touch('down', 12, 2))).toBe('gestureStart');
    expect(gate.state).toBe('gesture');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// BR-15

/** A stroke of `n` points on a line, with `x` of the shape and the points. */
function strokeAt(xs: readonly number[], y: number, id: string): ShapeRecord {
  const points = new Float32Array(xs.length * 3);
  xs.forEach((x, i) => {
    points[i * 3] = x;
    points[i * 3 + 1] = 0;
    points[i * 3 + 2] = 0.5;
  });
  return {
    id, page: 'page:1', kind: 'ink', x: 0, y, rotation: 0, parent: null, index: 'a1', locked: false, opacity: 1, meta: {},
    props: { points, stride: 3, nib: 'pen', size: 2, color: '#000000', opacity: 1 },
  } as unknown as ShapeRecord;
}

describe('BR-15: the lasso asks the index and counts points only where it must', () => {
  const square = [0, 0, 100, 0, 100, 100, 0, 100];

  it('mostlyInside answers as `pointsInside * 2 > count` does, on random strokes and loops', () => {
    const rand = rng(11);
    for (let run = 0; run < 400; run++) {
      const n = 1 + Math.floor(rand() * 12);
      const xs = Array.from({ length: n }, () => rand() * 160 - 30);
      const s = strokeAt(xs, rand() * 140 - 20, 'shape:x');
      const poly: number[] = [];
      const k = 3 + Math.floor(rand() * 6);
      for (let i = 0; i < k; i++) poly.push(rand() * 120 - 10, rand() * 120 - 10);
      const want = pointsInside(s as never, poly) * 2 > n;
      expect(mostlyInside(s as never, poly), `run ${run}`).toBe(want);
    }
  });

  it('mostlyInside: more than half is the rule, and a stroke with no point is not inside', () => {
    expect(mostlyInside(strokeAt([10, 20, 130, 140], 50, 'a') as never, square)).toBe(false);
    expect(mostlyInside(strokeAt([10, 20, 30, 140], 50, 'a') as never, square)).toBe(true);
    expect(mostlyInside(strokeAt([], 50, 'a') as never, square)).toBe(false);
  });

  it('queryLassoSplit says which boxes lie wholly inside the loop', () => {
    const g = new IndexGrid();
    g.insert('inside', { minX: 10, minY: 10, maxX: 20, maxY: 20 });
    g.insert('crossing', { minX: 90, minY: 40, maxX: 110, maxY: 50 });
    g.insert('outside', { minX: 200, minY: 200, maxX: 210, maxY: 210 });
    g.insert('around', { minX: -50, minY: -50, maxX: 150, maxY: 150 });
    g.insert('inBoxOfLoop', { minX: 0, minY: 0, maxX: 0.5, maxY: 0.5 });
    const out: string[] = [];
    const whole: boolean[] = [];
    // a triangle: the corner of the square above its diagonal is outside
    g.queryLassoSplit([0, 0, 100, 0, 0, 100], out, whole);
    const got = Object.fromEntries(out.map((id, i) => [id, whole[i]]));
    expect(got['inside']).toBe(true);
    expect(got['crossing']).toBeUndefined();
    expect(got['outside']).toBeUndefined();
    expect(got['around']).toBe(false);
    expect(out.length).toBe(whole.length);
    // the same ids as queryLasso
    expect([...out].sort()).toEqual(g.queryLasso([0, 0, 100, 0, 0, 100]).sort());
  });

  it('queryLassoSplit leaves out a box in the polygon\'s own box that the polygon does not reach', () => {
    const g = new IndexGrid();
    // an L-shaped loop: the notch at the top right holds no shape
    g.insert('notch', { minX: 70, minY: 70, maxX: 90, maxY: 90 });
    g.insert('arm', { minX: 10, minY: 70, maxX: 30, maxY: 90 });
    const out: string[] = [];
    const whole: boolean[] = [];
    g.queryLassoSplit([0, 0, 100, 0, 100, 50, 50, 50, 50, 100, 0, 100], out, whole);
    expect(out).toEqual(['arm']);
    expect(whole).toEqual([true]);
  });

  it('the lasso gives the same selection as counting every point, for strokes inside, across and outside the loop', () => {
    const rig = makeRig();
    const rand = rng(5);
    for (let i = 0; i < 60; i++) {
      const x0 = rand() * 380;
      const y0 = rand() * 380;
      drawPath(rig, line(x0, y0, x0 + rand() * 90, y0 + rand() * 90, 8), {}, i * 1000);
    }
    const loop = [[100, 80], [330, 60], [360, 300], [200, 340], [90, 250], [100, 82]] as const;
    rig.host.setTool('lasso');
    drawPath(rig, loop, {}, 99_000);
    const polygon = loop.slice(0, 5).flatMap(([x, y]) => [x, y]);
    const want = strokes(rig).filter((s) => {
      const n = (s.props as { points: Float32Array }).points.length / 3;
      return pointsInside(s as never, [...polygon, 100, 82]) * 2 > n;
    });
    expect(want.length).toBeGreaterThan(3);
    expect(want.length).toBeLessThan(60);
    expect(new Set(rig.core.selection.ids)).toEqual(new Set(want.map((s) => s.id)));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// BR-16

/** A wobbly stroke of `n` points with some sharp turns and repeated points. */
function wobble(n: number, stride: 3 | 5, seed: number): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(n * stride);
  let x = 0;
  let y = 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    a += (rand() - 0.5) * (i % 17 === 0 ? 3.2 : 0.7);
    const step = i % 29 === 5 ? 0 : 1 + rand() * 6;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    out[i * stride] = x;
    out[i * stride + 1] = y;
    out[i * stride + 2] = 0.2 + rand() * 0.8;
    if (stride === 5) {
      out[i * stride + 3] = (rand() - 0.5) * 120;
      out[i * stride + 4] = (rand() - 0.5) * 120;
    }
  }
  return out;
}

function expectSameOutline(grown: Outliner, whole: Outliner, label: string): void {
  expect(grown.vertexCount, `${label}: vertexCount`).toBe(whole.vertexCount);
  expect(grown.indexCount, `${label}: indexCount`).toBe(whole.indexCount);
  expect(grown.groups, `${label}: groups`).toBe(whole.groups);
  expect(Array.from(grown.vertices.subarray(0, grown.vertexCount * 2)), `${label}: vertices`).toEqual(Array.from(whole.vertices.subarray(0, whole.vertexCount * 2)));
  expect(Array.from(grown.indices.subarray(0, grown.indexCount)), `${label}: indices`).toEqual(Array.from(whole.indices.subarray(0, whole.indexCount)));
  expect(Array.from(grown.marks.subarray(0, grown.groups + 1)), `${label}: marks`).toEqual(Array.from(whole.marks.subarray(0, whole.groups + 1)));
  expect(grown.bounds, `${label}: bounds`).toEqual(whole.bounds);
}

describe('BR-16: a live stroke extends its outline, and it equals a full rebuild', () => {
  it('after every point of a stroke, for every nib and both strides', () => {
    for (const nib of ['pen', 'marker', 'pencil', 'highlighter'] as const) {
      for (const stride of [3, 5] as const) {
        const points = wobble(70, stride, 3 + stride);
        const grown = new Outliner();
        const whole = new Outliner();
        const opts = { size: 7, nib, tolerance: 0.2 };
        for (let n = 1; n <= 70; n++) {
          grown.extend(points, n, stride, opts);
          whole.build(points, n, stride, opts);
          expectSameOutline(grown, whole, `${nib} stride ${stride} n=${n}`);
        }
      }
    }
  });

  it('after several points at a time (a frame with many samples), and a call with nothing new', () => {
    const points = wobble(400, 3, 21);
    const grown = new Outliner();
    const whole = new Outliner();
    const opts = { size: 4, nib: 'pen' as const, tolerance: 0.1 };
    for (const n of [1, 2, 3, 9, 10, 11, 30, 30, 31, 100, 101, 250, 400, 400]) {
      grown.extend(points, n, 3, opts);
      whole.build(points, n, 3, opts);
      expectSameOutline(grown, whole, `n=${n}`);
    }
  });

  it('a change of tolerance or size, or a new stroke after `reset`, builds from nothing', () => {
    const points = wobble(120, 3, 4);
    const other = wobble(200, 3, 5);
    const grown = new Outliner();
    const whole = new Outliner();
    grown.extend(points, 60, 3, { size: 5, nib: 'pen', tolerance: 0.2 });
    grown.extend(points, 90, 3, { size: 5, nib: 'pen', tolerance: 0.05 });
    whole.build(points, 90, 3, { size: 5, nib: 'pen', tolerance: 0.05 });
    expectSameOutline(grown, whole, 'tolerance');
    grown.extend(points, 100, 3, { size: 9, nib: 'pen', tolerance: 0.05 });
    whole.build(points, 100, 3, { size: 9, nib: 'pen', tolerance: 0.05 });
    expectSameOutline(grown, whole, 'size');
    // a stroke that starts again with more points than the last one had
    grown.reset();
    grown.extend(other, 150, 3, { size: 9, nib: 'pen', tolerance: 0.05 });
    whole.build(other, 150, 3, { size: 9, nib: 'pen', tolerance: 0.05 });
    expectSameOutline(grown, whole, 'reset');
    // fewer points than before cannot be a continuation
    grown.extend(other, 40, 3, { size: 9, nib: 'pen', tolerance: 0.05 });
    whole.build(other, 40, 3, { size: 9, nib: 'pen', tolerance: 0.05 });
    expectSameOutline(grown, whole, 'fewer');
  });

  it('the live stroke\'s outline equals a full build of its points, frame by frame, and again for the next stroke', () => {
    const live = new LiveStroke();
    const camera: CameraView = { x: 0, y: 0, zoom: 1 };
    const style: PenStyle = { nib: 'pen', size: 5, color: '#102030', opacity: 1 };
    const whole = new Outliner();
    for (const length of [160, 220]) {
      const sampler = new InkSampler(3);
      const rand = rng(length);
      const first = sample({ x: 10, y: 10, phase: 'down', pressure: 0.5 });
      live.begin(first, camera, 'page:1', style, false);
      sampler.add(first, camera);
      let x = 10;
      let y = 10;
      for (let i = 1; i <= length; i++) {
        x += 1 + rand() * 5;
        y += (rand() - 0.5) * 8;
        const s = sample({ x, y, phase: 'move', time: i * 8, pressure: 0.3 + rand() * 0.6 });
        live.add(s, camera);
        sampler.add(s, camera);
        if (i % 3 === 0) {
          live.rebuild(2);
          whole.build(sampler.buffer.array, sampler.buffer.count, 3, { size: 5, nib: 'pen', tolerance: 0.125 });
          expectSameOutline(live.outliner, whole, `stroke of ${length}, sample ${i}`);
        }
      }
      live.cancel();
    }
  });

  it('a frame makes the same outline whatever the stroke length: the settled part is not made again', () => {
    const points = wobble(600, 3, 8);
    const o = new Outliner();
    const opts = { size: 4, nib: 'pen' as const, tolerance: 0.1 };
    o.extend(points, 500, 3, opts);
    const before = Array.from(o.vertices.subarray(0, 40));
    o.extend(points, 501, 3, opts);
    // the first vertices are the very numbers of the earlier call
    expect(Array.from(o.vertices.subarray(0, 40))).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// BR-17

describe('BR-17: a live stroke has no page when it is idle', () => {
  const camera: CameraView = { x: 0, y: 0, zoom: 1 };
  const style: PenStyle = { nib: 'pen', size: 3, color: '#000000', opacity: 1 };
  const at = (x: number, phase: InputSample['phase']): InputSample => sample({ x, y: x, phase, time: x });

  it('page is null before a stroke, the page while it is drawn, and null again after end and after cancel', () => {
    const rig = makeRig();
    const live = new LiveStroke();
    expect(live.page).toBeNull();
    expect(live.begin(at(1, 'down'), camera, 'page:1', style, false)).toBe(true);
    expect(live.state).toBe('drawing');
    expect(live.page).toBe('page:1');
    live.add(at(20, 'move'), camera);
    expect(live.end(rig.core.store).ok).toBe(true);
    expect(live.state).toBe('idle');
    expect(live.page).toBeNull();
    live.begin(at(1, 'down'), camera, 'page:1', style, false);
    live.cancel();
    expect(live.state).toBe('idle');
    expect(live.page).toBeNull();
  });

  it('page is null after a stroke the store refused', () => {
    const rig = makeRig({ core: { limits: { shapesPerPage: 0 } } });
    const live = new LiveStroke();
    const page = rig.core.pages.current as string;
    live.begin(at(1, 'down'), camera, page, style, false);
    live.add(at(30, 'move'), camera);
    const done = live.end(rig.core.store);
    expect(done.ok).toBe(false);
    expect(live.state).toBe('idle');
    expect(live.page).toBeNull();
  });

  it('the pen tool leaves page null once the pen is up', () => {
    const rig = makeRig();
    drawPath(rig, line(0, 0, 60, 20));
    expect(rig.core.live.state).toBe('idle');
    expect(rig.core.live.page).toBeNull();
  });
});
