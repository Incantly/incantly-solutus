/**
 * The spreadsheet area, kernel side (docs/features/spreadsheet; .kiro/specs/spreadsheet). Cells are ordinary objects named
 * by their address; this module adds the `@sheet` checks, the commands of design 3.8 in group `sheet`, the undefined
 * reasons, and the hook that lets a range see a cell typed after it.
 *
 * Plug in with `registerSheet(registry)`.
 */
import type { ErrorObject } from '../../contracts/errors';
import { err } from '../../errors/table';
import { registerNotice } from '../../errors/notices';
import { registerReasonPhrase } from '../../errors/phrases';
import type { Figure } from '../../graph/figure';
import type { CommandRegistry, LineCheckContext, RuleCall } from '../../graph/registry';
import { registerAfterLine, registerLineCheck } from '../../graph/registry';
import type { Expr, ParsedLine } from '../../language/ast';
import type { CheckedLine } from '../../language/check';
import {
  MAX_SHEET_COLS,
  MAX_SHEET_ROWS,
  WHOLE_SHEET,
  cellName,
  columnLetters,
  isRangeValue,
  parseCellName,
  rectCols,
  rectHas,
  rectOf,
  rectRows,
  rectText,
} from '../../language/cells';
import type { CellRect, CellRef, RangeValue } from '../../language/cells';
import type { CommandSpec, ParamSpec } from '../../language/table';
import type { TNode } from '../../language/tnode';
import { makeMatrix } from '../lists/types';
import { table } from '../statistics/describe-commands';
import { ACTION_ORIGIN, lockedAmong, lockedError, sheetActionSpecs, registerSheetActions } from './actions';

export { planFill, planClear, applyPlan, applyFill, cellMarks, setSheetLocks, sheetLocksOn, literalOf } from './actions';
export type { FillPlan, FillDirection, CellMark, SheetWrite } from './actions';
export { PASTE_LIMITS, splitDelimited, pasteSeparator, detectSeparator, parseField, planPaste, planImport, planPasteCells, copyText, applyPaste, applyImport, applyPasteCells } from './paste';
export type { Separator, Field, PastePlan, ImportOptions, CellClip, PasteCellsOptions, PasteResult } from './paste';

export { shiftRefs, shiftLine } from './shift';
export type { ShiftResult } from './shift';

/** The size a sheet has without numbers, and the limits of design 3.6. */
export const SHEET_LIMITS = Object.freeze({ cols: 26, rows: 100, maxCols: MAX_SHEET_COLS, maxRows: MAX_SHEET_ROWS, cells: 20_000 });

/** The size of the figure's sheet (`@sheet cols rows`), or `undefined` when it has none. */
export function sheetSize(figure: unknown): { cols: number; rows: number } | undefined {
  const words = (figure as { directive?: (n: string) => readonly string[] | undefined }).directive?.('sheet');
  if (!words) return undefined;
  const cols = Number(words[0] ?? SHEET_LIMITS.cols);
  const rows = Number(words[1] ?? SHEET_LIMITS.rows);
  return { cols: Number.isInteger(cols) && cols > 0 ? cols : SHEET_LIMITS.cols, rows: Number.isInteger(rows) && rows > 0 ? rows : SHEET_LIMITS.rows };
}

/** Short codes a cell shows for an undefined value (errors 4). */
export const UNDEFINED_CODES: Readonly<Record<string, string>> = Object.freeze({
  off_sheet: '#OFF',
  deleted_cell: '#DEL',
  empty_cell: '#EMPTY',
  not_numeric: '#NUM',
  division_by_zero: '#DIV',
  out_of_domain: '#DOM',
  not_finite: '#INF',
  overflow: '#INF',
  input_undefined: '#UP',
});

/** The short code of an undefined cell: `#DIV`, `#OFF`, … (`#N/A` for any other reason). */
export const undefinedCode = (reason: string | undefined): string => (reason !== undefined ? (UNDEFINED_CODES[reason] ?? '#N/A') : '#N/A');

