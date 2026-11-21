/** Spreadsheet, kernel side, round 2: fills, clears, locks (.kiro/specs/spreadsheet R3.3 to R3.5, R4, R5). */
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry, Figure, applyFill, cellMarks, geometry, planFill, registerFunctions, registerLists, registerNumbers, registerSheet, registerStatistics,
  setSheetLocks,
} from '../../../src/index';
import type { ErrorObject, TxResult } from '../../../src/index';

function registry(): CommandRegistry {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerLists(r);
  registerStatistics(r);
  registerSheet(r);
  return r;
}

function fig(lines: readonly string[] = []): Figure {
  const f = new Figure({ commands: registry() });
  for (const l of lines) {
    const x = f.apply(l);
    if (!x.ok) throw new Error(`${l}: ${x.message}`);
  }
  return f;
}

const ok = (r: TxResult): TxResult & { ok: true } => {
  if (!r.ok) throw new Error(r.message);
  return r;
};
const fails = (f: Figure, line: string, origin?: 'learner' | 'model'): ErrorObject => {
  const r = f.apply(line, origin ? { origin } : {});
  if (r.ok) throw new Error(`${line} should fail`);
  return r;
};
const val = (f: Figure, n: string): unknown => f.value(n);
const def = (f: Figure, n: string): string | undefined => f.get(n)?.definition;
const cells = (f: Figure): string[] => f.objects().map((o) => o.name).filter((n) => /^[A-Z]{1,2}\d+$/.test(n));

describe('free values: FillColumn, FillRow, FillCells (R3.3)', () => {
  it('FillColumn writes rows 1.. of a column, replacing what was there', () => {
    const f = fig(['@sheet 4 12', 'B2 = 99']);
    const r = ok(f.apply('FillColumn(2, [5, 6, 7])'));
    expect([val(f, 'B1'), val(f, 'B2'), val(f, 'B3')]).toEqual([5, 6, 7]);
    expect(r.data).toMatchObject({ action: 'FillColumn', written: 3, range: 'B1:B3', sample: ['B1 = 5', 'B2 = 6', 'B3 = 7'] });
    expect(f.get('B2')?.free).toBe(true);
  });

  it('FillRow writes across a row; texts and points too', () => {
    const f = fig(['@sheet 4 12']);
    ok(f.apply('FillRow(3, ["a", "b"])'));
    expect([val(f, 'A3'), val(f, 'B3')]).toEqual(['a', 'b']);
    ok(f.apply('FillRow(4, [(1, 2), (3, 4)])'));
    expect(val(f, 'B4')).toEqual({ x: 3, y: 4 });
  });

  it('FillCells: a list down a column, a list of lists or a matrix across rows', () => {
    const f = fig(['@sheet 4 12']);
    ok(f.apply('FillCells(A2, Seq(k, k, 1, 8))'));
    expect(val(f, 'A9')).toBe(8);
    ok(f.apply('FillCells(B1, [[150, 48], [155, 52], [160, 57]])'));
    expect([val(f, 'B3'), val(f, 'C3')]).toEqual([160, 57]);
    ok(f.apply('m = Matrix([[1, 2], [3, 4]])'));
    ok(f.apply('FillCells(C10, m)'));
    expect(val(f, 'D11')).toBe(4);
  });

  it('a cell of another type is replaced, as the UI clears then retypes', () => {
    const f = fig(['@sheet 4 12', 'A1 = "header"']);
    ok(f.apply('FillColumn(1, [1, 2])'));
    expect(val(f, 'A1')).toBe(1);
    expect(f.get('A1')?.type).toBe('Number');
  });

  it('a fill past the sheet is cell_out_of_range and changes nothing', () => {
    const f = fig(['@sheet 4 12']);
    const e = fails(f, 'FillRow(1, [1, 2, 3, 4, 5])');
    expect(e.kind).toBe('cell_out_of_range');
    expect(e.suggest).toEqual(['@sheet 5 12']);
    expect(cells(f)).toEqual([]);
  });

  it('a fill is one undo step', () => {
    const f = fig(['@sheet 4 12', 'A1 = 0']);
    ok(f.apply('FillColumn(1, [1, 2, 3, 4])'));
    expect(cells(f)).toHaveLength(4);
    f.undo();
    expect(cells(f)).toEqual(['A1']);
    expect(val(f, 'A1')).toBe(0);
    f.redo();
    expect(val(f, 'A4')).toBe(4);
  });

  it('wrong arguments are the standard errors', () => {
    const f = fig(['@sheet 4 12']);
    expect(fails(f, 'FillColumn(2)').kind).toBe('arg_count');
    expect(fails(f, 'FillColumn(1, 5)').kind).toBe('no_matching_form');
    ok(f.apply('xs = [4, 5]'));
    ok(f.apply('FillColumn(1, xs)'));
    expect(val(f, 'A2')).toBe(5);
  });
});

