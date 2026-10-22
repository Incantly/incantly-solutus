import { describe, expect, it } from 'vitest';
import type { Graph3D, Graph3DOptions, Inc, Space3D, Space3DOptions, Vec2 } from '../src/api/types';
import { kit } from '../src/kits/space3d';
import { Camera, VIEWS } from '../src/kits/space3d/camera';
import { clipBetween, niceTicks } from '../src/kits/space3d/graph';
import { boxMesh, coneMesh, customMesh, cylinderMesh, planeMesh, torusMesh } from '../src/kits/space3d/mesh';
import { planeAxes } from '../src/kits/space3d/space';
import { isKitModule, KIT_GLOBAL, type KitModule } from '../src/runtime/kits';
import { SceneRuntime, type RuntimeOptions } from '../src/runtime/runtime';
import { KIT_SCRIPTS } from '../src/sandbox/generated/kit-scripts';
import { SHARED_GLOBAL, SHARED_MODULES } from '../src/sandbox/kit-shared';
import type { VNode } from '../src/scene/graph';
import { validateSceneJs } from '../src/validation/js';

function run(scene: (inc: Inc) => void, options: RuntimeOptions = {}) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { space3d: kit }, ...options });
  const mount = runtime.mount(scene);
  const first = runtime.tick(0);
  return { runtime, mount, first };
}

function space(build: (s: Space3D, inc: Inc) => void, options: Partial<Space3DOptions> = {}, runtimeOptions: RuntimeOptions = {}) {
  return run((inc) => build(inc.space3d('#s', { title: 'Space', ...options }), inc), runtimeOptions);
}

function graph(build: (g: Graph3D, inc: Inc) => void, options: Partial<Graph3DOptions> = {}) {
  return run((inc) => build(inc.graph3d('#g', { title: 'Graph', x: [-2, 2], y: [-2, 2], z: [0, 8], ...options }), inc));
}

const nodes = (runtime: SceneRuntime) => [...runtime.graph.nodes.values()];
/** The pooled face and line slots, in DOM order. */
const slots = (runtime: SceneRuntime): VNode[] => {
  const group = nodes(runtime).find((n) => n.kind === 'g' && n.extra === 'inc-slots')!;
  return group.children.map((id) => runtime.graph.nodes.get(id)!);
};
const visibleSlots = (runtime: SceneRuntime) => slots(runtime).filter((n) => !n.hidden);
const faces = (runtime: SceneRuntime) => visibleSlots(runtime).filter((n) => n.extra.includes('inc-face') && !n.extra.includes('inc-wire'));
const lum = (node: VNode) => Number(/inc-lum-(\d)/.exec(node.extra)?.[1]);
/** The corners of a face path. */
const corners = (node: VNode): Vec2[] => [...(node.attrs.get('d') ?? '').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const centre = (node: VNode): Vec2 => {
  const c = corners(node);
  return [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length];
};
const labels = (runtime: SceneRuntime) => nodes(runtime).filter((n) => n.kind === 'text' && !n.hidden);
const stageId = (runtime: SceneRuntime) => runtime.graph.stages[0]!.id;

describe('3D meshes', () => {
  it('wind every face counter-clockwise from outside', () => {
    const normal = (p: readonly (readonly number[])[]): [number, number, number] => {
      // Newell's normal of a polygon.
      const n: [number, number, number] = [0, 0, 0];
      p.forEach((a, i) => {
        const b = p[(i + 1) % p.length]!;
        n[0] += (a[1]! - b[1]!) * (a[2]! + b[2]!);
        n[1] += (a[2]! - b[2]!) * (a[0]! + b[0]!);
        n[2] += (a[0]! - b[0]!) * (a[1]! + b[1]!);
      });
      return n;
    };
    const mean = (p: readonly (readonly number[])[]): [number, number, number] => [0, 1, 2].map((k) => p.reduce((s, v) => s + v[k]!, 0) / p.length) as [number, number, number];
    for (const mesh of [boxMesh(1, 2, 3), cylinderMesh(1, 2, 12), coneMesh(1, 2, 12)]) {
      for (const face of mesh.faces) {
        const p = face.map((i) => mesh.vertices[i]!);
        const n = normal(p);
        const c = mean(p);
        expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0);
      }
    }
    // A torus's faces point away from the middle of its tube.
    const torus = torusMesh(2, 0.5, 16);
    for (const face of torus.faces) {
      const p = face.map((i) => torus.vertices[i]!);
      const c = mean(p);
      const ring = Math.hypot(c[0], c[1]);
      const tube: [number, number, number] = [c[0] - (2 * c[0]) / ring, c[1] - (2 * c[1]) / ring, c[2]];
      const n = normal(p);
      expect(n[0] * tube[0] + n[1] * tube[1] + n[2] * tube[2]).toBeGreaterThan(0);
    }
    expect(boxMesh(1, 1, 1).edges).toHaveLength(12);
    expect(cylinderMesh(1, 1, 24).faces).toHaveLength(26);
    expect(planeMesh(1, 1).twoSided).toBe(true);
    expect(() => customMesh({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 5]] })).toThrow('names vertex 5');
  });
});

