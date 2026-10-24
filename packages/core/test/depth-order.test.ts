import { describe, expect, it } from 'vitest';
import type { Inc, Space3D, Vec3 } from '../src/api/types';
import { kit } from '../src/kits/space3d';
import { auditDepth } from '../src/kits/space3d/audit';
import { DEPTH_TOLERANCE, EVEN, mendOrder, nearer, prepare, type DepthView, type PieceShape } from '../src/kits/space3d/depth';
import { MODEL_NAMES } from '../src/kits/space3d/models';
import { loadKitModules } from '../src/kits/load';
import { AUDIT_TURNS, auditDepthOf, offlineChecks } from '../src/probe/offline';
import { SceneRuntime } from '../src/runtime/runtime';
import { REFERENCE_SCENES } from '../src/scenes';
import { validateScene } from '../src/validation';
import { compileValidated } from './helpers/compile';

/**
 * The depth order of 3D figures (C3-4, CH-2): the engine mends the painter's
 * order wherever pieces overlap, and the offline audit checks, turn by turn,
 * that the nearer of any two overlapping pieces is drawn on top.
 */

/** Looking straight down the z axis without perspective: a camera point (x, y, z) lands at (x, -y). */
const FLAT: DepthView = { cx: 0, cy: 0, panX: 0, panY: 0, scale: 1, distance: 0 };

/** A flat square in camera space, `size` across, at depth z (larger is nearer). */
function square(x: number, y: number, size: number, z: number): PieceShape {
  const cam: Vec3[] = [
    [x, y, z],
    [x + size, y, z],
    [x + size, y + size, z],
    [x, y + size, z],
  ];
  return { kind: 'polygon', cam, screen: cam.map(([cx, cy]) => ({ x: cx, y: -cy })) };
}

/** A square tilted about the y axis: its depth runs from z0 at its left edge to z1 at its right. */
function slope(x: number, y: number, size: number, z0: number, z1: number): PieceShape {
  const cam: Vec3[] = [
    [x, y, z0],
    [x + size, y, z1],
    [x + size, y + size, z1],
    [x, y + size, z0],
  ];
  return { kind: 'polygon', cam, screen: cam.map(([cx, cy]) => ({ x: cx, y: -cy })) };
}

const piece = (shape: PieceShape, label: string) => ({ shape, bias: 0, label });
const prep = (shape: PieceShape) => prepare(shape, 0, FLAT)!;

function space(build: (s: Space3D, inc: Inc) => void) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { space3d: kit } });
  runtime.mount((inc) => build(inc.space3d('#s', { title: 'Space' }), inc));
  runtime.tick(0);
  return runtime;
}

describe('the depth-order audit (CH-2)', () => {
  it('finds a nearer piece drawn under a farther one, and passes the right order', () => {
    const near = piece(square(0, 0, 10, 2), 'near');
    const far = piece(square(5, 5, 10, 0), 'far');
    const wrong = auditDepth([near, far], FLAT, { radius: 10 });
    expect(wrong.violations).toHaveLength(1);
    expect(wrong.violations[0]).toMatchObject({ under: 'near', over: 'far' });
    // The overlap is 5 by 5.
    expect(wrong.violations[0]!.area).toBeCloseTo(25, 0);
    expect(auditDepth([far, near], FLAT, { radius: 10 })).toMatchObject({ pieces: 2, pairs: 1, violations: [], crossings: [], rings: [] });
    // Side by side, they never overlap.
    expect(auditDepth([piece(square(0, 0, 10, 2), 'a'), piece(square(20, 0, 10, 0), 'b')], FLAT, { radius: 10 }).pairs).toBe(0);
  });

  it('names pieces that pass through each other as crossings, and orders given up in a ring as rings', () => {
    // One square slopes from behind the other to in front of it.
    const flat = piece(square(0, 0, 10, 1), 'flat');
    const tilted = piece(slope(0, 0, 10, 0, 2), 'tilted');
    const crossed = auditDepth([flat, tilted], FLAT, { radius: 10 });
    expect(crossed.violations).toEqual([]);
    expect(crossed.crossings[0]).toMatchObject({ under: 'flat', over: 'tilted' });
    // A pair the engine had to give up to break a ring is reported as such, not as a mistake.
    const near = piece(square(0, 0, 10, 2), 'near');
    const far = piece(square(5, 5, 10, 0), 'far');
    expect(auditDepth([near, far], FLAT, { radius: 10, rings: [[1, 0]] })).toMatchObject({ violations: [], rings: [{ under: 'near', over: 'far' }] });
  });

  it('reads a sphere by its front and a line along its length', () => {
    const sphere: PieceShape = { kind: 'disc', centre: { x: 0, y: 0 }, radius: 10, cam: [0, 0, 0], camRadius: 10 };
    // A line just in front of the sphere's middle, and one behind it.
    const front: PieceShape = { kind: 'polyline', screen: [{ x: -5, y: 0 }, { x: 5, y: 0 }], cam: [[-5, 0, 11], [5, 0, 11]] };
    const back: PieceShape = { kind: 'polyline', screen: [{ x: -5, y: 0 }, { x: 5, y: 0 }], cam: [[-5, 0, -11], [5, 0, -11]] };
    expect(auditDepth([piece(front, 'front'), piece(sphere, 'sphere')], FLAT, { radius: 10 }).violations).toHaveLength(1);
    expect(auditDepth([piece(sphere, 'sphere'), piece(front, 'front')], FLAT, { radius: 10 }).violations).toEqual([]);
    expect(auditDepth([piece(back, 'back'), piece(sphere, 'sphere')], FLAT, { radius: 10 }).violations).toEqual([]);
  });
});