describe('FillDown and FillRight: definitions with shifted references (R3.4)', () => {
  it('the table of squares of agent.md 2', () => {
    const f = fig(['@sheet 4 12', 'A1 = "x"', 'B1 = "x squared"', 'FillCells(A2, Seq(k, k, 1, 8))', 'B2 = A2^2']);
    const r = ok(f.apply('FillDown(B2:B9)'));
    expect(r.data).toMatchObject({ action: 'FillDown', written: 7, range: 'B3:B9', sample: ['B3 = A3^2', '…', 'B9 = A9^2'], undefined: [] });
    expect(def(f, 'B9')).toBe('B9 = A9^2');
    expect(val(f, 'B9')).toBe(64);
    ok(f.apply('pts = PointsFrom(A2:B9)'));
    expect((val(f, 'pts') as unknown[]).length).toBe(8);
    // live: change an input, the column follows
    f.setFree('A5', 10);
    f.flush();
    expect(val(f, 'B5')).toBe(100);
  });

  it('absolute parts stay', () => {
    const f = fig(['@sheet 6 12', 'A1 = 2', 'B1 = 1', 'B2 = 2', 'B3 = 3', 'C1 = B1 * $A$1', 'FillDown(C1:C3)']);
    expect(def(f, 'C3')).toBe('C3 = B3 * $A$1');
    expect(val(f, 'C3')).toBe(6);
    ok(f.apply('D1 = C1 + A$1'));
    ok(f.apply('FillRight(D1:F1)'));
    expect(def(f, 'F1')).toBe('F1 = E1 + C$1');
  });

  it('a reference that leaves the sheet makes the cell undefined with off_sheet', () => {
    const g = fig(['@sheet 3 3', 'A1 = 1', 'B1 = 5', 'C1 = 7', 'A3 = C1 + 1']);
    const r = ok(g.apply('FillRight(A3:C3)'));
    expect(r.data).toMatchObject({ undefined: ['B3', 'C3'] });
    expect(g.get('B3')?.cell).toMatchObject({ defined: false, reason: 'off_sheet' });
    expect(r.notices.map((n) => n.kind)).toContain('off_sheet_cells');
  });

  it('a copy that would read an empty cell is left as it was, with a notice', () => {
    const f = fig(['@sheet 4 12', 'A1 = 1', 'A2 = 2', 'B1 = A1 * 10']);
    const r = ok(f.apply('FillDown(B1:B5)'));
    expect(def(f, 'B2')).toBe('B2 = A2 * 10');
    expect(f.get('B3')).toBeUndefined();
    expect(r.notices.find((n) => n.kind === 'fill_skipped')?.message).toBe('3 cells were left as they were, from B3: A3 is empty.');
  });

  it('a fill that fails is batch_failed and changes nothing', () => {
    // C2 = A2.x cannot type: A2 is a number
    const f = fig(['@sheet 4 12', 'A1 = (1, 2)', 'A2 = 3', 'C1 = A1.x']);
    const before = f.toScript();
    const e = fails(f, 'FillDown(C1:C2)');
    expect(e.kind).toBe('batch_failed');
    expect(e.message).toBe('Nothing was filled: line 1 of 1 failed.');
    expect(e.cause?.kind).toBeDefined();
    expect(f.toScript()).toBe(before);
  });
});

