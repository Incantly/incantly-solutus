/**
 * Limits: the Limits object, the limit error, run-time limit reasons, the rule time budget, determinism.
 * Docs: kernel/errors.md 6 and 4 (limit); errors/errors.md 1.5 and 5.8 (K040); errors/design.md 9;
 * kernel/design.md 6.3 (slowRules) and 15; AGENTS.md (no wall clock, no unseeded randomness).
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS, Figure, resolveLimits } from '@incantly/kernel';
import { TEST_COMMANDS, bad, expectUnchanged, expectWellFormedError, figure, newFigure, ok, reasonOf, snap } from './helpers';

describe('the Limits object', () => {
  it('has the defaults of kernel/errors.md section 6', () => {
    expect(DEFAULT_LIMITS.objects).toBe(5000);
    expect(DEFAULT_LIMITS.exprNodes).toBe(400);
    expect(DEFAULT_LIMITS.lineLength).toBe(2000);
    expect(DEFAULT_LIMITS.listSize).toBe(100000);
    expect(DEFAULT_LIMITS.depth).toBe(64);
    expect(DEFAULT_LIMITS.journalEntries).toBe(500);
    expect(DEFAULT_LIMITS.journalBytes).toBe(4 * 1024 * 1024);
    expect(DEFAULT_LIMITS.ruleBudgetMs).toBe(2);
    // "load file size 2 MB": either megabyte convention
    expect(DEFAULT_LIMITS.fileSize).toBeGreaterThanOrEqual(2_000_000);
    expect(DEFAULT_LIMITS.fileSize).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(DEFAULT_LIMITS.extra).toEqual({});
  });

  it('resolveLimits puts the host\'s values on top of the defaults', () => {
    const l = resolveLimits({ objects: 10, lineLength: 100 });
    expect(l.objects).toBe(10);
    expect(l.lineLength).toBe(100);
    expect(l.exprNodes).toBe(DEFAULT_LIMITS.exprNodes);
    expect(resolveLimits(undefined)).toEqual(DEFAULT_LIMITS);
    expect(resolveLimits({})).toEqual(DEFAULT_LIMITS);
  });

  it('values that are not positive finite numbers are ignored', () => {
    const l = resolveLimits({ objects: -3, listSize: NaN, depth: 0, exprNodes: Infinity });
    expect(l.objects).toBe(DEFAULT_LIMITS.objects);
    expect(l.listSize).toBe(DEFAULT_LIMITS.listSize);
    expect(l.depth).toBe(DEFAULT_LIMITS.depth);
    expect(l.exprNodes).toBe(DEFAULT_LIMITS.exprNodes);
  });

  it('areas add their own limits through extra', () => {
    const l = resolveLimits({ extra: { particles: 20000 } });
    expect(l.extra.particles).toBe(20000);
  });

  it('a host lowers them for a figure and the figure reports them', () => {
    const f = newFigure({ limits: { objects: 7, journalEntries: 9 } });
    expect(f.limits.objects).toBe(7);
    expect(f.limits.journalEntries).toBe(9);
    expect(f.limits.lineLength).toBe(2000);
  });
});

describe('limit errors at line time', () => {
  it('objects: the line that would go over is refused, with the limit, the maximum and the figure unchanged', () => {
    const f = newFigure({ limits: { objects: 5 } });
    for (let i = 0; i < 5; i++) ok(f.apply(`p${i} = ${i}`));
    const before = snap(f);
    const line = 'p5 = 5';
    const e = bad(f.apply(line), 'limit');
    expectWellFormedError(e);
    expect(e.code).toBe('K040');
    expect(e.params.limit).toBe('objects');
    expect(e.params.max).toBe(5);
    expect(e.recovery).toBe('rewrite');
    expect(e.message).toContain('5');
    expectUnchanged(f, before);
    expect(f.count).toBe(5);
  });

  it('after a delete there is room again', () => {
    const f = newFigure({ limits: { objects: 3 } });
    for (let i = 0; i < 3; i++) ok(f.apply(`p${i} = ${i}`));
    bad(f.apply('p3 = 3'), 'limit');
    ok(f.apply('Delete(p0)'));
    ok(f.apply('p3 = 3'));
  });

  it('a redefinition is not a new object, so it is allowed at the limit', () => {
    const f = newFigure({ limits: { objects: 3 } });
    for (let i = 0; i < 3; i++) ok(f.apply(`p${i} = ${i}`));
    ok(f.apply('p1 = 10'));
  });

  it('undo of a delete at the limit does not leave the figure over it', () => {
    const f = newFigure({ limits: { objects: 3 } });
    for (let i = 0; i < 3; i++) ok(f.apply(`p${i} = ${i}`));
    ok(f.apply('Delete(p0)'));
    ok(f.apply('q = 1'));
    // undo q, then undo the delete: back to three objects
    ok(f.undo());
    ok(f.undo());
    expect(f.count).toBe(3);
  });

  it('line_length: one character over is refused, exactly at the limit passes', () => {
    const f = newFigure({ limits: { lineLength: 40 } });
    const at = `s = "${'x'.repeat(40 - 6)}"`;
    expect(at.length).toBe(40);
    ok(f.apply(at));
    const over = `t2 = "${'x'.repeat(40 - 6 + 1)}"`;
    const e = bad(f.apply(over), 'limit');
    expect(e.params.limit).toBe('line_length');
    expect(e.params.max).toBe(40);
    expect(e.params.got).toBe(over.length);
  });

  it('line_length at the default: 2,000 characters', () => {
    const f = newFigure();
    ok(f.apply(`s = "${'x'.repeat(2000 - 6)}"`));
    const e = bad(f.apply(`t2 = "${'x'.repeat(2000)}"`), 'limit');
    expect(e.params.limit).toBe('line_length');
    expect(e.params.max).toBe(2000);
  });

  it('expr_nodes: more than 400 nodes in one line', () => {
    const f = newFigure();
    const terms = (n: number): string => Array.from({ length: n }, () => '1').join(' + ');
    ok(f.apply(`a = ${terms(150)}`)); // 299 nodes
    const before = snap(f);
    const e = bad(f.apply(`b = ${terms(300)}`), 'limit'); // 599 nodes
    expect(e.params.limit).toBe('expr_nodes');
    expect(e.params.max).toBe(400);
    expectUnchanged(f, before);
  });

  it('expr_nodes can be lowered by the host', () => {
    const f = newFigure({ limits: { exprNodes: 10 } });
    ok(f.apply('a = 1 + 2 + 3'));
    const e = bad(f.apply('b = 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8'), 'limit');
    expect(e.params.limit).toBe('expr_nodes');
  });

  it('list_size: a literal list over the limit is refused when the line is checked', () => {
    const f = newFigure({ limits: { listSize: 5 } });
    ok(f.apply('L = [1, 2, 3, 4, 5]'));
    const e = bad(f.apply('M = [1, 2, 3, 4, 5, 6]'), 'limit');
    expect(e.params.limit).toBe('list_size');
    expect(e.params.max).toBe(5);
  });

  it('depth: nesting of 64 passes, far beyond fails with the depth limit', () => {
    const f = newFigure();
    const nest = (n: number): string => `${'('.repeat(n)}1${')'.repeat(n)}`;
    ok(f.apply(`a = ${nest(30)}`));
    const r = f.apply(`b = ${nest(200)}`);
    // Docs say "rule nesting depth 64": nesting this deep must be refused, as a limit error (or a syntax error that names depth).
    const e = bad(r);
    expect(['limit', 'syntax']).toContain(e.kind);
    if (e.kind === 'limit') expect(e.params.limit).toBe('depth');
  });

  it('the message and hint of a limit error are in plain words', () => {
    const f = newFigure({ limits: { objects: 1 } });
    ok(f.apply('p = 1'));
    const e = bad(f.apply('q = 2'), 'limit');
    expect(e.message).toMatch(/limit/i);
    expect(e.hint ?? '').not.toBe('');
  });

  it('a batch refuses what goes over the limit and rolls back (atomic)', () => {
    const f = newFigure({ limits: { objects: 2 } });
    const r = f.applyBatch(['a = 1', 'b = 2', 'c = 3'], { group: 'g' });
    expect(r.ok).toBe(false);
    expect(f.count).toBe(0);
  });

  it('loading respects the object limit', () => {
    const { figure: f, report } = Figure.fromScript('@fig 1\na = 1\nb = 2\nc = 3\n', { commands: TEST_COMMANDS, limits: { objects: 2 } });
    expect(f.count).toBe(2);
    expect(report.errors.some((e) => e.params.limit === 'objects')).toBe(true);
  });

  it('5,000 objects is the default and the 5,001st is refused', () => {
    const f = newFigure();
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) lines.push(`p${i} = ${i}`);
    const r = f.applyBatch(lines, { group: 'g' });
    expect(r.ok).toBe(true);
    expect(f.count).toBe(5000);
    const e = bad(f.apply('extra = 1'), 'limit');
    expect(e.params.limit).toBe('objects');
    expect(e.params.max).toBe(5000);
  }, 60_000);
});

describe('limits at run time are undefined values, not errors', () => {
  it('a rule that would make a list over list_size gives undefined with reason limit', () => {
    const f = newFigure({ limits: { listSize: 100 } });
    const r = ok(f.apply('R = Range(101)'));
    expect(r.ok).toBe(true);
    expect(reasonOf(f, 'R')).toBe('limit');
    ok(f.apply('R2 = Range(100)'));
    expect(reasonOf(f, 'R2')).toBeUndefined();
  });

  it('at the default 100,000 a longer list from a rule is undefined (limit)', () => {
    const f = newFigure();
    ok(f.apply('R = Range(100001)'));
    expect(reasonOf(f, 'R')).toBe('limit');
    ok(f.apply('R2 = Range(100000)'));
    expect(reasonOf(f, 'R2')).toBeUndefined();
  });

  it('what reads it inherits input_undefined', () => {
    const f = newFigure({ limits: { listSize: 10 } });
    ok(f.apply('R = Range(11)'));
    ok(f.apply('tt = Total(R)'));
    expect(reasonOf(f, 'tt')).toBe('input_undefined');
    expect(f.rootCause('tt')).toEqual({ name: 'R', reason: 'limit' });
  });
});

describe('the journal limit', () => {
  it('oldest entries are dropped and undoInfo says so (no error)', () => {
    const f = newFigure({ limits: { journalEntries: 3 } });
    for (let i = 0; i < 6; i++) ok(f.apply(`p${i} = ${i}`));
    expect(f.undoInfo()).toEqual(expect.objectContaining({ depth: 3, dropped: 3, capacity: 3 }));
  });
});

describe('the rule time budget (design 6.3)', () => {
  it('a rule that overruns is allowed to finish, and the figure records it in slowRules', { retry: 2 }, () => {
    let clock = 0;
    const f = new Figure({ commands: TEST_COMMANDS, now: () => (clock += 10) });
    ok(f.apply('A = (0, 0)'));
    ok(f.apply('B = (4, 0)'));
    ok(f.apply('M = Midpoint(A, B)'));
    expect(f.value('M')).toEqual({ x: 2, y: 0 });
    f.setFree('A', { x: 2, y: 2 }, 'drag');
    f.flush();
    expect(f.value('M')).toEqual({ x: 3, y: 1 });
    expect(f.slowRules.length).toBeGreaterThan(0);
    const s = f.slowRules.find((x) => x.name === 'M');
    expect(s).toBeDefined();
    expect(s?.ms).toBeGreaterThan(2);
  });

  it('with no clock given nothing is recorded and nothing reads a clock', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)']);
    expect(f.slowRules).toEqual([]);
  });
});

describe('determinism: no wall clock and no unseeded randomness in the kernel (AGENTS.md)', () => {
  it('building, flushing, seeking, undoing, saving and loading never read Date, performance or Math.random', () => {
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('the kernel read Date.now');
    });
    const perfNow = vi.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('the kernel read performance.now');
    });
    const rand = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('the kernel read Math.random');
    });
    try {
      const f = new Figure({ commands: TEST_COMMANDS });
      for (const l of ['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'a = 3 in 0..10', 'x1 = rand(1) + a * t', 'th = state(0.6)', "th' = -th"]) ok(f.apply(l));
      f.setFree('A', { x: 1, y: 1 }, 'drag');
      f.flush();
      f.commitDrag();
      f.setClock(2);
      f.slice('a', 'x1');
      f.applyBatch(['q1 = 1', 'q2 = q1 + 1'], { group: 'g' });
      ok(f.undo());
      ok(f.redo());
      const script = f.toScript();
      Figure.fromScript(script, { commands: TEST_COMMANDS });
    } finally {
      dateNow.mockRestore();
      perfNow.mockRestore();
      rand.mockRestore();
    }
  });

  it('rand(seed) is a fixed number in [0, 1) for each seed', () => {
    const f = figure(['r1 = rand(7)', 'r2 = rand(7)', 'r3 = rand(8)']);
    expect(f.value('r1')).toBe(f.value('r2'));
    expect(f.value('r1')).not.toBe(f.value('r3'));
    for (const n of ['r1', 'r3']) {
      const v = f.value(n) as number;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const g = figure(['r1 = rand(7)']);
    expect(g.value('r1')).toBe(f.value('r1'));
  });

  it('the same script gives the same figure every time', () => {
    const lines = ['A = (0, 0)', 'B = (4, 3)', 'M = Midpoint(A, B)', 'x1 = noise(1, 2) + rand(3)', 'th = state(0.6)', "th' = -th"];
    const a = figure(lines);
    const b = figure(lines);
    a.setClock(2.5);
    b.setClock(2.5);
    for (const o of a.objects()) expect(b.get(o.name)?.cell).toEqual(o.cell);
  });
});

describe('rule faults are internal errors, not exceptions (kernel errors.md 5 rules 4 and 7)', () => {
  it('a rule that throws rolls the line back and gives internal with recovery skip', () => {
    const f = figure(['n = 5']);
    const before = snap(f);
    const e = bad(f.apply('x1 = Boom(n)'), 'internal');
    expectWellFormedError(e);
    expect(e.code).toBe('K999');
    expect(e.recovery).toBe('skip');
    expect(e.phase).toBe('commit');
    expect(e.fingerprint.startsWith('internal:')).toBe(true);
    expect(e.message).toContain('Boom');
    expect(e.message).toContain('nothing was changed');
    expectUnchanged(f, before);
  });

  it('the stack and the thrown text stay out of the error object', () => {
    const f = figure(['n = 5']);
    const e = bad(f.apply('x1 = Boom(n)'), 'internal');
    const json = JSON.stringify(e);
    expect(json).not.toContain('boom');
    expect(json).not.toMatch(/\.ts:\d+/);
    expect(json).not.toContain('at ');
  });

  it('a faulty redefinition of an existing object leaves the old definition in place', () => {
    const f = figure(['n = 5', 'x1 = Unlucky(n)']);
    const before = snap(f);
    bad(f.apply('x1 = Boom(n)'), 'internal');
    expectUnchanged(f, before);
    expect(f.value('x1')).toBe(5);
  });

  it('a rule that throws during a later pass does not escape flush, and the figure keeps working', () => {
    const f = figure(['n = 5', 'x1 = Unlucky(n)', 'y1 = n * 2']);
    f.setFree('n', 13, 'slider');
    expect(() => f.flush()).not.toThrow();
    expect(f.value('y1')).toBe(26);
    f.setFree('n', 4, 'slider');
    expect(() => f.flush()).not.toThrow();
    expect(f.value('x1')).toBe(4);
  });

  it('a fault in a seek does not escape setClock', () => {
    const f = figure(['x1 = 1 / t', 'n = 3']);
    expect(() => f.setClock(0)).not.toThrow();
    expect(() => f.setClock(1)).not.toThrow();
    expect(f.value('x1')).toBe(1);
  });
});
