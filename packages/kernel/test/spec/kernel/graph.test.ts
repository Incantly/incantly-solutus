/**
 * Dependency graph and update order: one pass per frame, only downstream rules run, early cut-off,
 * reorder on redefinition, the time set, lazy demand.
 * Docs: kernel/design.md sections 6 and 15; core design section 2 (order and updates); performance.md section 3.
 */
import { describe, expect, it } from 'vitest';
import { sameValue } from '@incantly/kernel';
import { figure, idOf, must, ok, resetRuns, runs, newFigure, build } from './helpers';

// A diamond: M reads A and B, N reads A and M, P reads M and N. D is unrelated.
const DIAMOND = [
  'A = (0, 0)',
  'B = (4, 0)',
  'C = (10, 10)',
  'D = (12, 10)',
  'M = Midpoint(A, B)',
  'N = Midpoint(A, M)',
  'P = Midpoint(M, N)',
  'far = Distance(C, D)',
];

describe('ancestors and dependents', () => {
  it('dependentsOf lists everything built from an object, directly or not, in order', () => {
    const f = figure(DIAMOND);
    expect(f.dependentsOf('A')).toEqual([idOf(f, 'M'), idOf(f, 'N'), idOf(f, 'P')]);
    expect(f.dependentsOf('M')).toEqual([idOf(f, 'N'), idOf(f, 'P')]);
    expect(f.dependentsOf('P')).toEqual([]);
    expect(f.dependentsOf('C')).toEqual([idOf(f, 'far')]);
  });

  it('ancestorsOf lists everything an object is built from, in order', () => {
    const f = figure(DIAMOND);
    expect(f.ancestorsOf('P')).toEqual([idOf(f, 'A'), idOf(f, 'B'), idOf(f, 'M'), idOf(f, 'N')]);
    expect(f.ancestorsOf('A')).toEqual([]);
  });

  it('each dependent is listed once even when reached by several paths', () => {
    const f = figure(DIAMOND);
    const deps = f.dependentsOf('A');
    expect(new Set(deps).size).toBe(deps.length);
  });

  it('accepts a name or an id', () => {
    const f = figure(DIAMOND);
    expect(f.dependentsOf(idOf(f, 'A') as never)).toEqual(f.dependentsOf('A'));
    expect(f.ancestorsOf(idOf(f, 'P') as never)).toEqual(f.ancestorsOf('P'));
  });

  it('DependsOn(obj) and Uses(obj) return the same lists as data (kernel design 14)', () => {
    const f = figure(DIAMOND);
    const dep = ok(f.apply('DependsOn(P)'));
    expect(dep.data).toEqual(['A', 'B', 'M', 'N']);
    const uses = ok(f.apply('Uses(A)'));
    expect(uses.data).toEqual(['M', 'N', 'P']);
    // read-only: nothing was added to the figure
    expect(f.count).toBe(DIAMOND.length);
  });

  it('every dependent of a parent can be reached through inputs (graph is consistent both ways)', () => {
    const f = figure(DIAMOND);
    for (const o of f.objects()) {
      for (const d of f.dependentsOf(o.name)) {
        expect(f.ancestorsOf(d as never)).toContain(o.id);
      }
    }
  });
});

