/**
 * kernel.slice(source, target): the rules between two objects, evaluated on a scratch copy.
 * Docs: README decision 9 (used by Locus, Path, Envelope and the CAS); core design 7.5 (Locus is pure, Path sweeps t).
 */
import { describe, expect, it } from 'vitest';
import { bad, errOf, expectUnchanged, figure, newFigure, ok, recordEvents, resetRuns, runs, snap, timed } from './helpers';

const BASE = ['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'N = Midpoint(A, M)', 'far = Distance(B, B)', 'a = 2 in -5..5', 'r = Reciprocal(a)', 'r2 = Reciprocal(r)'];

describe('slice(source, target)', () => {
  it('lists the objects that run, in order: the dependents of the source that the target reads, and the target', () => {
    const f = figure(BASE);
    const s = f.slice('A', 'N');
    expect('chain' in s).toBe(true);
    if ('chain' in s) expect(s.chain).toEqual(['M', 'N']);
  });

  it('does not include dependents the target does not read', () => {
    const f = figure(BASE);
    const s = f.slice('A', 'M');
    if ('chain' in s) expect(s.chain).toEqual(['M']);
  });

  it('gives the target\'s cell for each value of the source', () => {
    const f = figure(BASE);
    const s = f.slice('A', 'N');
    if (!('run' in s)) throw new Error('expected a slice');
    const cells = s.run([{ x: 2, y: 2 }, { x: 4, y: 4 }, { x: 0, y: 0 }]);
    expect(cells).toEqual([
      { defined: true, value: { x: 2.5, y: 1.5 } },
      { defined: true, value: { x: 4, y: 3 } },
      { defined: true, value: { x: 1, y: 0 } },
    ]);
  });

  it('works for a Number source', () => {
    const f = figure(BASE);
    const s = f.slice('a', 'r');
    if (!('run' in s)) throw new Error('expected a slice');
    expect(s.run([1, 2, 4])).toEqual([
      { defined: true, value: 1 },
      { defined: true, value: 0.5 },
      { defined: true, value: 0.25 },
    ]);
  });

  it('follows a longer chain through several rules', () => {
    const f = figure(BASE);
    const s = f.slice('a', 'r2');
    if (!('run' in s)) throw new Error('expected a slice');
    expect(s.chain).toEqual(['r', 'r2']);
    expect(s.run([4, 0.5])).toEqual([
      { defined: true, value: 4 },
      { defined: true, value: 0.5 },
    ]);
  });

  it('values that make the target undefined give an undefined cell with the reason, and the others are unaffected', () => {
    const f = figure(BASE);
    const s = f.slice('a', 'r');
    if (!('run' in s)) throw new Error('expected a slice');
    const cells = s.run([1, 0, 2]);
    expect(cells[0]).toEqual({ defined: true, value: 1 });
    expect(cells[1]?.defined).toBe(false);
    expect(cells[1] && !cells[1].defined && cells[1].reason).toBe('division_by_zero');
    expect(cells[2]).toEqual({ defined: true, value: 0.5 });
  });

  it('an undefined middle object gives input_undefined at the target', () => {
    const f = figure(BASE);
    const s = f.slice('a', 'r2');
    if (!('run' in s)) throw new Error('expected a slice');
    const c = s.run([0])[0];
    expect(c?.defined).toBe(false);
    expect(c && !c.defined && c.reason).toBe('input_undefined');
  });

  it('a Locus-like sweep: a point on a circle as a parameter runs over many values', () => {
    const f = figure(['A = (1, 0)', 'O = (0, 0)', 'M = Midpoint(A, O)', 'a = 0 in 0..7', 'P = Orbit(1, a)', 'Q = Midpoint(P, M)']);
    const s = f.slice('a', 'Q');
    if (!('run' in s)) throw new Error('expected a slice');
    const values = Array.from({ length: 64 }, (_, i) => (i / 63) * 2 * Math.PI);
    const cells = s.run(values);
    expect(cells.length).toBe(64);
    cells.forEach((c, i) => {
      const t = values[i] as number;
      expect(c.defined).toBe(true);
      const q = (c as { value: { x: number; y: number } }).value;
      expect(q.x).toBeCloseTo((Math.cos(t) + 0.5) / 2, 12);
      expect(q.y).toBeCloseTo(Math.sin(t) / 2, 12);
    });
  });

  it('the clock can be the source: slice("t", target) sweeps film time (Path)', () => {
    const f = figure(['O = Orbit(2, t)', 'v = Vector(1, 1)', 'P = Translate(O, v)']);
    const s = f.slice('t', 'P');
    if (!('run' in s)) throw new Error('expected a slice');
    expect(s.chain).toEqual(['O', 'P']);
    const cells = s.run([0, Math.PI / 2, Math.PI]);
    const pts = cells.map((c) => (c as { value: { x: number; y: number } }).value);
    expect(pts[0]?.x).toBeCloseTo(3, 12);
    expect(pts[1]?.y).toBeCloseTo(3, 12);
    expect(pts[2]?.x).toBeCloseTo(-1, 12);
  });

  it('accepts any iterable of values (a generator, a Set)', () => {
    const f = figure(BASE);
    const s = f.slice('a', 'r');
    if (!('run' in s)) throw new Error('expected a slice');
    function* gen(): Generator<number> {
      yield 1;
      yield 2;
    }
    expect(s.run(gen()).length).toBe(2);
    expect(s.run(new Set([1, 2, 4])).length).toBe(3);
  });

  it('a target that does not read the source gives its current cell for every value', () => {
    // Docs are silent. The rules between them are none, so the target cannot change.
    const f = figure(BASE);
    const s = f.slice('a', 'M');
    if (!('run' in s)) throw new Error('expected a slice');
    const cells = s.run([1, 2, 3]);
    expect(cells.length).toBe(3);
    for (const c of cells) expect(c).toEqual({ defined: true, value: { x: 2, y: 0 } });
  });
});

describe('the figure is left as it was', () => {
  it('values, script, journal and ids are unchanged after a run', () => {
    const f = figure(BASE);
    const before = snap(f);
    const s = f.slice('A', 'N');
    if (!('run' in s)) throw new Error('expected a slice');
    s.run([{ x: 9, y: 9 }, { x: 5, y: 5 }]);
    expectUnchanged(f, before);
    expect(f.value('A')).toEqual({ x: 0, y: 0 });
    expect(f.value('N')).toEqual({ x: 1, y: 0 });
  });

  it('even when the run goes through undefined values', () => {
    const f = figure(BASE);
    const before = snap(f);
    const s = f.slice('a', 'r2');
    if (!('run' in s)) throw new Error('expected a slice');
    s.run([0, 1, 0]);
    expectUnchanged(f, before);
    expect(f.value('r2')).toBe(2);
  });

  it('sends no events and marks nothing dirty: the next flush has nothing to do', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    const s = f.slice('A', 'N');
    if (!('run' in s)) throw new Error('expected a slice');
    s.run([{ x: 9, y: 9 }]);
    expect(rec.events).toEqual([]);
    resetRuns();
    const d = f.flush();
    expect(d.ran).toBe(0);
    expect(d.valueIds).toEqual([]);
    expect(runs.size).toBe(0);
  });

  it('does not touch the clock, undo history or redo stack', () => {
    const f = figure(['O = Orbit(2, t)']);
    f.setClock(1.25);
    ok(f.apply('Z = (1, 1)'));
    ok(f.undo());
    const info = f.undoInfo();
    const s = f.slice('t', 'O');
    if (!('run' in s)) throw new Error('expected a slice');
    s.run([0, 1, 2]);
    expect(f.clock().t).toBe(1.25);
    expect(f.undoInfo()).toEqual(info);
  });

  it('can be run again and again with the same result', () => {
    const f = figure(BASE);
    const s = f.slice('a', 'r');
    if (!('run' in s)) throw new Error('expected a slice');
    expect(s.run([1, 2])).toEqual(s.run([1, 2]));
  });

  it('a slice made before an edit is not required to follow it, but a new slice sees the edit', () => {
    const f = figure(BASE);
    ok(f.apply('N = Midpoint(M, B)'));
    const s = f.slice('A', 'N');
    if (!('run' in s)) throw new Error('expected a slice');
    expect((s.run([{ x: 2, y: 0 }])[0] as { value: { x: number } }).value.x).toBeCloseTo(3.5, 12);
  });
});

