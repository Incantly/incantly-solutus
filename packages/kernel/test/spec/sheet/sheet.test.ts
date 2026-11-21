/** Spreadsheet, kernel side, round 1 (.kiro/specs/spreadsheet R1, R2, R3.1, R3.2, R7; docs/features/spreadsheet). */
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry, Figure, cellName, columnLetters, columnNumber, geometry, parseCellName, registerFunctions, registerLists, registerNumbers, registerSheet,
  registerStatistics, shiftLine, shiftRefs, undefinedCode,
} from '../../../src/index';
import type { ErrorObject, TxResult } from '../../../src/index';
import { parseLine } from '../../../src/language/parser';
import { printExpr } from '../../../src/language/printer';

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

const fails = (f: Figure, line: string): ErrorObject => {
  const r: TxResult = f.apply(line);
  if (r.ok) throw new Error(`${line} should fail`);
  return r;
};
const val = (f: Figure, n: string): unknown => f.value(n);
const reason = (f: Figure, n: string): string | undefined => {
  const c = f.get(n)?.cell;
  return c && !c.defined ? c.reason : undefined;
};

describe('addresses', () => {
  it('columns A..ZZ and rows 1..9999', () => {
    expect(columnNumber('A')).toBe(1);
    expect(columnNumber('Z')).toBe(26);
    expect(columnNumber('AA')).toBe(27);
    expect(columnNumber('ZZ')).toBe(702);
    expect(columnLetters(28)).toBe('AB');
    expect(columnLetters(703)).toBeUndefined();
    expect(parseCellName('AB12')).toEqual({ col: 28, row: 12 });
    expect(parseCellName('A0')).toBeUndefined();
    expect(parseCellName('A10000')).toBeUndefined();
    expect(parseCellName('a1')).toBeUndefined();
    expect(cellName(3, 7)).toBe('C7');
  });
});

describe('cells and the sheet (R1)', () => {
  it('without @sheet, A1 is an ordinary name', () => {
    const f = fig(['A1 = (1, 2)', 'B2 = 3']);
    expect(val(f, 'A1')).toEqual({ x: 1, y: 2 });
  });

  it('a cell is an ordinary object named by its address', () => {
    const f = fig(['@sheet 4 12', 'A1 = 3', 'A2 = A1^2', 'B1 = (A1, A2)']);
    expect(val(f, 'A2')).toBe(9);
    expect(val(f, 'B1')).toEqual({ x: 3, y: 9 });
    f.setFree('A1', 4);
    f.flush();
    expect(val(f, 'A2')).toBe(16);
  });

  it('a cell outside the size is cell_out_of_range with the size and the line that fits', () => {
    const f = fig(['@sheet 26 100']);
    const e = fails(f, 'Z200 = 1');
    expect(e.kind).toBe('cell_out_of_range');
    expect(e.message).toBe('Cell Z200 is outside the sheet (26 columns by 100 rows).');
    expect(e.hint).toBe('Use @sheet 26 200 to make the sheet taller, or pick a row from 1 to 100.');
    expect(e.suggest).toContain('@sheet 26 200');
    expect(fails(fig(['@sheet 4 12']), 'E1 = 1').hint).toContain('pick a column from A to D');
  });

  it('@sheet takes two whole numbers in range', () => {
    const f = fig();
    expect(fails(f, '@sheet 703 10').kind).toBe('bad_directive');
    expect(fails(f, '@sheet 10 10000').kind).toBe('bad_directive');
    expect(fails(f, '@sheet 10').kind).toBe('bad_directive');
    expect(f.apply('@sheet 702 9999').ok).toBe(true);
  });

  it('a multi-name line whose name is a cell is reserved_name', () => {
    // a command with two results, as an area could give one
    const r = registry();
    r.register({ name: 'Two', kind: 'object', group: 'lists', forms: [{ params: [], returns: ['Number', 'Number'], summary: 'two numbers', rule: () => ({ run: () => [1, 2] }) }] });
    const f = new Figure({ commands: r });
    f.apply('@sheet 26 100');
    expect(f.apply('u1, u2 = Two()').ok).toBe(true);
    const e = fails(f, 'A1, B1 = Two()');
    expect(e.kind).toBe('reserved_name');
    expect(e.hint).toContain('P_A1');
  });

  it('a reference, a range or a sheet command without a sheet is no_sheet', () => {
    const f = fig(['A1 = 1', 'A2 = 2']);
    for (const l of ['x1 = $A$1 + 1', 's = Sum(A1:A2)', 'c = Cell(1, 1)', 'k = Column(A1)', 'l = ListFrom(A1:A2)']) {
      const e = fails(f, l);
      expect(e.kind, l).toBe('no_sheet');
      expect(e.hint).toBe('Add @sheet 26 100 first.');
    }
    // the statistics Column of a table is not a sheet command
    const g = fig(['tb = Table(["a"], [1, 2])']);
    expect(g.apply('k = Column(tb, "a")').ok).toBe(true);
  });
});