/* ------------------------------ commands ------------------------------ */

const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
/** The hidden parameter the checker binds to every filled cell (`Cell` reads by number). */
const SHEET_PARAM = P('sheet', 'Range', { optional: true });

const rule = (run: (call: RuleCall) => unknown): (() => { run(call: RuleCall): unknown }) => () => ({ run });

const obj = (name: string, forms: CommandSpec['forms']): CommandSpec => ({ name, kind: 'object', group: 'sheet', forms });

function rangeAt(call: RuleCall, i: number): RangeValue | undefined {
  const v = call.values[i];
  return isRangeValue(v) ? v : undefined;
}

const addrAt = (call: RuleCall, i: number): CellRef | undefined => {
  const v = call.values[i] as CellRef | undefined;
  return v && typeof v.col === 'number' && typeof v.row === 'number' ? v : undefined;
};

/** The cell at (col, row) of a range value, `undefined` when it is a hole. */
function at(r: RangeValue, col: number, row: number): { value: unknown } | undefined {
  for (const c of r.cells) if (c.col === col && c.row === row) return { value: c.value };
  return undefined;
}

/** A dense grid of the range: a map from `row * 1024 + col` to the value. */
function grid(r: RangeValue): Map<number, unknown> {
  const m = new Map<number, unknown>();
  for (const c of r.cells) m.set(c.row * 1024 + c.col, c.value);
  return m;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPt = (v: unknown): v is { x: number; y: number } => typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number';

/** The points of a two-column range, one per row that has two numbers. */
function pointsOf(call: RuleCall, r: RangeValue): { x: number; y: number }[] | undefined {
  const g = grid(r);
  const out: { x: number; y: number }[] = [];
  for (let row = r.rect.r0; row <= r.rect.r1; row++) {
    const kx = row * 1024 + r.rect.c0;
    const ky = kx + 1;
    if (!g.has(kx) && !g.has(ky)) continue;
    const x = g.get(kx);
    const y = g.get(ky);
    if (x === undefined || y === undefined) {
      if (g.has(kx) && g.has(ky)) return call.fail('input_undefined', `a cell in row ${row} is undefined`);
      continue;
    }
    if (!isNum(x) || !isNum(y)) continue;
    out.push({ x, y });
  }
  return out;
}

const CELL = obj('Cell', [
  {
    params: [P('col', 'Number'), P('row', 'Number'), SHEET_PARAM],
    returns: 'Number',
    summary: 'the number in the cell at a column and a row',
    rule: rule((call) => {
      const [c, r] = call.values;
      const sheet = rangeAt(call, 2);
      if (!isNum(c) || !isNum(r) || !sheet) return call.fail('input_undefined');
      const col = Math.round(c);
      const row = Math.round(r);
      if (cellName(col, row) === undefined) return call.fail('off_sheet', `there is no cell at column ${col}, row ${row}`);
      const hit = at(sheet, col, row);
      if (!hit) return call.fail('empty_cell', `${cellName(col, row) as string} is empty`);
      if (hit.value === undefined) return call.fail('input_undefined', `${cellName(col, row) as string} is undefined`);
      if (!isNum(hit.value)) return call.fail('not_numeric', `${cellName(col, row) as string} does not hold a number`);
      return hit.value;
    }),
  },
]);

const CELL_RANGE = obj('CellRange', [
  {
    params: [P('from', 'CellAddr'), P('to', 'CellAddr'), SHEET_PARAM],
    returns: 'Range',
    summary: 'the range between two cells, the same as A1:B3',
    rule: rule((call) => {
      const a = addrAt(call, 0);
      const b = addrAt(call, 1);
      const sheet = rangeAt(call, 2);
      if (!a || !b || !sheet) return call.fail('input_undefined');
      const rect = rectOf(a, b);
      const v: RangeValue = { schema: 'Range', rect, cells: sheet.cells.filter((c) => rectHas(rect, c.col, c.row)) };
      return v;
    }),
  },
]);

const addrCommand = (name: string, returns: string, summary: string, f: (a: CellRef) => unknown): CommandSpec =>
  obj(name, [{ params: [P('cell', 'CellAddr')], returns, summary, rule: rule((call) => { const a = addrAt(call, 0); return a ? f(a) : call.fail('input_undefined'); }) }]);

const LIST_FROM = obj('ListFrom', [
  { params: [P('range', 'List')], returns: '=range', summary: 'a live list of the cells; a larger range gives a list of rows', rule: rule((call) => call.values[0]) },
]);

const POINTS_FROM = obj('PointsFrom', [
  {
    params: [P('range', 'Range')],
    returns: 'List<Point>',
    summary: 'one point for each row of a two-column range',
    rule: rule((call) => {
      const r = rangeAt(call, 0);
      return r ? pointsOf(call, r) : call.fail('input_undefined');
    }),
  },
]);

const POLYLINE_FROM = obj('PolylineFrom', [
  {
    params: [P('range', 'Range')],
    returns: 'Polyline',
    summary: 'joins the points of a two-column range in order',
    rule: rule((call) => {
      const r = rangeAt(call, 0);
      if (!r) return call.fail('input_undefined');
      const pts = pointsOf(call, r);
      if (!pts) return undefined;
      if (pts.length < 2) return call.fail('empty_cell', `a polyline needs 2 or more rows of numbers, found ${pts.length}`);
      return { pts };
    }),
  },
]);

const MATRIX_FROM = obj('MatrixFrom', [
  {
    params: [P('range', 'Range')],
    returns: 'Matrix',
    summary: 'a matrix of the numbers in the range; every cell must be filled',
    rule: rule((call) => {
      const r = rangeAt(call, 0);
      if (!r) return call.fail('input_undefined');
      const cols = rectCols(r.rect);
      const rows = rectRows(r.rect);
      const g = grid(r);
      const data = new Float64Array(rows * cols);
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const k = (r.rect.r0 + i) * 1024 + r.rect.c0 + j;
          const name = cellName(r.rect.c0 + j, r.rect.r0 + i) as string;
          if (!g.has(k)) return call.fail('empty_cell', `${name} is empty`);
          const v = g.get(k);
          if (v === undefined) return call.fail('input_undefined', `${name} is undefined`);
          if (!isNum(v)) return call.fail('not_numeric', `${name} does not hold a number`);
          data[i * cols + j] = v;
        }
      }
      return makeMatrix(rows, cols, data);
    }),
  },
]);