describe('the 3D camera (C3-2)', () => {
  const camera = (yaw: number, pitch: number, distance = 0) => {
    const c = new Camera([0, 0, 400, 400], { yaw, pitch, scale: 100, distance, target: [0, 0, 0] }, 'orbit');
    c.settle([0, 0, 0], 1);
    return c;
  };
  const screen = (c: Camera, p: [number, number, number]) => {
    const q = c.project(c.toCamera(p));
    return [q.x, q.y];
  };

  it('looks along +y from the front, down from the top, and evenly at iso', () => {
    const front = camera(VIEWS.front.yaw, VIEWS.front.pitch);
    expect(screen(front, [1, 0, 0])).toEqual([300, 200]);
    expect(screen(front, [0, 0, 1])).toEqual([200, 100]);
    const top = camera(VIEWS.top.yaw, VIEWS.top.pitch);
    const [tx, ty] = screen(top, [0, 1, 0]);
    expect(tx).toBeCloseTo(200, 6);
    expect(ty).toBeCloseTo(100, 6);
    const iso = camera(VIEWS.iso.yaw, VIEWS.iso.pitch);
    const x = screen(iso, [1, 0, 0]);
    const y = screen(iso, [0, 1, 0]);
    // The x and y axes mirror each other, and z points straight up.
    expect(x[0]! - 200).toBeCloseTo(-(y[0]! - 200), 9);
    expect(x[1]).toBeCloseTo(y[1]!, 9);
    expect(screen(iso, [0, 0, 1])[0]).toBeCloseTo(200, 9);
  });

  it('enlarges nearer things with perspective and picks points back off the floor', () => {
    const flat = camera(30, 30);
    const deep = camera(30, 30, 6);
    const near = deep.project(deep.toCamera([1, 1, 0]));
    const far = deep.project(deep.toCamera([-1, -1, 0]));
    expect(near.k).toBeGreaterThan(1);
    expect(far.k).toBeLessThan(1);
    for (const c of [flat, deep]) {
      const p = c.project(c.toCamera([0.7, -0.4, 0.5]));
      const back = c.pick(p.x, p.y, 0.5)!;
      expect(back[0]).toBeCloseTo(0.7, 9);
      expect(back[1]).toBeCloseTo(-0.4, 9);
    }
  });

  it('turns, zooms about the pointer and resets', () => {
    const c = camera(30, 20);
    expect(c.orbit(0.1, 0.1)).toBe(true);
    expect(c.state.yaw).toBeCloseTo(30 - 22, 9);
    expect(c.state.pitch).toBeCloseTo(36, 9);
    c.orbit(0, 10);
    expect(c.state.pitch).toBe(89);
    const before = c.project(c.toCamera([0.5, 0.5, 0]));
    c.zoom(before.x, before.y, 2);
    const after = c.project(c.toCamera([0.5, 0.5, 0]));
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(c.changed()).toBe(true);
    c.reset();
    expect(c.changed()).toBe(false);
  });
});