describe('slice errors are data, not exceptions', () => {
  it('an unknown source or target is unknown_name', () => {
    const f = figure(BASE);
    errOf(f.slice('Zed', 'N'), 'unknown_name');
    errOf(f.slice('A', 'Zed'), 'unknown_name');
  });

  it('a dependent source is not_free (it has no value to sweep)', () => {
    const f = figure(BASE);
    errOf(f.slice('M', 'N'), 'not_free');
  });

  it('a source that is a state is refused', () => {
    const f = figure(['th = state(0.5)', "th' = 1", 'y1 = th * 2']);
    const r = f.slice('th', 'y1');
    expect('kind' in r).toBe(true);
  });

  it('on an empty figure', () => {
    const f = newFigure();
    errOf(f.slice('A', 'B'));
  });

  it('a failing rule inside the run does not escape (internal) and the figure is restored', () => {
    const f = figure(['a = 1', 'u1 = Unlucky(a)']);
    const before = snap(f);
    const s = f.slice('a', 'u1');
    if ('run' in s) {
      expect(() => s.run([1, 13, 2])).not.toThrow();
    }
    expectUnchanged(f, before);
    bad(f.apply('Q = Midpoint(A, Nope)'));
  });
});

describe('slice speed', () => {
  it('10,000 values through a 3-rule chain in well under a second', () => {
    const f = figure(['a = 1 in -100..100', 'r = Reciprocal(a)', 'r2 = Reciprocal(r)', 'r3 = Reciprocal(r2)']);
    const s = f.slice('a', 'r3');
    if (!('run' in s)) throw new Error('expected a slice');
    const values = Array.from({ length: 10_000 }, (_, i) => (i + 1) / 100);
    const { ms, value } = timed(() => s.run(values));
    expect(value.length).toBe(10_000);
    expect(ms).toBeLessThan(1000);
  });
});
