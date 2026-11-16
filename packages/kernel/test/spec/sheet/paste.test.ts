/** Spreadsheet, kernel side, round 3: paste, copy, cut, import (.kiro/specs/spreadsheet R6; design 3.11, 3.12; errors 3). */
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry, Figure, PASTE_LIMITS, applyImport, applyPaste, applyPasteCells, copyText, detectSeparator, geometry, parseField, planImport, planPaste,
  registerFunctions, registerLists, registerNumbers, registerSheet, registerStatistics, splitDelimited,
} from '../../../src/index';
import type { ErrorObject, PastePlan } from '../../../src/index';

function fig(lines: readonly string[] = []): Figure {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerLists(r);
  registerStatistics(r);
  registerSheet(r);
  const f = new Figure({ commands: r });
  for (const l of lines) {
    const x = f.apply(l);
    if (!x.ok) throw new Error(`${l}: ${x.message}`);
  }
  return f;
}
const val = (f: Figure, n: string): unknown => f.value(n);
const plan = (p: PastePlan | ErrorObject): PastePlan => {
  if ('ok' in p) throw new Error(p.message);
  return p;
};
const error = (p: PastePlan | ErrorObject): ErrorObject => {
  if (!('ok' in p)) throw new Error('expected an error');
  return p;
};
const A1 = { col: 1, row: 1 };

describe('splitting text', () => {
  it('rows by newline, fields by the separator, quotes kept whole', () => {
    expect(splitDelimited('a,b\n1,2\r\n3,"4, 5"\n', ',')).toEqual([['a', 'b'], ['1', '2'], ['3', '4, 5']]);
    expect(splitDelimited('"say ""hi""",x', ',')).toEqual([['say "hi"', 'x']]);
    expect(splitDelimited('"two\nlines",x', ',')).toEqual([['two\nlines', 'x']]);
    expect(splitDelimited('\uFEFFa\tb', '\t')).toEqual([['a', 'b']]);
  });

  it('the separator of a file comes from its first line', () => {
    expect(detectSeparator('a\tb,c\n')).toBe('\t');
    expect(detectSeparator('a;b;c\n1,5;2,5;3')).toBe(';');
    expect(detectSeparator('a,b\n')).toBe(',');
  });

  it('a field is a number only when all of it is one', () => {
    expect(parseField(' 2.5 ', '.')).toEqual({ k: 'num', v: 2.5 });
    expect(parseField('2,5', ',')).toEqual({ k: 'num', v: 2.5 });
    expect(parseField('-1e3', '.')).toEqual({ k: 'num', v: -1000 });
    expect(parseField('2,5', '.')).toEqual({ k: 'text', v: '2,5', looked: true });
    expect(parseField('1,2,3', ',')).toEqual({ k: 'text', v: '1,2,3', looked: true });
    expect(parseField('12 cm', '.')).toEqual({ k: 'text', v: '12 cm' });
    expect(parseField('  ', '.')).toEqual({ k: 'empty' });
  });
});

describe('paste from outside (design 3.11)', () => {
  it('tab-separated text becomes free values, numbers and texts, as one step', () => {
    const f = fig(['@sheet 6 20']);
    const r = applyPaste(f, 'height\tweight\n150\t48\n155\t52.5\n', A1);
    expect(r.ok).toBe(true);
    expect([val(f, 'A1'), val(f, 'B1'), val(f, 'A2'), val(f, 'B3')]).toEqual(['height', 'weight', 150, 52.5]);
    expect(r.ok && r.plan.range).toBe('A1:B3');
    f.undo();
    expect(f.get('A1')).toBeUndefined();
  });

  it('comma-separated text when there is no tab; empty fields are left alone', () => {
    const f = fig(['@sheet 6 20', 'B1 = 9']);
    expect(applyPaste(f, '1,,3', A1).ok).toBe(true);
    expect([val(f, 'A1'), val(f, 'B1'), val(f, 'C1')]).toEqual([1, 9, 3]);
  });

  it('the decimal comma setting reads 2,5 as a number; 1,2,3 stays text with a warning', () => {
    const f = fig(['@sheet 6 20']);
    expect(applyPaste(f, '2,5\t1,2,3', A1, { decimal: ',' }).ok).toBe(true);
    expect(val(f, 'A1')).toBe(2.5);
    expect(val(f, 'B1')).toBe('1,2,3');
    const p = plan(planPaste(f, '1,2,3', { col: 1, row: 5 }, { decimal: ',' }));
    expect(p.lines).toEqual(['A5 = 1', 'B5 = 2', 'C5 = 3']);
    const q = plan(planPaste(f, 'x\t1,2,3', { col: 1, row: 6 }, { decimal: ',' }));
    expect(q.warnings.map((w) => w.message)).toEqual(["B6 looks like a number but is not one; it is stored as text."]);
  });

  it('a paste over a cell of another type replaces it', () => {
    const f = fig(['@sheet 6 20', 'A1 = "n"']);
    expect(applyPaste(f, '5', A1).ok).toBe(true);
    expect(val(f, 'A1')).toBe(5);
  });

  it('a paste past the sheet is cell_out_of_range and changes nothing', () => {
    const f = fig(['@sheet 2 2']);
    const e = error(planPaste(f, '1\t2\t3', A1));
    expect(e.kind).toBe('cell_out_of_range');
    expect(e.suggest).toEqual(['@sheet 3 2']);
    expect(applyPaste(f, '1\t2\t3', A1).ok).toBe(false);
    expect(f.count).toBe(0);
  });

  it('a paste over a locked cell is refused as a whole', () => {
    const f = fig(['@sheet 6 20', '@cell B1 locked']);
    const r = applyPaste(f, '1\t2', A1);
    expect(!r.ok && r.error.kind).toBe('cell_locked');
    expect(f.count).toBe(0);
  });

  it('more than 50,000 cells is limit', () => {
    const f = fig(['@sheet 26 9999']);
    const text = Array.from({ length: 2001 }, () => Array.from({ length: 26 }, () => '1').join('\t')).join('\n');
    const e = error(planPaste(f, text, A1));
    expect(e.kind).toBe('limit');
    expect(PASTE_LIMITS.cells).toBe(50_000);
  });

  it('binary data is import_format, naming the first bytes', () => {
    const f = fig(['@sheet 6 20']);
    const e = error(planPaste(f, 'PK\u0003\u0004\u0000\u0000', A1));
    expect(e.kind).toBe('import_format');
    expect(e.message).toBe('This is not text: the first bytes are 50 4b 03 04 00 00.');
  });
});

