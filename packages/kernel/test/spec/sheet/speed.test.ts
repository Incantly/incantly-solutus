/** Spreadsheet, round 6: the faster fill path gives the same lines as the slow one (.kiro/specs/spreadsheet task 6). */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, planFill, registerFunctions, registerLists, registerNumbers, registerSheet, registerStatistics } from '../../../src/index';
import { numberLine } from '../../../src/commands/sheet/actions';
import { shiftParsed } from '../../../src/commands/sheet/shift';
import { parseLine } from '../../../src/language/parser';
import { normalise } from '../../../src/language/source';
import type { ParsedLine } from '../../../src/index';

function fig(lines: readonly string[] = []): Figure {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerLists(r);
  registerStatistics(r);
  registerSheet(r);
  const f = new Figure({ commands: r, limits: { objects: 30_000, lines: 30_000 } });
  for (const l of lines) {
    const x = f.apply(l);
    if (!x.ok) throw new Error(`${l}: ${x.message}`);
  }
  return f;
}

const parsed = (text: string): ParsedLine => {
  const p = parseLine(text, {});
  if (!p.ok) throw new Error(text);
  return p.value;
};

/** The tree without the source map, for comparing. */
const tree = (p: ParsedLine): unknown => JSON.parse(JSON.stringify(p.node));

describe('a line shifted on its tree is what parsing its text gives', () => {
  const cases: readonly [string, string, string][] = [
    ['B2 = A2^2', 'B2', 'B10'],
    ['C1 = $A$1 * B1 + A$1 - $A1', 'C1', 'D12'],
    ['B3 = Sum(A1:A3) + Mean(CellRange(A1, A3))', 'B3', 'C4'],
    ['Z9 = if(A9 > 0, "pos {A9}", "neg")', 'Z9', 'Z10'],
    ['B1(x, y) = x * A1 + y', 'B1', 'B2'],
    ['AA100 = (A100, B100) + (1, 2)', 'AA100', 'AB1'],
  ];
  it.each(cases)('%s moved from %s to %s', (line, from, to) => {
    const r = shiftParsed(parsed(line), from, to, { cols: 702, rows: 9999 });
    if (!r.ok) throw new Error(r.reason);
    const again = parsed(r.line.source);
    expect(tree(r.line)).toEqual(tree(again));
    expect(r.line.sm.text).toBe(again.sm.text);
  });

  it('a relative reference leaving the grid is off_sheet', () => {
    expect(shiftParsed(parsed('B1 = A1 + 1'), 'B1', 'A1', { cols: 702, rows: 9999 })).toEqual({ ok: false, reason: 'off_sheet' });
  });

  it('collects the cells it reads by name, not those inside a range', () => {
    const reads: string[] = [];
    shiftParsed(parsed('B2 = A2 + Sum(A1:A2)'), 'B2', 'B3', { cols: 702, rows: 9999 }, reads);
    expect(reads).toEqual(['A3']);
  });
});

describe('number lines made without parsing', () => {
  it.each(['5', '12.25', '0', '1000000'])('A1 = %s', (v) => {
    const p = numberLine('A1', v) as ParsedLine;
    expect(tree(p)).toEqual(tree(parsed(`A1 = ${v}`)));
  });

  it('other texts are left to the parser', () => {
    for (const v of ['-5', '1e21', 'inf']) expect(numberLine('A1', v)).toBeUndefined();
  });
});

describe('normalise: printable ASCII is left as it is', () => {
  it('the same text and map as the full pass', () => {
    const t = 'a = "x # {b}" # note\nc = #ff0000';
    const n = normalise(t);
    expect(n.text).toBe(t);
    expect(Array.from(n.start)).toEqual([...t].map((_, i) => i));
    expect(Array.from(n.end)).toEqual([...t].map((_, i) => i + 1));
    expect(normalise('a = 2 × 3').text).toBe('a = 2 * 3');
    expect(normalise('a\t= 1').text).toBe('a = 1');
  });
});

describe('the fast fill gives the same figure', () => {
  it('as typing every line, with one undo step', () => {
    const f = fig(['@sheet 6 200', 'FillCells(A1, Seq(k, k, 1, 150))', 'B1 = A1^2 + $A$1', 'C1 = B1 - A1']);
    expect(f.apply('FillDown(B1:C150)').ok).toBe(true);
    const typed = fig(['@sheet 6 200', 'FillCells(A1, Seq(k, k, 1, 150))', 'B1 = A1^2 + $A$1', 'C1 = B1 - A1']);
    // a fill writes column by column
    for (let r = 2; r <= 150; r++) typed.apply(`B${r} = A${r}^2 + $A$1`);
    for (let r = 2; r <= 150; r++) typed.apply(`C${r} = B${r} - A${r}`);
    expect(f.toScript()).toBe(typed.toScript());
    expect(f.value('C150')).toBe(150 * 150 + 1 - 150);
    f.undo();
    expect(f.has('B2')).toBe(false);
    expect(f.has('B1')).toBe(true);
  });

  it('a later formula sees earlier cells of the same fill', () => {
    const f = fig(['@sheet 2 50', 'A1 = 1', 'A2 = A1 + 1']);
    expect(f.apply('FillDown(A2:A50)').ok).toBe(true);
    expect(f.value('A50')).toBe(50);
    f.setFree('A1', 10);
    f.flush();
    expect(f.value('A50')).toBe(59);
  });

  it('a failed batch takes 5,000 new cells back quickly', () => {
    const f = fig(['@sheet 26 9999', 'FillCells(A1, Seq(k, k, 1, 5000))', 'B1 = A1 * 2']);
    const plan = planFill(f, { c0: 2, r0: 1, c1: 2, r1: 1 }, { c0: 2, r0: 2, c1: 2, r1: 5000 }, 'down');
    const bad = [...(plan.inputs ?? plan.lines), 'C1 = nope + 1'];
    const t = performance.now();
    const r = f.applyBatch(bad, { group: 'g', mode: 'atomic', generated: true });
    expect(r.ok).toBe(false);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(f.has('B2')).toBe(false);
    expect(f.count).toBe(5001);
  });
});