/** The text a table shows for a cell value. */
const cellText = (v: unknown): string => (typeof v === 'string' ? v : isNum(v) ? String(v) : typeof v === 'boolean' ? String(v) : isPt(v) ? `(${v.x}, ${v.y})` : '');

const TABLE_FROM = obj('TableFrom', [
  {
    params: [P('range', 'Range')],
    returns: 'Table',
    summary: 'a table of the range; a first row of texts gives the titles',
    rule: rule((call) => {
      const r = rangeAt(call, 0);
      if (!r) return call.fail('input_undefined');
      const g = grid(r);
      const { c0, r0, c1, r1 } = r.rect;
      let headed = true;
      for (let c = c0; c <= c1; c++) if (typeof g.get(r0 * 1024 + c) !== 'string') headed = false;
      if (r0 === r1) headed = false;
      const titles: string[] = [];
      const columns: unknown[] = [];
      for (let c = c0; c <= c1; c++) {
        titles.push(headed ? (g.get(r0 * 1024 + c) as string) : (columnLetters(c) as string));
        const vals: unknown[] = [];
        for (let row = headed ? r0 + 1 : r0; row <= r1; row++) vals.push(g.get(row * 1024 + c));
        const filled = vals.filter((v) => v !== undefined);
        columns.push(filled.length > 0 && filled.every(isNum) && filled.length === vals.length ? Float64Array.from(vals as number[]) : vals.map(cellText));
      }
      return table(titles, columns);
    }),
  },
]);