describe('references and ranges (R2)', () => {
  it('$ flags are kept and printed back', () => {
    const f = fig(['@sheet 4 12', 'A1 = 2', 'B1 = $A$1 * 2', 'B2 = A$1 + $A1']);
    expect(val(f, 'B1')).toBe(4);
    expect(f.get('B1')?.definition).toBe('B1 = $A$1 * 2');
    expect(f.get('B2')?.definition).toBe('B2 = A$1 + $A1');
    const again = Figure.fromScript(f.toScript(), { commands: registry() });
    expect(again.report.ok).toBe(true);
    expect(again.figure.toScript()).toBe(f.toScript());
  });

  it('bad references are bad_reference, naming the part', () => {
    const f = fig(['@sheet 4 12']);
    expect(fails(f, 'w = $A').message).toContain('needs a row number');
    expect(fails(f, 'w = $AAA1').message).toContain('past ZZ');
    expect(fails(f, 'w = A$0').message).toContain('rows start at 1');
    expect(fails(f, 'w = $A10000').message).toContain('past 9999');
    for (const l of ['w = $A', 'w = $1']) expect(fails(f, l).kind).toBe('bad_reference');
    const t = fails(f, '$A$1 = 2');
    expect(t.kind).toBe('bad_reference');
    expect(t.suggest).toContain('A1 = 2');
    // a lone $ is still not part of the language
    expect(fails(f, 'n = 3 $ 4').kind).toBe('bad_character');
  });

  it('A1: and A1:B are syntax errors saying what was expected', () => {
    const f = fig(['@sheet 4 12', 'A1 = 1']);
    const e = fails(f, 'y = Sum(A1:B)');
    expect(e.kind).toBe('syntax');
    expect(e.expected).toEqual(['a cell such as B3']);
    expect(fails(f, 'y = Sum(A1:)').kind).toBe('syntax');
  });

  it('a range is not an object, and not a value', () => {
    const f = fig(['@sheet 4 12', 'A1 = 1', 'A2 = 2']);
    const e = fails(f, 'r = A1:C5');
    expect(e.kind).toBe('range_not_object');
    expect(e.suggest).toEqual(['r = ListFrom(A1:C5)', 'r = MatrixFrom(A1:C5)']);
    expect(fails(f, 'r = CellRange(A1, B2)').kind).toBe('range_not_object');
    const m = fails(f, 'q = A1:B3 + 1');
    expect(m.kind).toBe('range_misplaced');
    expect(m.hint).toContain('Sum(A1:B3)');
    expect(fails(f, 'q = [A1:A2]').kind).toBe('range_misplaced');
  });

  it('a list parameter takes a range: one column is a list, empty cells left out', () => {
    const f = fig(['@sheet 4 12', 'A1 = 1', 'A2 = 2', 'A4 = 4', 'S = Sum(A1:A8)', 'M = Mean(A1:A8)', 'N = Count(ListFrom(A1:A8))']);
    expect(val(f, 'S')).toBe(7);
    expect(val(f, 'M')).toBeCloseTo(7 / 3);
    expect(val(f, 'N')).toBe(3);
    expect(f.get('S')?.type).toBe('Number');
  });

  it('a 2D range in a list parameter is a list of rows', () => {
    const f = fig(['@sheet 4 12', 'A1 = 1', 'B1 = 2', 'A2 = 3', 'B2 = 4', 'l = ListFrom(A1:B2)']);
    expect((val(f, 'l') as ArrayLike<number>[]).map((r) => Array.from(r))).toEqual([[1, 2], [3, 4]]);
    expect(f.get('l')?.typeText).toBe('List<List>');
  });

  it('mixed cells keep the numbers, with a notice', () => {
    const f = fig(['@sheet 4 12', 'A1 = "n"', 'A2 = 2', 'A3 = 5']);
    const r = f.apply('S = Sum(A1:A3)');
    expect(r.ok && val(f, 'S')).toBe(7);
    expect(r.ok && r.notices.map((n) => n.kind)).toContain('skipped_non_numeric');
    expect(r.ok && r.notices.find((n) => n.kind === 'skipped_non_numeric')?.message).toBe('A1:A3: left out 1 non-number cells.');
  });

  it('a cell typed later inside a range is picked up, in the same undo step', () => {
    const f = fig(['@sheet 4 12', 'A1 = 1', 'A2 = 2', 'S = Sum(A1:A10)']);
    expect(val(f, 'S')).toBe(3);
    expect(f.apply('A7 = 10').ok).toBe(true);
    expect(val(f, 'S')).toBe(13);
    f.setFree('A7', 20);
    f.flush();
    expect(val(f, 'S')).toBe(23);
    f.undo();
    expect(f.get('A7')?.cell).toEqual({ defined: true, value: 10 });
    f.undo();
    expect(f.get('A7')).toBeUndefined();
    expect(val(f, 'S')).toBe(3);
    f.redo();
    expect(val(f, 'S')).toBe(13);
    // the script reads back the same
    const again = Figure.fromScript(f.toScript(), { commands: registry() });
    expect(again.report.ok).toBe(true);
    expect(again.figure.value('S')).toBe(13);
  });

  it('a range that holds its own cell is a cycle', () => {
    const f = fig(['@sheet 4 12', 'A2 = 1']);
    const e = fails(f, 'A1 = Sum(A1:A5)');
    expect(e.kind).toBe('cycle');
    expect(e.path).toEqual(['A1', 'A1:A5', 'A1']);
  });

  it('with a sheet, cells named like commands (Q1, Q3) are cells; the commands still work', () => {
    const f = fig(['xs = [1, 2, 3, 4, 5]']);
    expect(fails(f, 'Q1 = 2').kind).toBe('reserved_name');
    f.apply('@sheet 26 10');
    expect(f.apply('Q1 = 2').ok).toBe(true);
    expect(f.apply('q = Q1(xs)').ok).toBe(true);
    expect(val(f, 'q')).toBe(1.5);
    expect(f.apply('w = Q1 + 1').ok && val(f, 'w')).toBe(3);
  });

  it('names that look like cells are not cells inside other names', () => {
    const f = fig(['@sheet 4 12', 'pA1 = 1', 'A_1 = 2', 'A1 = pA1 + A_1']);
    expect(val(f, 'A1')).toBe(3);
  });
});