describe('import files (design 3.12)', () => {
  it('detects the separator, the decimal comma and the header row', () => {
    const f = fig(['@sheet 6 20']);
    const p = plan(planImport(f, '\uFEFFx;y\n1,5;2\n2,5;4\n', { at: A1 }));
    expect(p.header).toBe(true);
    expect(p.lines).toEqual(['A1 = "x"', 'B1 = "y"', 'A2 = 1.5', 'B2 = 2', 'A3 = 2.5', 'B3 = 4']);
  });

  it('a first row of numbers is not a header; header can be forced', () => {
    const f = fig(['@sheet 6 20']);
    expect(plan(planImport(f, '1,2\n3,4', { at: A1 })).header).toBe(false);
    expect(plan(planImport(f, '10,20\n3,4', { at: A1, header: true })).lines[0]).toBe('A1 = "10"');
  });

  it('filled targets without replace are import_conflict, listing the first few', () => {
    const f = fig(['@sheet 6 20', 'A1 = 1', 'B1 = 2']);
    const e = error(planImport(f, '5,6\n7,8', { at: A1 }));
    expect(e.kind).toBe('import_conflict');
    expect(e.message).toBe('The cells A1, B1 are already filled; nothing was imported.');
    expect(applyImport(f, '5,6\n7,8', { at: A1, replace: true }).ok).toBe(true);
    expect(val(f, 'B2')).toBe(8);
  });

  it('a file over 5 MB is limit', () => {
    const f = fig(['@sheet 6 20']);
    expect(error(planImport(f, 'x'.repeat(PASTE_LIMITS.fileBytes + 1), { at: A1 })).kind).toBe('limit');
  });

  it('then the data plots: PointsFrom of the imported block', () => {
    const f = fig(['@sheet 6 20']);
    expect(applyImport(f, 'h,w\n150,48\n155,52\n160,57', { at: A1 }).ok).toBe(true);
    expect(f.apply('pts = PointsFrom(A2:B4)').ok).toBe(true);
    expect(val(f, 'pts')).toEqual([{ x: 150, y: 48 }, { x: 155, y: 52 }, { x: 160, y: 57 }]);
  });
});

describe('copy and paste inside the figure', () => {
  it('copyText gives tab-separated values', () => {
    const f = fig(['@sheet 6 20', 'A1 = "n"', 'B1 = 2', 'A2 = 3', 'B2 = A2^2']);
    expect(copyText(f, { c0: 1, r0: 1, c1: 2, r1: 2 })).toBe('n\t2\n3\t9');
  });

  it('pasted definitions move their references by the offset', () => {
    const f = fig(['@sheet 6 20', 'A1 = 2', 'A2 = 3', 'B1 = A1 * 10 + $A$1']);
    const r = applyPasteCells(f, { rect: { c0: 2, r0: 1, c1: 2, r1: 1 }, cut: false }, { col: 2, row: 2 });
    expect(r.ok).toBe(true);
    expect(f.get('B2')?.definition).toBe('B2 = A2 * 10 + $A$1');
    expect(val(f, 'B2')).toBe(32);
  });

  it('values only, and transpose', () => {
    const f = fig(['@sheet 6 20', 'A1 = 1', 'B1 = A1 + 1', 'C1 = B1 + 1']);
    expect(applyPasteCells(f, { rect: { c0: 1, r0: 1, c1: 3, r1: 1 }, cut: false }, { col: 1, row: 3 }, { mode: 'values' }).ok).toBe(true);
    expect(f.get('C3')?.definition).toBe('C3 = 3');
    expect(applyPasteCells(f, { rect: { c0: 1, r0: 1, c1: 3, r1: 1 }, cut: false }, { col: 5, row: 1 }, { transpose: true }).ok).toBe(true);
    expect([val(f, 'E1'), val(f, 'E2'), val(f, 'E3')]).toEqual([1, 2, 3]);
  });

  it('cut moves the block in one step; what read the cut cells by name keeps reading the empty cells', () => {
    const f = fig(['@sheet 6 20', 'A1 = 4', 'A2 = A1 + 1', 'C1 = A1 * 2', 'S = Sum(A1:A2)']);
    const r = applyPasteCells(f, { rect: { c0: 1, r0: 1, c1: 1, r1: 2 }, cut: true }, { col: 4, row: 1 });
    expect(r.ok).toBe(true);
    expect(val(f, 'D1')).toBe(4);
    expect(f.get('D2')?.definition).toBe('D2 = D1 + 1');
    expect(val(f, 'D2')).toBe(5);
    expect(f.get('A2')).toBeUndefined();
    expect(f.get('C1')?.cell.defined).toBe(false);
    expect(val(f, 'S')).toBe(0);
    f.undo();
    expect(val(f, 'A2')).toBe(5);
    expect(f.get('D1')).toBeUndefined();
    expect(val(f, 'C1')).toBe(8);
  });
});