describe('a failed fill inside a line', () => {
  it('takes itself back once; the figure and the undo history are as before', () => {
    const f = fig(['@sheet 4 12', 'A1 = (1, 2)', 'A2 = 3', 'C1 = A1.x', 'k = 1']);
    const before = f.toScript();
    const depth = f.undoInfo().depth;
    expect(f.apply('FillDown(C1:C2)').ok).toBe(false);
    expect(f.toScript()).toBe(before);
    expect(f.undoInfo().depth).toBe(depth);
    f.undo();
    expect(f.get('k')).toBeUndefined();
    expect(val(f, 'C1')).toBe(1);
  });
});

describe('planFill: series detection (design 3.9)', () => {
  it('two numbers with a common step continue the series, without drift', () => {
    const f = fig(['@sheet 2 200', 'A1 = 0.1', 'A2 = 0.2']);
    const p = planFill(f, { c0: 1, r0: 1, c1: 1, r1: 2 }, { c0: 1, r0: 3, c1: 1, r1: 101 }, 'down');
    expect(p.lines[0]).toBe('A3 = 0.30000000000000004');
    expect(p.lines[p.lines.length - 1]).toBe(`A101 = ${0.1 + 0.1 * 100}`);
    const g = fig(['@sheet 2 20', 'A1 = 1', 'A2 = 3']);
    expect(planFill(g, { c0: 1, r0: 1, c1: 1, r1: 2 }, { c0: 1, r0: 3, c1: 1, r1: 5 }, 'down').lines).toEqual(['A3 = 5', 'A4 = 7', 'A5 = 9']);
  });

  it('one number is copied, not counted on', () => {
    const f = fig(['@sheet 2 20', 'A1 = 4']);
    expect(planFill(f, { c0: 1, r0: 1, c1: 1, r1: 1 }, { c0: 1, r0: 2, c1: 1, r1: 3 }, 'down').lines).toEqual(['A2 = 4', 'A3 = 4']);
  });

  it('numbers without a common step repeat', () => {
    const f = fig(['@sheet 2 20', 'A1 = 1', 'A2 = 5', 'A3 = 6']);
    expect(planFill(f, { c0: 1, r0: 1, c1: 1, r1: 3 }, { c0: 1, r0: 4, c1: 1, r1: 7 }, 'down').lines).toEqual(['A4 = 1', 'A5 = 5', 'A6 = 6', 'A7 = 1']);
  });

  it('texts ending in a number count on with the prefix', () => {
    const f = fig(['@sheet 2 20', 'A1 = "Week 1"', 'B1 = "Q08"', 'B2 = "Q10"']);
    expect(planFill(f, { c0: 1, r0: 1, c1: 1, r1: 1 }, { c0: 1, r0: 2, c1: 1, r1: 3 }, 'down').lines).toEqual(['A2 = "Week 2"', 'A3 = "Week 3"']);
    expect(planFill(f, { c0: 2, r0: 1, c1: 2, r1: 2 }, { c0: 2, r0: 3, c1: 2, r1: 3 }, 'down').lines).toEqual(['B3 = "Q12"']);
  });

  it('up and left extrapolate backwards', () => {
    const f = fig(['@sheet 6 20', 'A5 = 10', 'A6 = 20', 'D1 = 3', 'E1 = 4']);
    expect(planFill(f, { c0: 1, r0: 5, c1: 1, r1: 6 }, { c0: 1, r0: 3, c1: 1, r1: 4 }, 'up').lines).toEqual(['A4 = 0', 'A3 = -10']);
    expect(planFill(f, { c0: 4, r0: 1, c1: 5, r1: 1 }, { c0: 1, r0: 1, c1: 3, r1: 1 }, 'left').lines).toEqual(['C1 = 2', 'B1 = 1', 'A1 = 0']);
  });

  it('applyFill applies a plan as one step', () => {
    const f = fig(['@sheet 2 20', 'A1 = 1', 'A2 = 2']);
    const r = applyFill(f, { c0: 1, r0: 1, c1: 1, r1: 2 }, { c0: 1, r0: 3, c1: 1, r1: 10 }, 'down');
    expect(r.ok).toBe(true);
    expect(val(f, 'A10')).toBe(10);
    f.undo();
    expect(f.get('A3')).toBeUndefined();
  });
});