describe('one update per frame, only downstream rules run', () => {
  it('writing a free value does not run any rule until flush', () => {
    const f = figure(DIAMOND);
    resetRuns();
    must(f.setFree('A', { x: 2, y: 2 }, 'api'));
    expect(runs.get('Midpoint') ?? 0).toBe(0);
    f.flush();
    expect(runs.get('Midpoint')).toBe(3);
  });

  it('each downstream rule runs exactly once per flush, even in a diamond', () => {
    const f = figure(DIAMOND);
    resetRuns();
    f.setFree('A', { x: 2, y: 2 }, 'drag');
    const d = f.flush();
    expect(runs.get('Midpoint')).toBe(3); // M, N, P once each
    expect(d.ran).toBe(3);
    expect(f.value('M')).toEqual({ x: 3, y: 1 });
  });

  it('rules that do not read the changed object do not run', () => {
    const f = figure(DIAMOND);
    resetRuns();
    f.setFree('A', { x: 2, y: 2 }, 'drag');
    f.flush();
    expect(runs.get('Distance') ?? 0).toBe(0);
  });

  it('writes between two flushes coalesce: the last write wins and the source is marked once', () => {
    const f = figure(DIAMOND);
    resetRuns();
    for (let i = 1; i <= 50; i++) f.setFree('A', { x: i, y: i }, 'drag');
    const d = f.flush();
    expect(d.ran).toBe(3);
    expect(runs.get('Midpoint')).toBe(3);
    expect(f.value('A')).toEqual({ x: 50, y: 50 });
    expect(f.value('M')).toEqual({ x: 27, y: 25 });
  });

  it('a flush with nothing marked runs nothing and reports nothing', () => {
    const f = figure(DIAMOND);
    resetRuns();
    const d = f.flush();
    expect(d.ran).toBe(0);
    expect(d.valueIds).toEqual([]);
    expect(runs.size).toBe(0);
  });

  it('inputs are final when a rule runs: values are consistent after one flush', () => {
    const f = figure(DIAMOND);
    f.setFree('A', { x: 8, y: 0 }, 'api');
    f.setFree('B', { x: 0, y: 8 }, 'api');
    f.flush();
    const M = f.value('M') as { x: number; y: number };
    const N = f.value('N') as { x: number; y: number };
    const P = f.value('P') as { x: number; y: number };
    expect(M).toEqual({ x: 4, y: 4 });
    expect(N).toEqual({ x: 6, y: 2 });
    expect(P).toEqual({ x: 5, y: 3 });
  });

  it('the pass reports the ids whose value changed', () => {
    const f = figure(DIAMOND);
    f.setFree('A', { x: 2, y: 2 }, 'api');
    const d = f.flush();
    const ids = new Set(d.valueIds);
    for (const n of ['A', 'M', 'N', 'P']) expect(ids.has(idOf(f, n) as never)).toBe(true);
    for (const n of ['B', 'C', 'D', 'far']) expect(ids.has(idOf(f, n) as never)).toBe(false);
  });

  it('works for every free value kind: Number, Point, Bool', () => {
    const f = figure(['a = 2', 'P = (1, 1)', 'flag = true', 'r = Reciprocal(a)', 'v = Vector(1, 2)', 'Q = Translate(P, v)', 'ok1 = Defined(a)']);
    resetRuns();
    f.setFree('a', 4, 'slider');
    f.flush();
    expect(f.value('r')).toBe(0.25);
    expect(runs.get('Translate') ?? 0).toBe(0);
    f.setFree('flag', false, 'api');
    const d = f.flush();
    expect(d.ran).toBe(0); // nothing reads flag
    expect(f.value('flag')).toBe(false);
  });
});