describe('inc.space3d', () => {
  it('culls faces turned away from the eye (C3-3) and lights the rest', () => {
    const { runtime } = space((s) => s.box(2), { camera: { yaw: 35, pitch: 25, distance: 0 } });
    const drawn = faces(runtime);
    expect(drawn).toHaveLength(3);
    // The top faces the lamp more than the side away from it.
    const levels = drawn.map(lum).sort();
    expect(new Set(levels).size).toBeGreaterThan(1);
    const front = space((s) => s.box(2), { camera: { yaw: -90, pitch: 0, distance: 0 } }).runtime;
    expect(faces(front)).toHaveLength(1);
  });

  it('culls against the eye, not a fixed direction, under perspective', () => {
    // Looking straight at a face from close up, the side faces of a long box stay hidden but its near face shows.
    const { runtime } = space((s) => s.box([1, 6, 1]), { camera: { yaw: -90, pitch: 0, distance: 8 } });
    expect(faces(runtime)).toHaveLength(1);
    // From slightly off-axis, perspective reveals a side face that an eye at infinity would not see.
    const near = space((s) => s.box([1, 1, 1], { at: [1.2, 0, 0] }), { camera: { yaw: -90, pitch: 0, distance: 3, target: [0, 0, 0] } }).runtime;
    expect(faces(near).length).toBe(2);
  });

  it('writes the depth order into fixed slots: no reordering, only attribute writes (C3-4)', () => {
    let near!: ReturnType<Space3D['box']>;
    const { runtime } = space((s) => {
      s.box(1, { at: [-2, 0, 0], tone: 'a' });
      near = s.box(1, { at: [2, 0, 0], tone: 'b' });
    }, { camera: { yaw: 0, pitch: 10, distance: 0 } });
    // From +x, the box at x = 2 is nearer, so it is drawn last.
    let shown = visibleSlots(runtime);
    expect(shown.at(-1)!.tone).toBe('b');
    expect(shown[0]!.tone).toBe('a');
    const ids = slots(runtime).map((n) => n.id);
    // Turn half way round: the order flips, in the same elements.
    runtime.view(stageId(runtime), { kind: 'orbit', dx: 180 / 220, dy: 0 });
    const update = runtime.tick(0);
    shown = visibleSlots(runtime);
    expect(shown.at(-1)!.tone).toBe('a');
    expect(slots(runtime).map((n) => n.id)).toEqual(ids);
    expect(update.commands.some((c) => c.op === 'order' || c.op === 'create')).toBe(false);
    expect(near.screen()[0]).toBeGreaterThan(0);
  });

  it('draws a sticker on a face in front of it with a depth bias, and behind it without (C3-6)', () => {
    const order = (bias: number | undefined) => {
      // A plate, and a thin sticker on the plate's face toward the camera: coplanar, so the sort alone cannot choose.
      const { runtime } = space((s) => {
        s.box([0.2, 2, 2], { at: [0, 0, 0], tone: 'a' });
        s.box([0.2, 1, 1], { at: [0.001, 0, 0], tone: 'lit', ...(bias !== undefined ? { bias } : {}) });
      }, { camera: { yaw: 0, pitch: 0, distance: 0 } });
      return visibleSlots(runtime).map((n) => n.tone);
    };
    const biased = order(2);
    // The sticker's faces come after every face of the plate it sits on.
    expect(biased.lastIndexOf('a')).toBeLessThan(biased.indexOf('lit'));
    const pushedBack = order(-2);
    expect(pushedBack.lastIndexOf('lit')).toBeLessThan(pushedBack.indexOf('a'));
  });

  it('moves groups with their parent and spreads them in an exploded view (S3-3, S3-7)', () => {
    let group!: ReturnType<Space3D['group']>;
    let child!: ReturnType<Space3D['sphere']>;
    const { runtime } = space((s, inc) => {
      group = s.group({ at: [0, 0, 0] });
      child = s.sphere(0.5, { parent: group, at: [1, 0, 0] });
      s.sphere(0.5, { parent: group, at: [-1, 0, 0] });
      inc.onFrame(() => undefined);
    }, { camera: { yaw: -90, pitch: 0, scale: 50, distance: 0, target: [0, 0, 0] } });
    const before = child.screen();
    expect(before[0]).toBeCloseTo(320 + 50, 6);
    group.rotate(0, 0, 90);
    runtime.tick(0);
    // Turned a quarter about z, the child now points straight away from the front camera.
    expect(child.screen()[0]).toBeCloseTo(320, 6);
    group.rotate(0, 0, 0).explode(1);
    expect(child.screen()[0]).toBeCloseTo(320 + 100, 6);
  });

  it('draws round solids, planes, tori, meshes, lines, arrows, arcs, points, grids and axes', () => {
    const { runtime, mount } = space((s) => {
      s.cylinder(0.5, 1, { at: [-2, 0, 0] });
      s.cone(0.5, 1, { at: [0, 0, 0], tone: 'a' });
      s.torus(1, 0.3, { at: [2, 0, 0], look: 'wire' });
      s.plane(2, 2, { at: [0, 0, -1] });
      s.mesh({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], faces: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] }, { at: [0, 2, 0], look: 'ghost' });
      s.line([[0, 0, 0], [1, 1, 1], [2, 0, 1]], { dashed: true, label: 'path' });
      s.arrow([0, 0, 0], [0, 0, 2], { tone: 'b', label: 'F' });
      s.arc([0, 0, 0], [1, 0, 0], [0, 0, 1], 90, { label: 'θ' });
      s.point([1, 1, 1], { tone: 'lit' });
      s.grid({ size: 3 });
      s.axes({ length: 2 });
    });
    expect(mount.ui.error).toBeNull();
    const shown = visibleSlots(runtime);
    expect(shown.some((n) => n.extra.includes('inc-wire'))).toBe(true);
    expect(shown.some((n) => n.extra.includes('inc-glass'))).toBe(true);
    expect(shown.some((n) => n.dashed)).toBe(true);
    expect(shown.some((n) => n.fill && n.tone === 'b')).toBe(true); // an arrowhead
    expect(shown.some((n) => n.extra.includes('inc-smooth'))).toBe(true);
    expect(labels(runtime).map((n) => n.text).sort()).toEqual(['F', 'path', 'x', 'y', 'z', 'θ']);
    expect(shown.every((n) => !(n.attrs.get('d') ?? '').includes('NaN'))).toBe(true);
  });

  it('lays a grid on any plane by its normal, with square, unit directions across it (C3-12)', () => {
    const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    for (const normal of [[1, 1, 0], [1, 2, 3], [0, 0, 5], [0, -1, 0]] as const) {
      const lift = planeAxes({ normal });
      const u = lift(1, 0);
      const v = lift(0, 1);
      expect(dot(u, normal)).toBeCloseTo(0, 9);
      expect(dot(v, normal)).toBeCloseTo(0, 9);
      expect(dot(u, v)).toBeCloseTo(0, 9);
      expect(Math.hypot(...u)).toBeCloseTo(1, 9);
      expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    }
    // A tilted plane keeps one direction level; the floor by its normal is the floor by name.
    expect(planeAxes({ normal: [1, 1, 1] })(1, 0)[2]).toBeCloseTo(0, 9);
    expect(planeAxes({ normal: [0, 0, 1] })(2, 3)).toEqual(planeAxes('xy')(2, 3));
    expect(() => planeAxes({ normal: [0, 0, 0] })).toThrow(/must not be zero/);
    expect(() => planeAxes('xw')).toThrow(/grid plane must be/);
    const { runtime, mount } = space((s) => {
      s.grid({ plane: { normal: [1, 1, 1] }, size: 2, at: [0, 0, 1] });
    });
    expect(mount.ui.error).toBeNull();
    expect(visibleSlots(runtime).length).toBeGreaterThanOrEqual(10);
  });

  it('splits a large floor so what stands behind its middle is not covered', () => {
    let box!: ReturnType<Space3D['box']>;
    const { runtime } = space((s) => {
      s.plane(10, 10, { tone: 'faint' });
      box = s.box(1, { at: [0, 3, 0.5], tone: 'a' });
    }, { camera: { yaw: -90, pitch: 25, distance: 0 } });
    const drawn = visibleSlots(runtime);
    const floor = drawn.filter((n) => n.tone === 'faint');
    expect(floor.length).toBeGreaterThan(1);
    // The floor piece the box stands on is drawn before the box, and the box before nearer floor pieces is fine either way.
    const [bx, by] = box.screen();
    const under = floor.reduce((best, n) => {
      const [cx, cy] = centre(n);
      const [ex, ey] = centre(best);
      return Math.hypot(cx - bx, cy - by - 10) < Math.hypot(ex - bx, ey - by - 10) ? n : best;
    });
    const firstBox = drawn.findIndex((n) => n.tone === 'a');
    expect(drawn.indexOf(under)).toBeLessThan(firstBox);
    // Without splitting, the whole floor (centred in front of the box) would sort after it.
    expect(drawn.slice(firstBox).some((n) => n.tone === 'faint')).toBe(true);
  });

  it('runs a tube between two points and keeps long lines sorted with what they pass', () => {
    let rod!: ReturnType<Space3D['tube']>;
    const { runtime } = space((s) => {
      rod = s.tube([0, 0, 0], [0, 0, 2], 0.1, { tone: 'b' });
      s.tube([0, 0, 0], [2, 0, 0], 0.1);
      // A long line passing behind a box must not be drawn over it.
      s.box(1, { at: [0, 0, 0], tone: 'a' });
      s.line([[-4, 3, 0], [4, 3, 0]], { tone: 'c' });
    }, { camera: { yaw: -90, pitch: 10, distance: 0 } });
    const [x, y] = rod.screen();
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    const drawn = visibleSlots(runtime);
    const line = drawn.filter((n) => n.tone === 'c');
    expect(line.length).toBeGreaterThan(1);
    // Behind the box from the front: every piece of the line is drawn before the box's faces.
    const firstBox = drawn.findIndex((n) => n.tone === 'a');
    expect(line.every((n) => drawn.indexOf(n) < firstBox)).toBe(true);
  });

  it('wraps a coil around a rod without a wrap call: each piece sorts on its own (BR-5)', () => {
    const { runtime } = space((s) => {
      s.cylinder(0.3, 4, { rotate: [0, 90, 0], tone: 'mid' });
      s.coil(0.8, 3.5, 8, { tone: 'a' }).rotate(0, 90, 0);
    }, { camera: { yaw: -60, pitch: 20, distance: 0 } });
    const drawn = visibleSlots(runtime);
    const rod = drawn.map((n, i) => (n.tone === 'mid' ? i : -1)).filter((i) => i >= 0);
    const coil = drawn.map((n, i) => (n.tone === 'a' ? i : -1)).filter((i) => i >= 0);
    // The back of the coil is drawn before the rod, the front after it.
    expect(coil.some((i) => i < Math.min(...rod))).toBe(true);
    expect(coil.some((i) => i > Math.max(...rod))).toBe(true);
  });

  it('shades a sphere with a lit gradient, wires it as three rings, and ghosts it see-through', () => {
    const { runtime } = space((s) => {
      s.sphere(1, { tone: 'a' });
      s.sphere(1, { at: [3, 0, 0], look: 'wire' });
      s.sphere(1, { at: [-3, 0, 0], look: 'ghost' });
    });
    const shown = visibleSlots(runtime);
    expect(shown.filter((n) => n.shade === 'sphere')).toHaveLength(1);
    expect(shown.filter((n) => n.extra.includes('inc-wire'))).toHaveLength(1);
    expect(shown.filter((n) => n.extra.includes('inc-glass'))).toHaveLength(1);
  });

  it('pushes labels outward from the figure and keeps them apart (C3-13)', () => {
    const { runtime } = space((s) => {
      s.box(2);
      s.label([3, 0, 0], 'right');
      s.label([-3, 0, 0], 'left');
      s.label([0, 0, 3], 'first');
      s.label([0, 0, 3], 'second');
    }, { camera: { yaw: -90, pitch: 0, scale: 40, distance: 0, target: [0, 0, 0] } });
    const byText = new Map(labels(runtime).map((n) => [n.text, n]));
    const right = byText.get('right')!;
    expect(Number(right.attrs.get('x'))).toBeGreaterThan(320 + 120);
    expect(right.attrs.get('text-anchor')).toBe('start');
    expect(byText.get('left')!.attrs.get('text-anchor')).toBe('end');
    const a = byText.get('first')!;
    const b = byText.get('second')!;
    expect(Math.abs(Number(a.attrs.get('y')) - Number(b.attrs.get('y')))).toBeGreaterThanOrEqual(14);
  });

  it('names parts on the faces they draw, with a legend for accent tones (S3-6)', () => {
    const { runtime, first } = space((s) => {
      s.part('Anode', s.box(1, { at: [-1.5, 0, 0], tone: 'a' }), { info: 'Where oxidation happens' });
      s.part('Cathode', s.box(1, { at: [1.5, 0, 0], tone: 'b' }));
    });
    expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Anode', 'Cathode']);
    const owners = first.commands.filter((c) => c.op === 'owner');
    expect(new Set(owners.map((c) => (c as { part: string | null }).part))).toEqual(new Set(['Anode', 'Cathode']));
    expect(runtime.uiState().legend.map((l) => [l.label, l.tone])).toEqual([
      ['Anode', 'a'],
      ['Cathode', 'b'],
    ]);
    // Pointing at a part focuses it, as for 2D parts.
    runtime.focusPart('Anode');
    expect(runtime.uiState().focus).toBe('Anode');
  });

  it('lets the learner drag an object across the floor (VI-4)', () => {
    let ball!: ReturnType<Space3D['sphere']>;
    let s3!: Space3D;
    const { runtime } = space((s, inc) => {
      s3 = s;
      const x = inc.param('x', { min: -3, max: 3, value: 0 });
      const y = inc.param('y', { min: -3, max: 3, value: 0 });
      s.plane(6, 6, { at: [0, 0, 0] });
      ball = s.sphere(0.4, { tone: 'a' });
      s.drag(ball, (p) => {
        const hit = s.pick(p.x, p.y, 0);
        return hit ? { x: hit[0], y: hit[1] } : undefined;
      });
      inc.onFrame(() => ball.at(x.value, y.value, 0));
    });
    const grab = nodes(runtime).find((n) => n.drag !== null)!;
    expect(grab.extra).toContain('inc-grab');
    const target = s3.project([1.5, -1, 0]);
    runtime.drag(grab.id, 'start', target[0], target[1]);
    runtime.drag(grab.id, 'end', target[0], target[1]);
    runtime.tick(0);
    expect(runtime.values().x).toBeCloseTo(1.5, 1);
    expect(runtime.values().y).toBeCloseTo(-1, 1);
  });

  it('answers the stage toolbar: presets, reset and zoom', () => {
    const { runtime } = space((s) => void s.box(1));
    const id = stageId(runtime);
    const interact = runtime.graph.flush().concat(runtime.tick(0).commands);
    void interact;
    runtime.view(id, { kind: 'preset', name: 'top' });
    runtime.tick(0);
    expect(runtime.uiState().views.find((v) => v.id === id)?.changed).toBe(true);
    runtime.view(id, { kind: 'reset' });
    runtime.tick(0);
    expect(runtime.uiState().views.find((v) => v.id === id)?.changed).toBe(false);
    const snapshot = runtime.graph.snapshotCommands().find((c) => c.op === 'interact') as unknown as { zoom: string; orbit: boolean; views: string[] };
    expect(snapshot).toMatchObject({ zoom: 'runtime', orbit: true, views: ['front', 'side', 'top', 'iso'] });
  });

  it('keeps an isometric figure isometric', () => {
    const { runtime } = space((s) => void s.box(1), { mode: 'iso' });
    const id = stageId(runtime);
    runtime.view(id, { kind: 'orbit', dx: 0.3, dy: 0.2 });
    runtime.tick(0);
    expect(runtime.uiState().views.find((v) => v.id === id)?.changed).toBe(false);
    const snapshot = runtime.graph.snapshotCommands().find((c) => c.op === 'interact') as unknown as { orbit: boolean };
    expect(snapshot.orbit).toBe(false);
  });

  it('coarsens round solids above the face budget and says so (S3-10)', () => {
    const { runtime } = space(
      (s) => {
        for (let i = 0; i < 12; i++) s.torus(1, 0.3, { at: [i * 3, 0, 0], segments: 48 });
      },
      { budget: 600 },
    );
    expect(runtime.graph.diagnostics.map((d) => d.message).join(' ')).toContain('more than its budget of 600');
    expect(faces(runtime).length).toBeLessThan(12 * 48 * 24);
  });

  it('traces field lines through a field (S3-8)', () => {
    const { runtime } = space((s) => {
      // The field of a positive and a negative charge.
      const plus = [-1, 0, 0] as const;
      const minus = [1, 0, 0] as const;
      const field = (p: readonly number[]) => {
        const f = [0, 0, 0];
        for (const [c, q] of [[plus, 1], [minus, -1]] as const) {
          const d = [p[0]! - c[0], p[1]! - c[1], p[2]! - c[2]];
          const r3 = Math.hypot(d[0]!, d[1]!, d[2]!) ** 3;
          for (let i = 0; i < 3; i++) f[i]! += (q * d[i]!) / r3;
        }
        return f as unknown as [number, number, number];
      };
      s.fieldLines(field, [[-0.9, 0.1, 0], [-0.9, -0.1, 0]], { sinks: [[1, 0, 0]] });
    });
    const lines = visibleSlots(runtime).filter((n) => !n.fill);
    expect(lines.length).toBeGreaterThan(4);
  });

  it('lowers detail when drawing is slow (G3-7)', () => {
    let clock = 0;
    const { runtime } = graph((g) => void g.surface((x, y) => x * x + y * y, { resolution: 40 }), {});
    void runtime;
    const slow = run(
      (inc) => {
        const g = inc.graph3d('#g', { title: 'Slow', x: [-1, 1], y: [-1, 1], z: [0, 2] });
        g.surface((x, y) => x * x + y * y, { resolution: 40 });
      },
      { now: () => (clock += 20) },
    ).runtime;
    for (let i = 0; i < 6; i++) {
      slow.view(stageId(slow), { kind: 'orbit', dx: 0.01, dy: 0 });
      slow.tick(0);
    }
    expect(slow.graph.diagnostics.map((d) => d.message).join(' ')).toContain('surfaces now use fewer samples');
    expect(faces(slow).length).toBeLessThan(40 * 40);
  });

  it('refuses bad input with plain messages', () => {
    const error = (build: (s: Space3D) => void) => space(build).mount.ui.error?.message;
    expect(error((s) => void s.box(-1))).toBe('box width must be a positive number');
    expect(error((s) => void s.sphere(1, { look: 'shiny' as never }))).toContain("look must be 'solid', 'wire' or 'ghost'");
    expect(error((s) => void s.box(1, { tone: 'pink' as never }))).toBe('Unknown tone "pink"');
    expect(error((s) => void s.line([[0, 0, 0]]))).toContain('from 2 to 2000 points');
    expect(error((s) => void s.box(1).orient([1, 0, 0] as never))).toContain('nine finite numbers');
    expect(error((s) => void s.torus(1, 2))).toContain('larger than its tube radius');
    expect(error((s) => void s.view('under' as never))).toContain('Unknown view "under"');
    expect(error((s) => void s.part('Twice', s.part('Once', s.box(1))))).toContain('already the part "Once"');
  });
});