const OPERATION_TABLE = obj('OperationTable', [
  {
    params: [P('range', 'Range')],
    returns: 'Table',
    summary: 'a two-variable function in the top-left cell, x across the first row and y down the first column',
    rule: rule((call) => {
      const r = rangeAt(call, 0);
      if (!r) return call.fail('input_undefined');
      const g = grid(r);
      const { c0, r0, c1, r1 } = r.rect;
      const f = g.get(r0 * 1024 + c0) as { arity?: number; call?: (...xs: number[]) => unknown } | undefined;
      const corner = cellName(c0, r0) as string;
      if (!f || typeof f.call !== 'function' || f.arity !== 2) return call.fail('not_numeric', `${corner} must hold a function of x and y, such as ${corner}(x, y) = x * y`);
      const xs: number[] = [];
      for (let c = c0 + 1; c <= c1; c++) {
        const v = g.get(r0 * 1024 + c);
        if (!isNum(v)) return call.fail(g.has(r0 * 1024 + c) ? 'not_numeric' : 'empty_cell', `${cellName(c, r0) as string} must hold a number`);
        xs.push(v);
      }
      const ys: number[] = [];
      for (let row = r0 + 1; row <= r1; row++) {
        const v = g.get(row * 1024 + c0);
        if (!isNum(v)) return call.fail(g.has(row * 1024 + c0) ? 'not_numeric' : 'empty_cell', `${cellName(c0, row) as string} must hold a number`);
        ys.push(v);
      }
      const columns: unknown[] = [Float64Array.from(ys)];
      for (const x of xs) {
        columns.push(Float64Array.from(ys.map((y) => {
          const v = f.call?.(x, y);
          return typeof v === 'number' ? v : NaN;
        })));
      }
      return table(['y \\ x', ...xs.map((x) => String(x))], columns);
    }),
  },
]);

export const SHEET_SPECS: readonly CommandSpec[] = [
  CELL,
  CELL_RANGE,
  addrCommand('Column', 'Number', 'the column number of a cell', (a) => a.col),
  addrCommand('Row', 'Number', 'the row number of a cell', (a) => a.row),
  addrCommand('ColumnName', 'Text', 'the column letters of a cell', (a) => columnLetters(a.col)),
  LIST_FROM,
  POINTS_FROM,
  POLYLINE_FROM,
  MATRIX_FROM,
  TABLE_FROM,
  OPERATION_TABLE,
  ...sheetActionSpecs(),
];

/* ------------------------------ checks ------------------------------ */

type Node = Record<string, unknown>;

/** Every node of a syntax tree. */
function walkExpr(e: Expr | undefined, visit: (e: Expr) => void): void {
  if (!e) return;
  visit(e);
  for (const v of Object.values(e as unknown as Node)) {
    if (Array.isArray(v)) {
      for (const x of v) {
        if (x && typeof x === 'object' && 'k' in x) walkExpr(x as Expr, visit);
        else if (x && typeof x === 'object' && 'value' in x) walkExpr((x as { value: Expr }).value, visit);
        else if (x && typeof x === 'object' && 'expr' in x) walkExpr((x as { expr: Expr }).expr, visit);
      }
    } else if (v && typeof v === 'object' && 'k' in v) walkExpr(v as Expr, visit);
  }
}

function lineExprs(parsed: ParsedLine): Expr[] {
  const n = parsed.node;
  const out: Expr[] = [];
  if ('expr' in n && n.expr) out.push(n.expr);
  if ('style' in n && n.style) for (const s of n.style) out.push(s.value);
  if ('range' in n && n.range) out.push(n.range.from, n.range.to);
  return out;
}

/** Every typed node. */
function walkT(n: TNode | undefined, visit: (n: TNode) => void): void {
  if (!n) return;
  visit(n);
  for (const [k, v] of Object.entries(n as unknown as Node)) {
    if (k === 'spec' || k === 'form' || k === 'ty' || k === 'impl' || k === 'variant' || k === 'value') continue;
    if (Array.isArray(v)) {
      for (const x of v) {
        if (x && typeof x === 'object' && typeof (x as Node)['n'] === 'string') walkT(x as TNode, visit);
        else if (x && typeof x === 'object' && (x as Node)['expr']) walkT((x as { expr: TNode }).expr, visit);
      }
    } else if (v && typeof v === 'object' && typeof (v as Node)['n'] === 'string') walkT(v as TNode, visit);
  }
}