describe('mending the painter’s order (C3-4)', () => {
  const tolerance = DEPTH_TOLERANCE * 10;

  it('says which of two pieces is nearer where they overlap, how surely, or that they are even', () => {
    expect(nearer(prep(square(0, 0, 10, 2)), prep(square(5, 5, 10, 0)), tolerance)).toBe(1);
    expect(nearer(prep(square(0, 0, 10, 0)), prep(square(5, 5, 10, 2)), tolerance)).toBe(-1);
    // A label on a face: as near as it.
    expect(nearer(prep(square(0, 0, 10, 1)), prep(square(2, 2, 3, 1)), tolerance)).toBe(EVEN);
    expect(nearer(prep(square(0, 0, 10, 1)), prep(square(30, 0, 10, 0)), tolerance)).toBe(0);
    // Passing through each other: loose, and the tilted square is nearer over less than all of it.
    const loose = nearer(prep(square(0, 0, 10, 1)), prep(slope(0, 0, 10, 0, 3)), tolerance);
    expect(loose).toBeLessThan(0);
    expect(loose).toBeGreaterThan(-1);
  });

  it('puts the nearer of two overlapping pieces on top whatever their middles say', () => {
    // A long sloping face whose middle is nearer than a small square that is nearer where they overlap.
    const long = prep(slope(0, 0, 40, 0, 4));
    const small = prep(square(1, 1, 4, 1));
    // In the order of their middles the small square (middle at 1) comes first, under the long face (middle at 2).
    expect(mendOrder([small, long], tolerance)?.order).toEqual([1, 0]);
    // Already right, or even: nothing to mend.
    expect(mendOrder([long, small], tolerance)).toBeNull();
    expect(mendOrder([prep(square(0, 0, 10, 1)), prep(square(2, 2, 3, 1))], tolerance)).toBeNull();
  });

  it('breaks a ring of pieces each over the next by giving up its least sure order', () => {
    // Four strips round a square, each sloping so it is nearer than the next where they overlap: a ring no order keeps.
    const strip = (x0: number, y0: number, x1: number, y1: number, depth: (x: number, y: number) => number): PieceShape => {
      const cam: Vec3[] = [
        [x0, y0, depth(x0, y0)],
        [x1, y0, depth(x1, y0)],
        [x1, y1, depth(x1, y1)],
        [x0, y1, depth(x0, y1)],
      ];
      return { kind: 'polygon', cam, screen: cam.map(([x, y]) => ({ x, y: -y })) };
    };
    const bottom = strip(0, 0, 30, 4, (x) => x / 10);
    const right = strip(24, 0, 28, 30, (_, y) => 0.5 + y / 10);
    const top = strip(0, 26, 28, 30, (x) => (28 - x) / 10);
    const left = strip(2, 0, 6, 30, (_, y) => 3 - y / 10);
    const pieces = [bottom, right, top, left].map(prep);
    expect(nearer(pieces[0]!, pieces[1]!, tolerance)).toBe(1);
    expect(nearer(pieces[1]!, pieces[2]!, tolerance)).toBe(1);
    expect(nearer(pieces[2]!, pieces[3]!, tolerance)).toBe(1);
    expect(nearer(pieces[3]!, pieces[0]!, tolerance)).toBe(1);
    const mended = mendOrder(pieces, tolerance);
    expect([...mended!.order].sort()).toEqual([0, 1, 2, 3]);
    // One order of the four is given up; the other three are kept.
    expect(mended!.cut).toHaveLength(1);
    const at = (i: number) => mended!.order.indexOf(i);
    const kept = [
      [1, 0],
      [2, 1],
      [3, 2],
      [0, 3],
    ].filter(([first, second]) => at(first!) < at(second!));
    expect(kept).toHaveLength(3);
  });
});

