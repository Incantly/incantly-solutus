import { describe, expect, it } from 'vitest';
import { KernelSession, parseFree } from '../src/session';

function lines(s: KernelSession, ...src: string[]): void {
  for (const l of src) expect(s.submit(l).ok).toBe(true);
}

describe('kernel session', () => {
  it('turns kernel objects into rows with type, value and free or dependent state', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'B = (4, 6)', 'M = Midpoint(A, B)', 'd = Distance(A, B)');
    const [a, , m, d] = s.rows();
    expect(a).toMatchObject({ name: 'A', type: 'Point', free: true, control: { kind: 'text', text: '(1, 2)' }, state: { defined: true, value: '(1, 2)' } });
    expect(m).toMatchObject({ name: 'M', type: 'Point', state: { defined: true, value: '(2.5, 4)' } });
    expect(m?.free).toBeUndefined();
    expect(d?.state).toMatchObject({ defined: true, value: '5' });
  });

  it('gives a slider row for a ranged free number', () => {
    const s = new KernelSession();
    lines(s, 'a = 4 in 0..8 step 2');
    expect(s.rows()[0]?.control).toEqual({ kind: 'slider', min: 0, max: 8, step: 2, value: 4, text: '4' });
  });

  it('refuses a bad line with the unified error and changes nothing', () => {
    const s = new KernelSession();
    const r = s.submit('q = Midpoint(A, Bb)');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unknown_name');
    expect(s.rows()).toEqual([]);
  });

  it('follows the cause chain to the root and recovers when the root is redefined', () => {
    const s = new KernelSession();
    lines(s, 'g = 1/0', 'k = g + 1', 'm = k * 2');
    const m = s.rows().find((r) => r.name === 'm');
    expect(m?.state).toMatchObject({ defined: false, reason: 'input_undefined' });
    if (m && !m.state.defined) expect(m.state.cause.map((c) => [c.name, c.reason])).toEqual([['k', 'input_undefined'], ['g', 'division_by_zero']]);
    lines(s, 'g = 4');
    expect(s.rows().map((r) => r.state.defined)).toEqual([true, true, true]);
    expect(s.rows().find((r) => r.name === 'm')?.state).toMatchObject({ value: '10' });
  });

  it('reports a command reason from a rule (parallel lines)', () => {
    const s = new KernelSession();
    lines(s, 'A = (0, 0)', 'B = (1, 0)', 'C = (0, 1)', 'D = (1, 1)', 'l1 = Line(A, B)', 'l2 = Line(C, D)', 'I = Intersect(l1, l2)');
    expect(s.rows().find((r) => r.name === 'I')?.state).toMatchObject({ defined: false, reason: 'parallel' });
  });

  it('labels undo with the line and redo restores it', () => {
    const s = new KernelSession();
    expect(s.undoState()).toMatchObject({ canUndo: false, canRedo: false });
    lines(s, 'A = (1, 2)');
    expect(s.undoState()).toMatchObject({ canUndo: true, label: 'A = (1, 2)' });
    const u = s.undo();
    expect(u).toMatchObject({ ok: true, message: 'Undid: A = (1, 2)' });
    expect(s.rows()).toEqual([]);
    expect(s.undoState().canRedo).toBe(true);
    expect(s.redo().ok).toBe(true);
    expect(s.rows().map((r) => r.name)).toEqual(['A']);
    expect(s.undo().ok && s.undo().ok).toBe(false);
  });

  it('renames, and refuses a taken name with the object it clashes with', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'B = (3, 4)', 'M = Midpoint(A, B)');
    const bad = s.rename('B', 'A');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatchObject({ kind: 'name_taken', related: ['A'] });
    expect(s.rename('B', 'Q').ok).toBe(true);
    expect(s.rows().find((r) => r.name === 'M')?.source).toBe('M = Midpoint(A, Q)');
  });

  it('shows the delete plan, deletes with the cascade and undo brings it all back', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'B = (3, 4)', 'M = Midpoint(A, B)', 'N = Midpoint(A, M)');
    expect(s.deletePlan('A')).toEqual(['A', 'M', 'N']);
    expect(s.deletePlan('N')).toEqual(['N']);
    expect(s.delete('A')).toMatchObject({ ok: true, message: 'Deleted A, M, N' });
    expect(s.rows().map((r) => r.name)).toEqual(['B']);
    s.undo();
    expect(s.rows().map((r) => r.name)).toEqual(['A', 'B', 'M', 'N']);
  });

  it('writes a free value in place, and falls back to a line for other text', () => {
    const s = new KernelSession();
    lines(s, 'a = 2', 'P = (1, 1)', 'b = a * 2');
    expect(s.setText('a', '5').ok).toBe(true);
    expect(s.setText('P', '(3, -1)').ok).toBe(true);
    expect(s.rows().map((r) => r.state)).toMatchObject([{ value: '5' }, { value: '(3, -1)' }, { value: '10' }]);
    const bad = s.setText('a', '(1, 2)');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.kind).toBe('type_change');
    expect(s.setText('a', '1 +').ok).toBe(false);
  });

  it('makes a slider drag one undo step', () => {
    const s = new KernelSession();
    lines(s, 'a = 3 in 0..8 step 1', 'b = a * 2');
    s.slide('a', 4, false);
    s.slide('a', 5, false);
    s.slide('a', 6, true);
    expect(s.rows()[1]?.state).toMatchObject({ value: '12' });
    expect(s.undo().ok).toBe(true);
    expect(s.rows()[1]?.state).toMatchObject({ value: '6' });
  });

  it('refuses a write to a computed object', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'B = (3, 4)', 'M = Midpoint(A, B)');
    const r = s.slide('M', 1, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_free');
  });

  it('saves a script and loads it into a new figure; a script with no usable line keeps the figure', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'B = (3, 4)', 'M = Midpoint(A, B)');
    const text = s.save();
    expect(text).toContain('M = Midpoint(A, B)');
    const t = new KernelSession();
    lines(t, 'q = 1');
    const ok = t.load(text);
    expect(ok).toMatchObject({ applied: 4, total: 4, errors: [], replaced: true });
    expect(t.rows().map((r) => r.name)).toEqual(['A', 'B', 'M']);
    const part = t.load('A = (1, 2)\nM = Midpont(A, A)\nN = Midpoint(A, M)');
    expect(part.replaced).toBe(true);
    expect(part.errors.map((e) => e.kind)).toEqual(['unknown_command', 'unknown_name']);
    expect(part.applied).toBe(1);
    expect(part.total).toBe(3);
    const none = t.load('@fig 99\nA = 1');
    expect(none.replaced).toBe(false);
    expect(none.errors[0]?.kind).toBe('version');
    expect(t.rows().map((r) => r.name)).toEqual(['A']);
  });

  it('knows when the figure has a clock and moves it', () => {
    const s = new KernelSession();
    lines(s, 'f(x) = x^2', 'a = 2');
    expect(s.hasClock()).toBe(false);
    lines(s, 'w = a * t');
    expect(s.hasClock()).toBe(true);
    expect(s.setTime(1.5).ok).toBe(true);
    expect(s.time()).toBe(1.5);
    expect(s.rows().find((r) => r.name === 'w')?.state).toMatchObject({ value: '3' });
  });

  it('parses plain values by the type of the object', () => {
    expect(parseFree('Number', ' −2.5 ')).toBe(-2.5);
    expect(parseFree('Number', '2+3')).toBeUndefined();
    expect(parseFree('Point', '(1, -2)')).toEqual({ x: 1, y: -2 });
    expect(parseFree('Bool', 'true')).toBe(true);
    expect(parseFree('Text', '"a"')).toBeUndefined();
  });
});


describe('kernel session with every area', () => {
  it('keeps the full text of a free list, never the shortened preview', () => {
    const s = new KernelSession();
    lines(s, 'data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]');
    expect(s.rows()[0]?.source).toBe('data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]');
  });

  it('drags a free point as one undo step', () => {
    const s = new KernelSession();
    lines(s, 'A = (1, 2)', 'M = Midpoint(A, (3, 4))');
    expect(s.dragPoint('A', 5, 6, false).ok).toBe(true);
    expect(s.dragPoint('A', 5, 8, true).ok).toBe(true);
    expect(s.figure.value('M')).toEqual({ x: 4, y: 6 });
    s.undo();
    expect(s.figure.value('A')).toEqual({ x: 1, y: 2 });
  });

  it('runs statistics, probability and list commands', () => {
    const s = new KernelSession();
    lines(s, 'data = [4, 7, 8, 9]', 'h = Histogram(data)', 'd = Normal(0, 1)', 'p = Cdf(d, 1.96)', 'M = Matrix([[1, 2], [3, 4]])', 'det = Determinant(M)');
    expect(s.figure.value('det')).toBe(-2);
    expect(s.figure.value('p') as number).toBeCloseTo(0.975, 3);
  });
});