const SHAPE_RULES: Readonly<Record<string, (r: CellRect, items: number) => string | undefined>> = {
  PointsFrom: (r) => (rectCols(r) === 2 ? undefined : `PointsFrom needs 2 columns; ${rectText(r)} has ${rectCols(r)}.`),
  PolylineFrom: (r) => (rectCols(r) === 2 ? undefined : `PolylineFrom needs 2 columns; ${rectText(r)} has ${rectCols(r)}.`),
  OperationTable: (r) => (rectCols(r) >= 2 && rectRows(r) >= 2 ? undefined : `OperationTable needs at least 2 columns and 2 rows; ${rectText(r)} has ${rectCols(r)} by ${rectRows(r)}.`),
  MatrixFrom: (r, n) => (n > 0 ? undefined : `MatrixFrom needs filled cells; ${rectText(r)} is empty.`),
};

const SHAPE_EXPECTED: Readonly<Record<string, string>> = {
  PointsFrom: 'a range with 2 columns, e.g. A1:B10',
  PolylineFrom: 'a range with 2 columns, e.g. A1:B10',
  OperationTable: 'a range of at least 2 x 2, e.g. A1:D4',
  MatrixFrom: 'a range of filled cells, e.g. A1:C3',
};

function sheetLineCheck(figure: unknown, line: CheckedLine, parsed: ParsedLine, ctx: LineCheckContext): ErrorObject | undefined {
  const size = sheetSize(figure);
  const text = parsed.sm.text;
  const node = parsed.node;
  const span = (s: number, e: number): { line: number; col: number; endCol: number } => {
    const sp = parsed.sm.span(s, e);
    return { line: sp.line, col: sp.col, endCol: sp.endCol };
  };
  // @sheet cols rows: in range
  if (node.k === 'directive' && node.name === 'sheet') {
    const [c, r] = node.words.map((w) => Number(w.text));
    if (node.words.length !== 2 || !Number.isInteger(c) || !Number.isInteger(r) || (c as number) < 1 || (r as number) < 1 || (c as number) > MAX_SHEET_COLS || (r as number) > MAX_SHEET_ROWS) {
      return err('bad_directive', span(0, text.length), { directive: '@sheet', need: `two whole numbers: columns 1 to ${MAX_SHEET_COLS} and rows 1 to ${MAX_SHEET_ROWS}` }, { hint: 'Write @sheet 26 100.', suggest: ['@sheet 26 100'], recovery: 'fix_line', fingerprintKey: '@sheet' });
    }
    return undefined;
  }
  if (node.k === 'directive' || node.k === 'noop') return undefined;
  // what of the sheet the line uses: `$` references, ranges, sheet commands
  let sheetUse: { token: string; s: number; e: number } | undefined;
  for (const e of lineExprs(parsed)) {
    walkExpr(e, (x) => {
      if (sheetUse) return;
      if (x.k === 'cells' || (x.k === 'name' && (x.cabs || x.rabs))) sheetUse = { token: text.slice(x.s, x.e), s: x.s, e: x.e };
      if (x.k === 'call' && SHEET_NAMES.has(x.callee) && line.expr && usesSheetForm(line.expr, x.callee)) sheetUse = { token: x.callee, s: x.cs, e: x.ce };
    });
  }
  // `$A$1 = 3`: a `$` belongs in a reference, not in a name being defined
  const target = 'target' in node ? node.target : undefined;
  if (target && text.slice(target.s, target.e).includes('$')) {
    const token = text.slice(target.s, target.e);
    return err('bad_reference', span(target.s, target.e), { token, why: 'a $ marks a reference inside a formula, not the cell being defined' }, { token, hint: `Write ${target.name} = … to define the cell.`, suggest: [text.slice(0, target.s) + target.name + text.slice(target.e)], recovery: 'use_suggestion', fingerprintKey: 'target$' });
  }
  if (!size) {
    if (sheetUse) {
      return err('no_sheet', span(sheetUse.s, sheetUse.e), { token: sheetUse.token }, { token: sheetUse.token, hint: 'Add @sheet 26 100 first.', suggest: ['@sheet 26 100'], recovery: 'create_first', fingerprintKey: sheetUse.token });
    }
    return undefined;
  }
  // the action learns who wrote its line, for the locks
  if (node.k === 'action' && figure && typeof figure === 'object') ACTION_ORIGIN.set(figure, ctx.origin);
  // a locked cell (design 3.15)
  if (target && parseCellName(target.name)) {
    const locked = lockedAmong(figure, [target.name], ctx.origin);
    if (locked.length > 0) {
      const e = lockedError(locked);
      return { ...e, ...span(target.s, target.e) };
    }
  }
  // a cell outside the size of the sheet
  const targets = node.k === 'defmany' ? node.targets : target ? [target] : [];
  for (const t of targets) {
    const a = parseCellName(t.name);
    if (!a) continue;
    if (node.k === 'defmany') {
      return err('reserved_name', span(t.s, t.e), { name: t.name, group: 'a cell of the sheet' }, { token: t.name, hint: `Cell names hold one value each. Use another name, such as P_${t.name}, or remove @sheet.`, recovery: 'rewrite', fingerprintKey: t.name });
    }
    if (a.col > size.cols || a.row > size.rows) {
      const cols = Math.max(size.cols, a.col);
      const rows = Math.max(size.rows, a.row);
      const pick = a.col > size.cols ? `a column from A to ${columnLetters(size.cols) ?? 'A'}` : `a row from 1 to ${size.rows}`;
      return err('cell_out_of_range', span(t.s, t.e), { token: t.name, cols: size.cols, rows: size.rows }, {
        token: t.name,
        hint: `Use @sheet ${cols} ${rows} to make the sheet ${a.col > size.cols ? 'wider' : 'taller'}, or pick ${pick}.`,
        suggest: [`@sheet ${cols} ${rows}`],
        recovery: 'create_first',
        fingerprintKey: t.name,
      });
    }
  }
  // a range is not an object: `r = CellRange(A1, B3)`
  if (line.type?.k === 'Range' && target) {
    const token = text.slice(target.e).replace(/^\s*=\s*/, '').trim();
    return err('range_not_object', span(0, text.length), { token }, { token, hint: `Make a list or a matrix from it: ${target.name} = ListFrom(${token}).`, suggest: [`${target.name} = ListFrom(${token})`], recovery: 'use_suggestion', fingerprintKey: 'range_not_object' });
  }
  // a range that holds the cell it defines: `A1 = Sum(A1:A5)` (errors 2, cycle)
  const own = target ? parseCellName(target.name) : undefined;
  if (own && target) {
    let hit: (TNode & { n: 'cells' }) | undefined;
    walkT(line.expr, (n) => {
      if (!hit && n.n === 'cells' && rectHas(n.rect, own.col, own.row) && n.rect !== WHOLE_SHEET) hit = n;
    });
    if (hit) {
      const token = text.slice(hit.s, hit.e);
      return err('cycle', span(hit.s, hit.e), { name: target.name, path: `${target.name} -> ${token} -> ${target.name}` }, { token, path: [target.name, token, target.name], hint: `Make the range stop before ${target.name}, or put the result in another cell.`, recovery: 'rewrite', fingerprintKey: target.name });
    }
  }
  // the shape a command needs
  let shape: ErrorObject | undefined;
  walkT(line.expr, (n) => {
    if (shape || n.n !== 'command') return;
    const check = SHAPE_RULES[n.spec.name];
    const arg = n.args[0]?.expr;
    if (!check || !arg || arg.n !== 'cells') return;
    const why = check(arg.rect, arg.items.length);
    if (why === undefined) return;
    const token = text.slice(arg.s, arg.e);
    shape = err('bad_shape', span(arg.s, arg.e), { why }, { token, expected: [SHAPE_EXPECTED[n.spec.name] as string], forms: [`${n.spec.name}(Range)`], hint: n.spec.name === 'MatrixFrom' ? 'Fill the cells first, or choose filled cells.' : 'Choose a range of that shape.', recovery: 'fix_line', fingerprintKey: n.spec.name });
  });
  if (shape) return shape;
  noteRanges(figure, line, parsed);
  return undefined;
}