describe('inc.graph3d', () => {
  it('samples surfaces in the data box, cut off where they leave it (G3-1, G3-2)', () => {
    const { runtime } = graph((g) => void g.surface((x, y) => x * x + y * y, { resolution: 20 }), { grid: false, axes: false });
    const drawn = faces(runtime);
    // Every corner of x² + y² over [-2, 2]² stays under 8 except where both coordinates are near 2.
    expect(drawn.length).toBeGreaterThan(20 * 20 * 0.4);
    expect(drawn.length).toBeLessThanOrEqual(20 * 20);
    expect(drawn.every((n) => n.extra.includes('inc-smooth'))).toBe(true);
  });

  it('follows parameters, because surfaces are sampled on every draw', () => {
    let count = 0;
    const { runtime } = graph((g, inc) => {
      const a = inc.param('a', { min: 0, max: 2, value: 1 });
      g.surface((x, y) => {
        count++;
        return a.value * (x + y) + 4;
      });
    });
    const before = count;
    runtime.setParam('a', 0.5);
    runtime.tick(0);
    expect(count).toBeGreaterThan(before);
  });

  it('draws parametric surfaces, curves, points, vectors, planes and labels (G3-3, G3-4)', () => {
    const { runtime, mount } = graph((g) => {
      g.parametric((u, v) => [Math.cos(u) * Math.sin(v), Math.sin(u) * Math.sin(v), 4 + Math.cos(v)], { u: [0, 2 * Math.PI], v: [0, Math.PI], resolution: 12 });
      g.curve((t) => [Math.cos(t), Math.sin(t), t], { t: [0, 8], tone: 'c' });
      g.point(() => [1, 1, 1], { label: 'P' });
      g.vector([0, 0, 0], [1, 1, 4], { label: 'v' });
      g.plane([0, 0, 1], 2);
      g.label([0, 0, 7], 'top');
    });
    expect(mount.ui.error).toBeNull();
    const texts = labels(runtime).map((n) => n.text);
    expect(texts).toEqual(expect.arrayContaining(['P', 'v', 'top', 'x', 'y', 'z']));
    expect(visibleSlots(runtime).some((n) => n.tone === 'c')).toBe(true);
  });

  it('cuts surfaces off cleanly at the top and bottom of the box', () => {
    const square: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 2],
      [0, 1, 2],
    ];
    const cut = clipBetween(square, 0, 1);
    expect(cut).toHaveLength(4);
    expect(Math.max(...cut.map((p) => p[2]))).toBe(1);
    expect(clipBetween(square, 3, 4)).toEqual([]);
    const { runtime } = graph((g) => void g.surface((x, y) => x * x + y * y, { resolution: 12 }), { grid: false, axes: false, z: [0, 6] });
    // Cells crossing the top of the box are cut, not dropped: a clean edge instead of a jagged one.
    expect(faces(runtime).some((n) => corners(n).length !== 4)).toBe(true);
  });

  it('clips a plane to the box', () => {
    const { runtime } = graph((g) => void g.plane([0, 0, 1], 4, { look: 'solid', tone: 'b' }), { grid: false, axes: false });
    const plane = faces(runtime).find((n) => n.tone === 'b')!;
    expect(corners(plane)).toHaveLength(4);
  });

  it('draws contour lines and a cross-section that follows its value (G3-6)', () => {
    let position = 0;
    const { runtime } = graph((g, inc) => {
      const at = inc.param('at', { min: -2, max: 2, value: 0 });
      const s = g.surface((x, y) => x * x + y * y, { contours: [1, 2, 4], resolution: 16 });
      s.section('x', () => at.value, { tone: 'c' });
      inc.onFrame(() => void (position = at.value));
    }, { grid: false, axes: false });
    const drawn = visibleSlots(runtime);
    const contours = drawn.filter((n) => n.extra === 'inc-on-face');
    expect(contours.length).toBeGreaterThan(3);
    // Each contour piece is drawn straight after the face it lies on.
    for (const piece of contours) expect(drawn[drawn.indexOf(piece) - 1]!.extra).toMatch(/inc-face|inc-on-face/);
    const before = visibleSlots(runtime).filter((n) => n.tone === 'c').map((n) => n.attrs.get('d')).join();
    runtime.setParam('at', 1);
    runtime.tick(0);
    const after = visibleSlots(runtime).filter((n) => n.tone === 'c').map((n) => n.attrs.get('d')).join();
    expect(after).not.toBe(before);
    expect(position).toBe(1);
  });

  it('puts panes on the far sides and moves them as the camera turns', () => {
    // From above, the floor pane lies below the middle of the figure; from below, above it.
    const floor = (pitch: number) => {
      const { runtime } = graph(() => undefined, { grid: ['xy'], camera: { yaw: 45, pitch, distance: 0 } });
      const panes = visibleSlots(runtime).filter((n) => n.extra.includes('inc-glass'));
      expect(panes.length).toBeGreaterThan(0);
      // Panes are drawn first, behind everything else.
      expect(visibleSlots(runtime)[0]).toBe(panes[0]);
      return panes.map((n) => centre(n)[1]).reduce((a, b) => a + b, 0) / panes.length;
    };
    expect(floor(30)).toBeGreaterThan(220);
    expect(floor(-30)).toBeLessThan(220);
    expect(niceTicks(0, 8)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(-2, 2)).toEqual([-2, -1, 0, 1, 2]);
    const { runtime } = graph(() => undefined);
    expect(labels(runtime).map((n) => n.text)).toEqual(expect.arrayContaining(['0', '2', '4', '6', '8', '-2', '-1', '1', 'x', 'y', 'z']));
  });
});

