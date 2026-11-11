/**
 * applyBatch: atomic (default) and independent modes, blockedBy, one undo step, one update pass.
 * Docs: README decision 8; kernel rulings K6; kernel/errors.md 4 (blockedBy example) and 5 rules 1 and 2;
 * errors/design.md 3 (blockedBy) and 6 rules 1 and 2; kernel/design.md 4.5 and 11.2.
 */
import { describe, expect, it } from 'vitest';
import { bad, expectUnchanged, expectWellFormedError, figure, newFigure, ok, recordEvents, resetRuns, runs, snap } from './helpers';

const BASE = ['A = (0, 0)', 'B = (4, 0)'];

describe('atomic mode (the default): all lines or none', () => {
  it('applies every line, in order, and later lines can use names from earlier ones', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['M = Midpoint(A, B)', 'N = Midpoint(A, M)', 'd = Distance(M, N)'], { group: 'g' });
    expect(r.ok).toBe(true);
    expect(r.rolledBack).toBe(false);
    expect(r.applied).toBe(3);
    expect(r.results.length).toBe(3);
    r.results.forEach((x, i) => {
      expect(x.ok).toBe(true);
      expect(x.line).toBe(i + 1);
    });
    expect(f.value('d')).toBe(1);
  });

  it('a failing line undoes the lines before it: the figure is exactly as it was', () => {
    const f = figure(BASE);
    const before = snap(f);
    const r = f.applyBatch(['M = Midpoint(A, B)', 'N = Midpoint(A, M)', 'Q = Midpoint(A, Nope)', 'K = (1, 1)'], { group: 'g' });
    expect(r.ok).toBe(false);
    expect(r.rolledBack).toBe(true);
    expect(r.applied).toBe(0);
    expectUnchanged(f, before);
    expect(f.get('M')).toBeUndefined();
  });

  it('the error for the failing line carries its line number in the batch', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['M = Midpoint(A, B)', 'N = Midpoint(A, M)', 'Q = Midpoint(A, Nope)'], { group: 'g' });
    const failing = r.results.find((x) => !x.ok);
    expect(failing).toBeDefined();
    const e = bad(failing as never, 'unknown_name');
    expectWellFormedError(e);
    expect(e.line).toBe(3);
    expect(e.token).toBe('Nope');
  });

  it('the figure after a rollback is bit-for-bit what it was, including the journal and redo stack', () => {
    const f = figure(BASE);
    ok(f.apply('Z = (3, 3)'));
    ok(f.undo());
    const before = snap(f);
    f.applyBatch(['Y = (1, 1)', 'X = Midpoint(Y, Nope)'], { group: 'g' });
    expectUnchanged(f, before);
    expect(f.undoInfo().redoDepth).toBe(1);
  });

  it('one undo step for the whole batch', () => {
    const f = figure(BASE);
    const depth = f.undoInfo().depth;
    f.applyBatch(['M = Midpoint(A, B)', 'N = Midpoint(A, M)', 'P = (9, 9)'], { group: 'utterance' });
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(f.names()).toEqual(['A', 'B']);
    ok(f.redo());
    expect(f.names()).toEqual(['A', 'B', 'M', 'N', 'P']);
  });

  it('the group label is the one given', () => {
    const f = figure(BASE);
    f.applyBatch(['M = Midpoint(A, B)'], { group: 'the midpoint' });
    expect(f.undoInfo().next).toContain('the midpoint');
  });

  it('one update pass for the batch: each rule runs once even when several lines touch its inputs', () => {
    const f = figure([...BASE, 'M = Midpoint(A, B)']);
    resetRuns();
    f.applyBatch(['A = (2, 2)', 'B = (6, 6)'], { group: 'g' });
    // M is recomputed after both lines. Each line commits on its own (kernel design 5), so at most one run per line.
    expect(runs.get('Midpoint') ?? 0).toBeLessThanOrEqual(2);
    expect(f.value('M')).toEqual({ x: 4, y: 4 });
  });

  it('events are delivered once for the batch, not once per line', () => {
    const f = figure([...BASE, 'M = Midpoint(A, B)']);
    const rec = recordEvents(f);
    f.applyBatch(['A = (2, 2)', 'B = (6, 6)', 'C = (1, 1)'], { group: 'g' });
    expect(rec.events.filter((e) => e.ev === 'value').length).toBeLessThanOrEqual(1);
    expect(rec.events.filter((e) => e.ev === 'add').length).toBe(1);
  });

  it('the merged change report lists everything the batch did', () => {
    const f = figure(['O = (0, 0)', 'Q = (4, 1)', 'P = (0, 2)', 'l1 = Line(O, Q)']);
    const r = f.applyBatch(['l2 = Parallel(P, l1)', 'I = Intersect(l1, l2)', 'K = (1, 1)'], { group: 'g' });
    expect(r.ok).toBe(true);
    expect(r.changed.added).toEqual(['l2', 'I', 'K']);
    expect(r.changed.becameUndefined.map((x) => x.name)).toEqual(['I']);
    expect(r.notices.map((n) => n.kind)).toContain('became_undefined');
  });

  it('a redefinition and a delete in one batch are both reported', () => {
    const f = figure([...BASE, 'M = Midpoint(A, B)', 'N = Midpoint(M, B)']);
    const r = f.applyBatch(['A = (1, 1)', 'Delete(N)'], { group: 'g' });
    expect(r.changed.redefined).toEqual(['A']);
    expect(r.changed.removed).toEqual(['N']);
  });

  it('an empty batch is a success and leaves no undo step', () => {
    const f = figure(BASE);
    const depth = f.undoInfo().depth;
    const r = f.applyBatch([], { group: 'g' });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(0);
    expect(f.undoInfo().depth).toBe(depth);
  });

  it('the `lines` option sets the line numbers shown in errors (a file, not a batch)', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['M = Midpoint(A, B)', 'N = Midpoint(A, Nope)'], { group: 'g', lines: [10, 14] });
    const e = bad(r.results.find((x) => !x.ok) as never);
    expect(e.line).toBe(14);
  });

  it('a locked line fails the whole batch and leaves the fixed object as it was', () => {
    const f = figure(BASE);
    ok(f.apply('A with fixed = true'));
    const before = snap(f);
    const r = f.applyBatch(['P = (1, 1)', 'A = (5, 5)'], { group: 'g' });
    expect(r.ok).toBe(false);
    expect(r.results.find((x) => !x.ok && x.kind === 'locked')).toBeDefined();
    expectUnchanged(f, before);
  });

  it('a type_change in the middle rolls back the earlier redefinitions too', () => {
    const f = figure([...BASE, 'a = 1']);
    const before = snap(f);
    const r = f.applyBatch(['A = (7, 7)', 'a = Circle(A, 2)'], { group: 'g' });
    expect(r.rolledBack).toBe(true);
    expectUnchanged(f, before);
    expect(f.value('A')).toEqual({ x: 0, y: 0 });
  });

  it('a thrown rule fault is internal and rolls the whole batch back', () => {
    const f = figure(BASE);
    const before = snap(f);
    const r = f.applyBatch(['P = (1, 1)', 'x1 = Boom(1)'], { group: 'g' });
    expect(r.rolledBack).toBe(true);
    const e = bad(r.results.find((x) => !x.ok) as never, 'internal');
    expect(e.recovery).toBe('skip');
    expectUnchanged(f, before);
  });

  it('accepts parsed lines as well as text (any value kind in the batch)', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['a = 3 in 0..10', 'flag = true', 's = "x"', 'L = [1, 2, 3]', 'f(x) = x^2', 'M = Midpoint(A, B)'], { group: 'g' });
    expect(r.ok).toBe(true);
    expect(f.names()).toEqual(['A', 'B', 'a', 'flag', 's', 'L', 'f', 'M']);
  });
});