const SHEET_NAMES = new Set<string>();

/** True when the call to `name` in the checked line used one of this area's forms (`Column` is also a statistics command). */
function usesSheetForm(expr: TNode, name: string): boolean {
  let found = false;
  walkT(expr, (n) => {
    if (n.n === 'command' && n.spec.name === name && n.form.params.some((p) => p.type === 'Range' || p.type === 'CellAddr')) found = true;
    if (n.n === 'command' && n.spec.name === name && n.spec.group === 'sheet') found = true;
  });
  return found;
}

/* ------------------------------ a range sees cells typed later ------------------------------ */

/** Per figure: the objects whose lines read a range, and the rectangles they read. */
const RANGE_READERS = new WeakMap<object, Map<string, CellRect[]>>();

function noteRanges(figure: unknown, line: CheckedLine, parsed: ParsedLine): void {
  if (!figure || typeof figure !== 'object' || line.names.length !== 1) return;
  const rects: CellRect[] = [];
  walkT(line.expr, (n) => {
    if (n.n === 'cells') rects.push(n.rect);
  });
  if (rects.length === 0) return;
  let m = RANGE_READERS.get(figure);
  if (!m) RANGE_READERS.set(figure, (m = new Map()));
  m.set(line.names[0] as string, rects);
  void parsed;
}