describe('ClearCells (R3.4)', () => {
  it('deletes the cells; what reads them through a range stays', () => {
    const f = fig(['@sheet 4 12', 'FillColumn(1, [1, 2, 3, 4])', 'S = Sum(A1:A4)', 'p = ListFrom(A1:A4)']);
    const r = ok(f.apply('ClearCells(A3:A4)'));
    expect(r.data).toMatchObject({ action: 'ClearCells', written: 2, range: 'A3:A4' });
    expect(f.get('A3')).toBeUndefined();
    expect(val(f, 'S')).toBe(3);
    expect(Array.from(val(f, 'p') as Float64Array)).toEqual([1, 2]);
    // a cell typed again comes back into the range
    ok(f.apply('A4 = 10'));
    expect(val(f, 'S')).toBe(13);
    f.undo();
    f.undo();
    expect(val(f, 'S')).toBe(10);
    expect(val(f, 'A3')).toBe(3);
  });

  it('a cell another object reads by name becomes empty, and that object stays', () => {
    const f = fig(['@sheet 4 12', 'A1 = 2', 'B1 = A1 * 3', 'S = Sum(A1:A2)']);
    ok(f.apply('ClearCells(A1)'));
    expect(f.get('B1')?.cell).toMatchObject({ defined: false });
    expect(val(f, 'S')).toBe(0);
    ok(f.apply('A1 = 5'));
    expect(val(f, 'B1')).toBe(15);
    expect(val(f, 'S')).toBe(5);
  });

  it('cells that read each other inside the cleared block go together', () => {
    const f = fig(['@sheet 4 12', 'A1 = 1', 'B1 = A1 + 1', 'C1 = B1 + 1']);
    ok(f.apply('ClearCells(A1:C1)'));
    expect(cells(f)).toEqual([]);
  });
});

describe('locked and input cells (R5)', () => {
  it('@cell marks cells; the last line wins', () => {
    const f = fig(['@sheet 4 12', '@cell B2 locked', '@cell C3 input', '@cell D4 locked', '@cell D4 none']);
    expect(cellMarks(f)).toEqual(new Map([['B2', { locked: true, input: false }], ['C3', { locked: false, input: true }]]));
  });

  it('a learner cannot edit a locked cell; a fill that touches one changes nothing', () => {
    const f = fig(['@sheet 4 12', 'B2 = 1', '@cell B2 locked', '@cell B3 input']);
    const e = fails(f, 'B2 = 5', 'learner');
    expect(e.kind).toBe('cell_locked');
    expect(e.message).toBe('The cell B2 is locked; nothing was applied.');
    expect(f.apply('B3 = 5', { origin: 'learner' }).ok).toBe(true);
    const before = f.toScript();
    expect(fails(f, 'FillColumn(2, [7, 8, 9])', 'learner').kind).toBe('cell_locked');
    expect(fails(f, 'ClearCells(B1:B4)', 'model').kind).toBe('cell_locked');
    expect(f.toScript()).toBe(before);
    // the host, and a teacher's session with locks off, may
    expect(f.apply('B2 = 6').ok).toBe(true);
    setSheetLocks(f, false);
    expect(f.apply('B2 = 7', { origin: 'learner' }).ok).toBe(true);
  });

  it('the message lists up to 5 locked cells', () => {
    const f = fig(['@sheet 4 12', ...[1, 2, 3, 4, 5, 6, 7].map((r) => `@cell A${r} locked`)]);
    expect(fails(f, 'FillColumn(1, [1, 2, 3, 4, 5, 6, 7])', 'learner').message).toBe('The cells A1, A2, A3, A4, A5 and 2 more are locked; nothing was applied.');
  });
});