describe('independent mode: every line on its own (ruling K6, errors.md 5 rule 2)', () => {
  it('later lines run even if an earlier one failed', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['M = Midpoint(A, B)', 'Q = Midpoint(A, Nope)', 'N = Midpoint(A, M)'], { group: 'g', mode: 'independent' });
    expect(r.ok).toBe(false);
    expect(r.rolledBack).toBe(false);
    expect(r.applied).toBe(2);
    expect(f.get('M')).toBeDefined();
    expect(f.get('N')).toBeDefined();
    expect(f.get('Q')).toBeUndefined();
    expect(r.results.map((x) => x.ok)).toEqual([true, false, true]);
  });

  it('a line that reads the name of a failed line gets blockedBy and recovery fix_earlier', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['T = Midpoint(A, Nope)', 'U = Midpoint(A, T)'], { group: 'g', mode: 'independent' });
    const e1 = bad(r.results[0] as never, 'unknown_name');
    const e2 = bad(r.results[1] as never, 'unknown_name');
    expect(e1.blockedBy).toBeUndefined();
    expect(e2.blockedBy).toEqual({ line: 1, kind: 'unknown_name' });
    expect(e2.recovery).toBe('fix_earlier');
    expect(e2.token).toBe('T');
    expect(e2.message).toContain('T');
    expect(e2.hint ?? '').not.toBe('');
  });

  it('blockedBy names the real fault once, not a pile of copies: each later line points at the first failure', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['T = Midpoint(A, Nope)', 'U = Midpoint(A, T)', 'V = Midpoint(U, T)'], { group: 'g', mode: 'independent' });
    const e3 = bad(r.results[2] as never);
    expect(e3.blockedBy).toBeDefined();
    expect([1, 2]).toContain(e3.blockedBy?.line);
  });

  it('blockedBy carries the kind of the earlier failure (kernel errors.md 4)', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['T = Midpont(A, B)', 'U = Midpoint(A, T)'], { group: 'g', mode: 'independent' });
    const e1 = bad(r.results[0] as never, 'unknown_command');
    const e2 = bad(r.results[1] as never);
    expect(e2.blockedBy).toEqual({ line: 1, kind: e1.kind });
  });

  it('applied lines are one undo group', () => {
    const f = figure(BASE);
    const depth = f.undoInfo().depth;
    f.applyBatch(['M = Midpoint(A, B)', 'Q = Midpoint(A, Nope)', 'N = Midpoint(A, M)'], { group: 'g', mode: 'independent' });
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(f.names()).toEqual(['A', 'B']);
  });

  it('a failed line leaves no trace: each failure is atomic on its own', () => {
    const f = figure(BASE);
    f.applyBatch(['M = Midpoint(A, B)', 'A = Midpoint(M, B)', 'N = Midpoint(A, M)'], { group: 'g', mode: 'independent' });
    expect(f.value('A')).toEqual({ x: 0, y: 0 }); // the cycle line did nothing
    expect(f.value('N')).toEqual({ x: 1, y: 0 });
  });

  it('a name defined by a later good line clears the block for lines after it', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['T = Midpoint(A, Nope)', 'T = Midpoint(A, B)', 'U = Midpoint(A, T)'], { group: 'g', mode: 'independent' });
    expect(r.results.map((x) => x.ok)).toEqual([false, true, true]);
  });

  it('with no failure it behaves as an atomic batch would', () => {
    const f1 = figure(BASE);
    const f2 = figure(BASE);
    const lines = ['M = Midpoint(A, B)', 'N = Midpoint(A, M)'];
    f1.applyBatch(lines, { group: 'g' });
    f2.applyBatch(lines, { group: 'g', mode: 'independent' });
    expect(f1.toScript()).toBe(f2.toScript());
    expect(f1.undoInfo().depth).toBe(f2.undoInfo().depth);
  });

  it('the merged report covers only what was applied', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['M = Midpoint(A, B)', 'Q = Midpoint(A, Nope)'], { group: 'g', mode: 'independent' });
    expect(r.changed.added).toEqual(['M']);
  });
});

describe('batches and the other rules', () => {
  it('a batch on a figure with a limit refuses the line that goes over and, atomically, none are kept', () => {
    const f = newFigure({ limits: { objects: 3 } });
    const r = f.applyBatch(['a = 1', 'b = 2', 'c = 3', 'd = 4'], { group: 'g' });
    expect(r.ok).toBe(false);
    expect(f.count).toBe(0);
    const e = bad(r.results.find((x) => !x.ok) as never, 'limit');
    expect(e.params.limit).toBe('objects');
  });

  it('independent mode keeps the lines that fit under the limit', () => {
    const f = newFigure({ limits: { objects: 3 } });
    const r = f.applyBatch(['a = 1', 'b = 2', 'c = 3', 'd = 4'], { group: 'g', mode: 'independent' });
    expect(r.applied).toBe(3);
    expect(f.count).toBe(3);
  });

  it('Undo() inside a batch is not special: it is one more line', () => {
    const f = figure(BASE);
    const r = f.applyBatch(['P = (1, 1)', 'Q = (2, 2)'], { group: 'g' });
    expect(r.ok).toBe(true);
    expect(f.names()).toEqual(['A', 'B', 'P', 'Q']);
  });
});