/** The objects whose ranges cover a cell, with their definitions now. */
export function rangeReadersOf(figure: Figure, cell: string): { name: string; definition: string }[] {
  const a = parseCellName(cell);
  const m = RANGE_READERS.get(figure);
  if (!a || !m) return [];
  const out: { name: string; definition: string }[] = [];
  for (const [name, rects] of m) {
    if (name === cell || !rects.some((r) => rectHas(r, a.col, a.row))) continue;
    const view = figure.get(name);
    if (!view || view.free) continue;
    out.push({ name, definition: view.definition });
  }
  return out;
}

function afterLine(figure: unknown, result: { readonly op: string; readonly name?: string }, ctx: { readonly together: (fn: () => void) => void }): void {
  if (result.op !== 'add' || result.name === undefined || !parseCellName(result.name)) return;
  const f = figure as Figure;
  const readers = rangeReadersOf(f, result.name);
  if (readers.length === 0) return;
  ctx.together(() => {
    for (const r of readers) f.apply(r.definition, { rebind: true });
  });
}

/* ------------------------------ registration ------------------------------ */

let registered = false;

export function registerSheet(registry: CommandRegistry): void {
  registry.registerAll(SHEET_SPECS);
  for (const s of SHEET_SPECS) SHEET_NAMES.add(s.name);
  if (registered) return;
  registered = true;
  registerLineCheck(sheetLineCheck);
  registerAfterLine(afterLine);
  registerSheetActions();
  registerNotice('skipped_non_numeric', { code: 'H101', severity: 'warning', template: '{range}: left out {count} non-number cells.' });
  registerReasonPhrase('off_sheet', { noun: 'off the sheet', sentence: 'A copied reference points outside the sheet.' });
  registerReasonPhrase('deleted_cell', { noun: 'a deleted cell', sentence: 'The cell it reads was deleted.' });
  registerReasonPhrase('empty_cell', { noun: 'an empty cell', sentence: 'A cell it needs is empty.' });
  registerReasonPhrase('not_numeric', { noun: 'not a number', sentence: 'A cell it needs does not hold a number.' });
}