describe('read commands (R3.1, R3.2)', () => {
  const base = ['@sheet 6 20', 'A1 = 1', 'A2 = 2', 'A3 = 3', 'B1 = 2', 'B2 = 4', 'B3 = 6'];

  it('Cell reads by numbers, live; a slider index follows', () => {
    const f = fig([...base, 'c = Cell(2, 3)', 'k = 1 in 1..3', 'd = Cell(1, k)']);
    expect(val(f, 'c')).toBe(6);
    expect(val(f, 'd')).toBe(1);
    f.setFree('k', 3);
    f.flush();
    expect(val(f, 'd')).toBe(3);
    f.setFree('A3', 30);
    f.flush();
    expect(val(f, 'd')).toBe(30);
    expect(f.apply('ce = Cell(5, 5)').ok).toBe(true);
    expect(reason(f, 'ce')).toBe('empty_cell');
    f.apply('C1 = "x"');
    f.apply('g = Cell(3, 1)');
    expect(reason(f, 'g')).toBe('not_numeric');
  });

  it('Column, Row and ColumnName give a cell address, filled or not', () => {
    const f = fig(['@sheet 30 20', 'c = Column(AB7)', 'r = Row(AB7)', 'n = ColumnName(AB7)']);
    expect(val(f, 'c')).toBe(28);
    expect(val(f, 'r')).toBe(7);
    expect(val(f, 'n')).toBe('AB');
  });

  it('CellRange(A1, B3) is the range A1:B3', () => {
    const f = fig([...base, 'l = ListFrom(CellRange(A1, A3))', 's = Sum(CellRange(B1, B3))']);
    expect(Array.from(val(f, 'l') as ArrayLike<number>)).toEqual([1, 2, 3]);
    expect(val(f, 's')).toBe(12);
  });

  it('PointsFrom takes two columns, one point per row; other shapes are bad_shape', () => {
    const f = fig([...base, 'p = PointsFrom(A1:B3)']);
    expect(val(f, 'p')).toEqual([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }]);
    expect(f.get('p')?.typeText).toBe('List<Point>');
    const e = fails(f, 'q = PointsFrom(A1:C10)');
    expect(e.kind).toBe('bad_shape');
    expect(e.message).toBe('PointsFrom needs 2 columns; A1:C10 has 3.');
    expect(e.expected).toEqual(['a range with 2 columns, e.g. A1:B10']);
    expect(e.forms).toEqual(['PointsFrom(Range)']);
  });

  it('PolylineFrom joins the points in order', () => {
    const f = fig([...base, 'p = PolylineFrom(A1:B3)']);
    expect(f.get('p')?.type).toBe('Polyline');
    expect((val(f, 'p') as { pts: unknown[] }).pts).toHaveLength(3);
  });

  it('MatrixFrom needs every cell; a hole is empty_cell', () => {
    const f = fig([...base, 'm = MatrixFrom(A1:B3)', 'h = MatrixFrom(A1:B4)']);
    expect(val(f, 'm')).toMatchObject({ kind: 'matrix', rows: 3, cols: 2 });
    expect(Array.from((val(f, 'm') as { data: Float64Array }).data)).toEqual([1, 2, 2, 4, 3, 6]);
    expect(reason(f, 'h')).toBe('empty_cell');
    expect(fails(f, 'mz = MatrixFrom(E1:F3)').kind).toBe('bad_shape');
  });

  it('TableFrom uses a first row of texts as titles', () => {
    const f = fig(['@sheet 4 12', 'A1 = "n"', 'B1 = "n squared"', 'A2 = 1', 'B2 = 1', 'A3 = 2', 'B3 = 4', 'tb = TableFrom(A1:B3)']);
    const t = val(f, 'tb') as { fields: { titles: string[]; rows: number; columns: Float64Array[] } };
    expect(t.fields.titles).toEqual(['n', 'n squared']);
    expect(t.fields.rows).toBe(2);
    expect(Array.from(t.fields.columns[1] as Float64Array)).toEqual([1, 4]);
  });

  it('OperationTable: a function of x and y over the first row and column', () => {
    const f = fig(['@sheet 6 6', 'A1(x, y) = x * y', 'B1 = 1', 'C1 = 2', 'D1 = 3', 'A2 = 1', 'A3 = 2', 'ot = OperationTable(A1:D3)']);
    const t = val(f, 'ot') as { fields: { titles: string[]; columns: Float64Array[] } };
    expect(t.fields.titles).toEqual(['y \\ x', '1', '2', '3']);
    expect(t.fields.columns.map((c) => Array.from(c))).toEqual([[1, 2], [1, 2], [2, 4], [3, 6]]);
    expect(fails(f, 'o2 = OperationTable(A1:A3)').kind).toBe('bad_shape');
  });
});