describe('the engine draws nearer pieces on top', () => {
  const audit = (runtime: SceneRuntime, turns = AUDIT_TURNS) => auditDepthOf(runtime, turns);
  const violations = (runtime: SceneRuntime, turns = AUDIT_TURNS) => audit(runtime, turns).flatMap((f) => f.audit.violations.map((v) => ({ ...v, turn: f.turn })));

  it('draws a glass’s bottom over the liquid in it when seen from below, and a car’s cabin over its body from above', () => {
    // Both were drawn wrong by the order of the middles alone: the glass's bottom is one large face, the body's roof another.
    expect(violations(space((s) => s.model('beaker')), [{ yaw: 30, pitch: -15 }])).toEqual([]);
    expect(violations(space((s) => s.model('car')), [{ yaw: 0, pitch: 45 }])).toEqual([]);
  });

  it('breaks a line where it crosses a sphere’s outline, so a ring round a planet passes behind it and comes out in front', () => {
    const ring = (inc: Inc, s: Space3D) => {
      s.sphere(1, { tone: 'b' });
      const points: Vec3[] = [];
      for (let i = 0; i <= 48; i++) points.push([1.3 * Math.cos((i * Math.PI) / 24), 1.3 * Math.sin((i * Math.PI) / 24), 0.1]);
      s.line(points, { tone: 'lit' });
      void inc;
    };
    const runtime = space((s, inc) => ring(inc, s));
    expect(violations(runtime)).toEqual([]);
  });

  it('cuts a face that passes through another into tiles, within a budget of extra pieces', () => {
    const faces = (runtime: SceneRuntime) => [...runtime.graph.nodes.values()].filter((n) => n.kind === 'path' && !n.hidden && n.extra.includes('inc-face')).length;
    /** The pieces the engine would draw before any are cut into tiles. */
    const emitted = (runtime: SceneRuntime) => {
      const engine = runtime.viewControllers()[0]![1] as unknown as {
        root: { shown: boolean; children: unknown[] };
        emitter(out: unknown[]): unknown;
        emitItem(item: unknown, out: unknown[], emitter: unknown): void;
      };
      const out: unknown[] = [];
      const emitter = engine.emitter(out);
      const visit = (item: { shown: boolean; children: unknown[] }) => {
        if (!item.shown) return;
        engine.emitItem(item, out, emitter);
        item.children.forEach((child) => visit(child as typeof item));
      };
      visit(engine.root);
      return out.length;
    };
    // A slab through the middle of a box, so each passes through the other.
    const through = space((s) => {
      s.box([1, 1, 1], { tone: 'a' });
      s.box([2.4, 0.2, 0.6], { tone: 'b' });
    });
    expect(audit(through, [{ yaw: 35, pitch: 25 }])[0]!.audit.violations).toEqual([]);
    // Some faces were cut, and into no more than a quarter more pieces.
    const before = emitted(through);
    expect(faces(through)).toBeGreaterThan(before);
    expect(faces(through)).toBeLessThanOrEqual(before + Math.floor(before / 4));
  });

  it('audits at turns all the way round, from below, level and from above', () => {
    expect(AUDIT_TURNS).toHaveLength(60);
    expect(new Set(AUDIT_TURNS.map((t) => t.yaw))).toEqual(new Set([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]));
    expect(Math.min(...AUDIT_TURNS.map((t) => t.pitch))).toBeLessThan(0);
    expect(Math.max(...AUDIT_TURNS.map((t) => t.pitch))).toBeGreaterThan(60);
    // A 2D figure has nothing to turn.
    const flat = offlineChecks((inc) => {
      const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Flat' });
      stage.circle(50, 50, 10, { tone: 'a' });
    });
    expect(flat).toMatchObject({ ok: true, turns: 0, violations: [] });
  });

  it.each(MODEL_NAMES)('draws the %s model in depth order at every turn', (name) => {
    expect(violations(space((s) => s.model(name)))).toEqual([]);
  }, 60_000);

  it.each(Object.keys(REFERENCE_SCENES).filter((id) => validateScene(REFERENCE_SCENES[id]!).scene?.kits.includes('space3d')))(
    'draws the reviewed scene %s in depth order at every turn',
    async (id) => {
      const source = REFERENCE_SCENES[id]!;
      const { scene, fuel } = compileValidated(source);
      const kits = await loadKitModules(validateScene(source).scene?.kits ?? []);
      const report = offlineChecks(scene, { runtime: { kits }, beforeStep: fuel.refuel });
      expect(report.error).toBeUndefined();
      expect(report.turns).toBe(AUDIT_TURNS.length);
      expect(report.violations).toEqual([]);
    },
    60_000,
  );
});