describe('early cut-off', () => {
  it('a rule whose output did not change does not mark its children', () => {
    const f = figure(['a = 3.2', 'g = floor(a)', 'r = Reciprocal(g)', 'r2 = Reciprocal(r)']);
    resetRuns();
    f.setFree('a', 3.7, 'slider');
    const d = f.flush();
    expect(f.value('g')).toBe(3); // floor(3.7) is still 3
    expect(runs.get('Reciprocal') ?? 0).toBe(0); // nothing after g ran
    expect(d.valueIds).not.toContain(idOf(f, 'r'));
    expect(d.valueIds).not.toContain(idOf(f, 'g'));
    expect(d.valueIds).toContain(idOf(f, 'a'));
  });

  it('children do run when the output did change', () => {
    const f = figure(['a = 3.2', 'g = floor(a)', 'r = Reciprocal(g)']);
    resetRuns();
    f.setFree('a', 4.1, 'slider');
    f.flush();
    expect(runs.get('Reciprocal')).toBe(1);
    expect(f.value('r')).toBe(0.25);
  });

  it('cut-off compares structurally: an equal point built again is not a change', () => {
    const f = figure(['a = 1', 'P = (floor(a), 0)', 'Q = Midpoint(P, P)']);
    resetRuns();
    f.setFree('a', 1.5, 'slider');
    f.flush();
    expect(runs.get('Midpoint') ?? 0).toBe(0);
  });

  it('the cut-off stops only that branch: a sibling branch still runs', () => {
    const f = figure(['a = 3.2', 'g = floor(a)', 'r = Reciprocal(g)', 'q = Reciprocal(a)']);
    resetRuns();
    f.setFree('a', 3.7, 'slider');
    f.flush();
    expect(runs.get('Reciprocal')).toBe(1); // q only
  });

  it('sameValue: numbers (NaN equals NaN, 0 equals -0), points, lists and nested values', () => {
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue(1, 2)).toBe(false);
    expect(sameValue(NaN, NaN)).toBe(true);
    expect(sameValue(0, -0)).toBe(true);
    expect(sameValue({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(sameValue({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
    expect(sameValue([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(sameValue([1, 2, 3], [1, 2])).toBe(false);
    expect(sameValue([{ x: 1, y: 1 }], [{ x: 1, y: 1 }])).toBe(true);
    expect(sameValue('a', 'a')).toBe(true);
    expect(sameValue('a', 'b')).toBe(false);
    expect(sameValue(true, false)).toBe(false);
    expect(sameValue({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 } }, { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } })).toBe(true);
  });
});

describe('the clock is a source with its own downstream list (the time set)', () => {
  it('a seek runs only the rules that read t, once', () => {
    const f = figure(['A = (0, 0)', 'B = (1, 1)', 'M = Midpoint(A, B)', 'O = Orbit(2, t)', 'v = Vector(1, 2)', 'R = Translate(O, v)', 'r = Reciprocal(1)']);
    resetRuns();
    f.setClock(1.5);
    expect(runs.get('Orbit')).toBe(1);
    expect(runs.get('Translate')).toBe(1);
    expect(runs.get('Midpoint') ?? 0).toBe(0);
    expect(runs.get('Reciprocal') ?? 0).toBe(0);
    const O = f.value('O') as { x: number; y: number };
    expect(O.x).toBeCloseTo(2 * Math.cos(1.5), 12);
    expect(O.y).toBeCloseTo(2 * Math.sin(1.5), 12);
  });

  it('a formula that reads t moves with the clock', () => {
    const f = figure(['x1 = 2 * t', 'x2 = x1 + 1']);
    f.setClock(3);
    expect(f.value('x1')).toBe(6);
    expect(f.value('x2')).toBe(7);
  });

  it('a rule that reads t and a slider is a source-dependent rule on both', () => {
    const f = figure(['a = 2 in 0..5', 'x1 = a * t']);
    f.setClock(2);
    expect(f.value('x1')).toBe(4);
    f.setFree('a', 3, 'slider');
    f.flush();
    expect(f.value('x1')).toBe(6);
    f.setClock(10);
    expect(f.value('x1')).toBe(30);
  });

  it('deleting t-dependent objects never touches t', () => {
    const f = figure(['O = Orbit(2, t)']);
    f.setClock(4);
    ok(f.apply('Delete(O)'));
    expect(f.clock().t).toBe(4);
  });
});

describe('redefinition that needs a reorder (kernel design 6.1)', () => {
  const base = ['Q = (2, 0)', 'P = (0, 0)', 'X = Midpoint(P, Q)', 'R = (8, 0)', 'S = Midpoint(R, R)'];

  it('moves the new inputs and their ancestors to just before the object, in their old relative order', () => {
    const f = figure(base);
    const r = ok(f.apply('P = Midpoint(S, Q)'));
    expect(r.op).toBe('redefine');
    expect(r.changed.redefined).toEqual(['P']);
    expect(r.changed.moved).toEqual(['R', 'S']);
    expect(f.names()).toEqual(['Q', 'R', 'S', 'P', 'X']);
    expect(f.value('P')).toEqual({ x: 5, y: 0 });
    expect(f.value('X')).toEqual({ x: 3.5, y: 0 });
  });

  it('moves only what is needed and nothing else changes relative order', () => {
    const f = figure(['Q = (2, 0)', 'P = (0, 0)', 'Z = (5, 5)', 'X = Midpoint(P, Q)', 'R = (8, 0)']);
    const r = ok(f.apply('P = Midpoint(R, Q)'));
    expect(r.changed.moved).toEqual(['R']);
    expect(f.names()).toEqual(['Q', 'R', 'P', 'Z', 'X']);
  });

  it('keeps ids and keeps order a valid dependency order', () => {
    const f = figure(base);
    const ids = new Map(f.objects().map((o) => [o.name, o.id]));
    ok(f.apply('P = Midpoint(S, Q)'));
    for (const o of f.objects()) {
      expect(o.id).toBe(ids.get(o.name));
      for (const i of o.inputs) expect(must(f.get(i as never)).order).toBeLessThan(o.order);
    }
  });

  it('no reorder when the new inputs come earlier', () => {
    const f = figure(base);
    const r = ok(f.apply('X = Midpoint(Q, P)'));
    expect(r.changed.moved).toEqual([]);
    expect(f.names()).toEqual(['Q', 'P', 'X', 'R', 'S']);
  });

  it('reports the reorder as a notice (moved_for_order)', () => {
    const f = figure(base);
    const r = ok(f.apply('P = Midpoint(S, Q)'));
    expect(r.notices.map((n) => n.kind)).toContain('moved_for_order');
  });

  it('the script after a reorder lists the new order and loads cleanly', () => {
    const f = figure(base);
    ok(f.apply('P = Midpoint(S, Q)'));
    const s = f.toScript();
    expect(s.indexOf('R = ')).toBeLessThan(s.indexOf('P = '));
    expect(s.indexOf('S = ')).toBeLessThan(s.indexOf('P = '));
    const names = f.names();
    const copy = newFigure();
    build(copy, s.split('\n').filter((l) => l !== '' && !l.startsWith('@')));
    expect(copy.names()).toEqual(names);
  });
});

describe('lazy demand: push marks, pull values (performance.md section 3)', () => {
  it('objects nobody reads are not computed until read', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'N = Midpoint(M, B)']);
    f.setDemand([idOf(f, 'M') as never]);
    resetRuns();
    f.setFree('A', { x: 2, y: 0 }, 'api');
    f.flush();
    expect(runs.get('Midpoint')).toBe(1); // M only
    expect(f.value('N')).toEqual({ x: 3.5, y: 0 }); // computed on read, and correct
    expect(runs.get('Midpoint')).toBe(2);
  });

  it('what a demanded object reads is computed too', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'N = Midpoint(M, B)']);
    f.setDemand([idOf(f, 'N') as never]);
    f.setFree('A', { x: 2, y: 0 }, 'api');
    f.flush();
    expect(f.value('M')).toEqual({ x: 3, y: 0 });
    expect(f.value('N')).toEqual({ x: 3.5, y: 0 });
  });

  it('setDemand(null) returns to eager mode', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'N = Midpoint(M, B)']);
    f.setDemand([idOf(f, 'M') as never]);
    f.setDemand(null);
    resetRuns();
    f.setFree('A', { x: 2, y: 0 }, 'api');
    f.flush();
    expect(runs.get('Midpoint')).toBe(2);
  });
});

describe('free objects are sources: dragging and playing never rebuild structure', () => {
  it('the object list and ids are unchanged by writes and seeks', () => {
    const f = figure([...DIAMOND, 'O = Orbit(1, t)']);
    const before = f.objects().map((o) => `${o.id}:${o.name}:${o.order}`);
    for (let i = 0; i < 20; i++) {
      f.setFree('A', { x: i, y: 0 }, 'drag');
      f.flush();
      f.setClock(i / 10);
    }
    expect(f.objects().map((o) => `${o.id}:${o.name}:${o.order}`)).toEqual(before);
  });
});