describe('shiftRefs on the tree (R4)', () => {
  const expr = (line: string) => {
    const p = parseLine(line, {});
    if (!p.ok || p.value.node.k !== 'define') throw new Error(line);
    return p.value.node.expr;
  };

  it('moves relative parts and keeps absolute ones', () => {
    const r = shiftRefs(expr('B2 = A2^2 + $A$1 + A$1 + $A1 + Sum(A1:A2) + p1 + P_1'), 1, 2);
    expect(r.ok && printExpr(r.tree)).toBe('B4^2 + $A$1 + B$1 + $A3 + Sum(B3:B4) + p1 + P_1');
  });

  it('a reference that leaves the grid is off_sheet', () => {
    const r = shiftRefs(expr('B1 = A1 + 1'), -1, 0);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.ref).toEqual({ col: 0, row: 1, colAbs: false, rowAbs: false });
    expect(shiftRefs(expr('B1 = A1 + 1'), 0, 5, { cols: 4, rows: 5 }).ok).toBe(false);
  });

  it('shiftLine copies a definition to another cell', () => {
    expect(shiftLine('B2 = A2^2', 'B2', 'B3')).toEqual({ ok: true, line: 'B3 = A3^2' });
    expect(shiftLine('B2 = 5', 'B2', 'C9')).toEqual({ ok: true, line: 'C9 = 5' });
  });
});

describe('undefined codes (R7)', () => {
  it('short codes per reason', () => {
    expect(undefinedCode('off_sheet')).toBe('#OFF');
    expect(undefinedCode('deleted_cell')).toBe('#DEL');
    expect(undefinedCode('empty_cell')).toBe('#EMPTY');
    expect(undefinedCode('not_numeric')).toBe('#NUM');
    expect(undefinedCode('division_by_zero')).toBe('#DIV');
    expect(undefinedCode('input_undefined')).toBe('#UP');
    expect(undefinedCode('parallel')).toBe('#N/A');
  });

  it('a division by zero in a cell is undefined, and its readers too', () => {
    const f = fig(['@sheet 4 4', 'A1 = 0', 'A2 = 1 / A1', 'A3 = A2 + 1']);
    expect(reason(f, 'A2')).toBe('division_by_zero');
    expect(undefinedCode(reason(f, 'A3'))).toBe('#UP');
  });
});