describe('3D scenes in the sandbox', () => {
  it('pass the validator', () => {
    const js = `
inc.idea('A cube has six faces, but at most three can face you at once.');
const turn = inc.param('turn', { min: 0, max: 90, value: 30, label: 'Turn', unit: '°' });
const space = inc.space3d('#space', { title: 'A cube', camera: { yaw: 30, pitch: 25 } });
const cube = space.part('Cube', space.box(2, { tone: 'a' }), { info: 'Six square faces' });
const label = space.label(cube, 'cube');
space.axes({ length: 2 });
inc.onFrame(() => {
  cube.orient(inc.vec.rotA([0, 0, 1], (turn.value * Math.PI) / 180));
  label.text('turned ' + Math.round(turn.value) + '°');
});
const graph = inc.graph3d('#graph', { title: 'A bowl', x: [-2, 2], y: [-2, 2], z: [0, 8] });
const bowl = graph.surface((x, y) => x * x + y * y, { contours: [1, 4] });
bowl.section('x', () => turn.value / 45 - 1);
`;
    const { diagnostics, info } = validateSceneJs(js);
    expect(diagnostics).toEqual([]);
    expect(info.kits).toEqual(['space3d']);
  });

  it('runs from the built kit script on the Worker’s own modules', async () => {
    const code = await KIT_SCRIPTS.space3d!();
    const scope = globalThis as unknown as Record<string, unknown>;
    scope[SHARED_GLOBAL] = SHARED_MODULES;
    try {
      new Function(code)();
      const registered = (scope[KIT_GLOBAL] as Record<string, unknown>).space3d;
      expect(isKitModule(registered)).toBe(true);
      const runtime = new SceneRuntime({ autoplay: false, kits: { space3d: registered as KitModule } });
      runtime.mount((inc) => {
        const s = inc.space3d('#s', { title: 'Built' });
        s.part('Box', s.box(1, { tone: 'a' }));
        s.part('Ball', s.sphere(0.5, { at: [2, 0, 0], tone: 'b' }));
      });
      runtime.tick(0);
      expect(runtime.uiState().error).toBeNull();
      expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Box', 'Ball']);
      expect(faces(runtime).length).toBeGreaterThan(0);
    } finally {
      delete scope[SHARED_GLOBAL];
      delete scope[KIT_GLOBAL];
    }
  });
});
