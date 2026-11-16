/** Surfaces and curves in space (.kiro/specs/space-3d-surfaces R1; docs/features/space-3d design 6.3). */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, playerOf, registerAnimation, registerFunctions, registerNumbers, registerSpace, space } from '../../src/index';

let f: Figure;

beforeEach(() => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerSpace(r);
  f = new Figure({ commands: r });
});

const ok = (...lines: string[]): void => {
  for (const line of lines) {
    const r = f.apply(line);
    if (!r.ok) throw new Error(`${line}: ${(r as { message: string }).message}`);
  }
};
const val = <T>(name: string): T => {
  const o = f.get(name);
  if (!o || !o.cell.defined) throw new Error(`${name} is undefined`);
  return o.cell.value as T;
};
const undef = (name: string): { reason: string; detail?: string } => {
  const o = f.get(name);
  if (!o || o.cell.defined) throw new Error(`${name} is defined`);
  return o.cell as unknown as { reason: string; detail?: string };
};

describe('Surface (R1.2)', () => {
  it('makes a parametric surface from three formulas in u and v', () => {
    ok('S = Surface(cos(u) * sin(v), sin(u) * sin(v), cos(v), u, 0, tau, v, 0, pi)');
    expect(f.get('S')?.type).toBe('Surface');
    const s = val<space.Surface3>('S');
    expect(s.u).toEqual([0, 2 * Math.PI]);
    const p = s.at(0, Math.PI / 2) as space.V3;
    expect(p.x).toBeCloseTo(1, 12);
    expect(p.z).toBeCloseTo(0, 12);
    // every point of the unit sphere
    for (const [u, v] of [[0.3, 0.4], [2, 2.5], [5, 1]] as const) {
      const q = s.at(u, v) as space.V3;
      expect(Math.hypot(q.x, q.y, q.z)).toBeCloseTo(1, 12);
    }
    expect(space.spaceText(s)).toBe('surface, u 0..6.28319, v 0..3.14159');
  });

  it('holes where a formula is undefined; undefined when it is undefined everywhere', () => {
    ok('S = Surface(u, v, sqrt(u), u, -1, 1, v, 0, 1)');
    const s = val<space.Surface3>('S');
    expect(s.at(-0.5, 0.5)).toBeUndefined();
    expect(s.at(0.25, 0.5)).toEqual({ x: 0.25, y: 0.5, z: 0.5 });
    ok('T = Surface(u, v, sqrt(-1 - u^2), u, 0, 1, v, 0, 1)');
    expect(undef('T').reason).toBe('out_of_domain');
  });

  it('a range that is not finite or runs backwards is undefined with a reason', () => {
    ok('A = Surface(u, v, 0, u, 0, inf, v, 0, 1)', 'B = Surface(u, v, 0, u, 1, 0, v, 0, 1)');
    expect(undef('A').reason).toBe('missing_range');
    expect(undef('B').reason).toBe('bad_argument');
  });

  it('a surface that reads t moves with the film', () => {
    ok('W = Surface(u, v, sin(u + t), u, -3, 3, v, -3, 3)');
    const z0 = (val<space.Surface3>('W').at(0, 0) as space.V3).z;
    playerOf(f).seek(Math.PI / 2);
    const z1 = (val<space.Surface3>('W').at(0, 0) as space.V3).z;
    expect(z0).toBeCloseTo(0, 12);
    expect(z1).toBeCloseTo(1, 12);
  });
});

describe('Curve in space and PointOn (R1.3)', () => {
  it('Curve with three formulas is a Curve3; with two it stays the flat Curve', () => {
    ok('c = Curve(cos(s), sin(s), s / 5, s, 0, 12)', 'g = Curve(cos(s), sin(s), s, 0, 6)');
    expect(f.get('c')?.type).toBe('Curve3');
    expect(f.get('g')?.type).toBe('Curve');
    const c = val<space.Curve3>('c');
    expect(c.at(5)?.z).toBeCloseTo(1, 12);
  });

  it('PointOn takes the curve\'s own parameter, and follows t', () => {
    ok('c = Curve(cos(s), sin(s), s / 5, s, 0, 12)', 'P = PointOn(c, 2)');
    const P = val<space.V3>('P');
    expect(P.x).toBeCloseTo(Math.cos(2), 12);
    expect(P.z).toBeCloseTo(0.4, 12);
    ok('Q = PointOn(c, t)');
    playerOf(f).seek(10);
    expect(val<space.V3>('Q').z).toBeCloseTo(2, 12);
    ok('R = PointOn(c, 20)');
    expect(undef('R').reason).toBe('out_of_domain');
  });

  it('dragging a point on a curve slides it along: the parameter in the line changes', () => {
    ok('c = Curve(cos(s), sin(s), s / 5, s, 0, 12)', 'P = PointOn(c, 2)');
    const plan = f.dragPlan('P', { x: Math.cos(6), y: Math.sin(6), z: 1.2 });
    expect(f.drag(plan).ok).toBe(true);
    f.commitDrag();
    expect(f.get('P')?.definition).toBe('P = PointOn(c, 6)');
  });

  it('nearestOnCurve finds the parameter of the nearest point', () => {
    ok('c = Curve(s, s^2, 0, s, -2, 2)');
    const s = space.nearestOnCurve(val<space.Curve3>('c'), { x: 1.5, y: 2.25, z: 0 }) as number;
    expect(s).toBeCloseTo(1.5, 6);
  });

  it('ViewAll fits curves and surfaces too', () => {
    ok('c = Curve(10 + cos(s), 10 + sin(s), 10, s, 0, tau)', 'ViewAll()');
    const t = space.viewOf(f).target;
    expect(t.x).toBeCloseTo(10, 3);
    expect(t.z).toBeCloseTo(10, 3);
  });
});
