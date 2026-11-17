/** Physics in the studio (.kiro/specs/physics R4; docs/features/physics ui.md 2, 4, 5, 7). */
import { describe, expect, it } from 'vitest';
import { space } from '@incantly/kernel';
import { sceneOf, sceneOf3 } from '@incantly/sdk/screen';
import { KernelSession } from '../src/session';
import { EXAMPLES } from '../src/examples';

const load = (lines: readonly string[]): KernelSession => {
  const s = new KernelSession();
  const r = s.applyLines([...lines], 'test', 'independent', 'host');
  if (!r.ok) throw new Error(r.error.message);
  return s;
};

describe('the studio and physics', () => {
  it('a figure with a body has a clock, and opens at the start', () => {
    const s = load(['g = Ground()', 'b = Body(Box((0, 2), 1, 1))']);
    expect(s.hasClock()).toBe(true);
    expect(s.time()).toBe(0);
  });

  it('solid shapes are hatched and bodies show the arrows asked for', () => {
    const s = load(['g = Ground()', 'p = Polygon((0, 0), (2, 0), (0, 2))', 'p with solid = true', 'b = Body(Box((5, 2), 1, 1))', 'b with show = forces', 'world with show = contacts']);
    s.setTime(1);
    const items = sceneOf(s.figure);
    expect(items.find((i) => i.name === 'p')?.solid).toBe(true);
    expect(items.find((i) => i.name === 'g')?.solid).toBe(true);
    expect(items.find((i) => i.name === 'b')?.arrows).toBe('forces');
    expect(items.find((i) => i.type === 'Contacts')).toBeDefined();
  });

  it('a body in space is drawn as its solid where it is now, its faces tagged to drag it by (R5.4)', () => {
    const s = load(['g = Ground()', 'A = (0, 0, 2)', 'k = Cube(A, (1, 0, 2), (0, 1, 2))', 'b = Body(k)', 'balls = Bodies(Seq(Sphere((3, k, 1), 0.5), k, 0, 1))']);
    expect(s.hasClock()).toBe(true);
    s.setTime(1);
    const sc = sceneOf3(s.figure, space.viewOf(s.figure));
    const faces = sc.items.filter((i) => i.k === 'face' && i.body !== undefined) as { body: string; pts: { z: number }[] }[];
    expect(new Set(faces.map((f) => f.body))).toEqual(new Set(['b', 'balls[1]', 'balls[2]']));
    // the cube has landed: its lowest face is on the floor
    const low = Math.min(...faces.filter((f) => f.body === 'b').flatMap((f) => f.pts.map((p) => p.z)));
    expect(low).toBeCloseTo(0, 1);
    // dragging it at the start moves the free point it is built from; later it grabs
    s.setTime(0);
    expect(s.draggable('b')).toBe(true);
    expect(s.dragPoint('b', 0.5, 0.5, false, 2.5).ok).toBe(true);
    expect(s.dragPoint('b', 2.5, 0.5, true, 2.5).ok).toBe(true);
    expect((s.figure.value('A') as { x: number }).x).toBeCloseTo(2, 9);
    s.setTime(1);
    expect(s.dragPoint('b', 2.5, 2, false, 2).ok).toBe(true);
    s.dragPoint('b', 2.5, 2, true, 2);
    expect(s.save()).toMatch(/@input physics grab b /);
  });

  it('dragging a body at the start moves where it starts; later it grabs', () => {
    const s = load(['g = Ground()', 'p = Box((0, 3), 1, 1)', 'b = Body(p)']);
    expect(s.dragPoint('b', 0, 3, false).ok).toBe(true);
    expect(s.dragPoint('b', 1, 3, true).ok).toBe(true);
    expect(s.figure.get('p')?.definition).toBe('p = Box((1, 3), 1, 1)');
    s.setTime(2);
    const r = s.dragPoint('b', 1, 0.5, false);
    expect(r.ok).toBe(true);
    s.dragPoint('b', 1, 2, true);
    expect(s.save()).toMatch(/@input physics grab b/);
  });

  it('liquid is one item of drops and water a fill, and the film runs for them (R7; ui.md 7)', () => {
    const s = load(['tank = Polyline((-2, 3), (-2, 0), (2, 0), (2, 3))', 'tank with solid = true', 'l = Liquid(Box((0, 1), 2, 2), 400)', 'sea = Water(Box((0, -2), 6, 2), -1)']);
    expect(s.hasClock()).toBe(true);
    s.setTime(0.5);
    const items = sceneOf(s.figure);
    const l = items.find((i) => i.name === 'l');
    const v = l?.value as { xs: Float32Array; count: number } | undefined;
    expect(v?.count).toBe(400);
    expect(v?.xs.length).toBe(400);
    expect(items.find((i) => i.name === 'sea')?.type).toBe('Water');
  });

  it('in space, drops are dots, waves a lit mesh and still water a patch at its level (R7; design 12, ui.md 7, 9)', () => {
    const s = load(['g = Ground()', 'drop = Liquid(Box((0, 0, 1), 1, 1, 1), 300)', 'pool = Box((4, 0, -0.5), 4, 4, 1)', 'sea = Waves(pool, 48)', 'calm = Water(-2)']);
    expect(s.hasClock()).toBe(true);
    s.setTime(0.5);
    const sc = sceneOf3(s.figure, space.viewOf(s.figure));
    const id = (n: string): number => s.figure.objects().find((o) => o.name === n)?.id as unknown as number;
    expect(sc.items.filter((i) => i.k === 'dot' && i.id === id('drop')).length).toBe(300);
    // a grid of 48 is drawn from every second corner: 24 by 24 faces, shaded
    const waves = sc.items.filter((i) => i.k === 'face' && i.id === id('sea')) as { shade: boolean }[];
    expect(waves.length).toBe(24 * 24);
    expect(waves.every((f) => f.shade)).toBe(true);
    const calm = sc.items.find((i) => i.k === 'face' && i.id === id('calm')) as { pts: { z: number }[]; alpha: number } | undefined;
    expect(calm?.pts.every((p) => p.z === -2)).toBe(true);
    expect(calm?.alpha).toBeLessThanOrEqual(0.3);
    // the board does not draw the drops in space
    const flat = sceneOf(s.figure).find((i) => i.name === 'drop');
    expect((flat?.value as { zs?: Float32Array } | undefined)?.zs?.length).toBe(300);
  });

  it('every physics example opens with all its lines and moves when the film runs', () => {
    for (const ex of EXAMPLES.filter((e) => e.id.startsWith('physics-'))) {
      const s = new KernelSession();
      const r = s.applyLines([...ex.lines], ex.id, 'independent', 'host');
      expect(r.ok, ex.id).toBe(true);
      const bodies = s.figure.objects().filter((o) => o.type === 'Body' || o.type === 'Body3' || o.type === 'Liquid' || /^List<Body3?>/.test(o.typeText));
      expect(bodies.length, ex.id).toBeGreaterThan(0);
      const before = JSON.stringify(bodies.map((o) => s.figure.value(o.id)));
      for (let k = 1; k <= 60; k++) s.setTime(k / 60);
      const after = JSON.stringify(bodies.map((o) => s.figure.value(o.id)));
      expect(after, ex.id).not.toBe(before);
    }
  });
});
