/**
 * Moving cell references by an offset, on the syntax tree (spreadsheet design 3.4): `A1` copied one row down reads `A2`,
 * `$A$1` stays, `A$1` keeps its row. Names that are not cells are never touched, so a point named `P1` is safe.
 */
import type { Expr, LineNode, NameExpr } from '../../language/ast';
import { cellName, parseCellName } from '../../language/cells';
import type { CellRef } from '../../language/cells';
import { parseLine } from '../../language/parser';
import { printLineNode } from '../../language/printer';

export type ShiftResult = { readonly ok: true; readonly tree: Expr } | { readonly ok: false; readonly reason: 'off_sheet'; readonly ref: CellRef };

/** Grid limits a shifted reference must stay inside (the sheet's size, or the largest sheet). */
export interface ShiftBounds {
  readonly cols: number;
  readonly rows: number;
}

class OffSheet {
  constructor(readonly ref: CellRef) {}
}

function shiftName(e: NameExpr, dCol: number, dRow: number, b: ShiftBounds): NameExpr {
  const a = parseCellName(e.name);
  if (!a) return e;
  const col = e.cabs ? a.col : a.col + dCol;
  const row = e.rabs ? a.row : a.row + dRow;
  if (col < 1 || row < 1 || col > b.cols || row > b.rows) throw new OffSheet({ col, row, colAbs: e.cabs === true, rowAbs: e.rabs === true });
  const name = cellName(col, row) as string;
  return name === e.name ? e : { ...e, name };
}

function shiftAny(v: unknown, dCol: number, dRow: number, b: ShiftBounds): unknown {
  if (Array.isArray(v)) return v.map((x) => shiftAny(x, dCol, dRow, b));
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (o['k'] === 'name') return shiftName(o as unknown as NameExpr, dCol, dRow, b);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = shiftAny(x, dCol, dRow, b);
  return out;
}

/** Pure: a new tree with the relative parts of every cell reference moved; never mutates. */
export function shiftRefs(tree: Expr, dCol: number, dRow: number, bounds: ShiftBounds = { cols: 702, rows: 9999 }): ShiftResult {
  try {
    return { ok: true, tree: shiftAny(tree, dCol, dRow, bounds) as Expr };
  } catch (e) {
    if (e instanceof OffSheet) return { ok: false, reason: 'off_sheet', ref: e.ref };
    throw e;
  }
}

/**
 * The definition line of one cell copied to another: `B2 = A2^2` copied to `B3` is `B3 = A3^2`. The offset is the move
 * from `from` to `to`. A free value is copied as it is. `undefined` when the line does not parse; `off_sheet` when a
 * relative reference would leave the grid.
 */
export function shiftLine(line: string, from: string, to: string, bounds?: ShiftBounds): { ok: true; line: string } | { ok: false; reason: 'off_sheet' | 'parse'; ref?: CellRef } {
  const a = parseCellName(from);
  const b = parseCellName(to);
  const pr = parseLine(line, {});
  if (!a || !b || !pr.ok) return { ok: false, reason: 'parse' };
  const node = pr.value.node;
  if (node.k !== 'define' && node.k !== 'function') return { ok: false, reason: 'parse' };
  const r = shiftRefs(node.expr, b.col - a.col, b.row - a.row, bounds);
  if (!r.ok) return { ok: false, reason: 'off_sheet', ref: r.ref };
  const moved: LineNode = { ...node, target: { ...node.target, name: to }, expr: r.tree };
  return { ok: true, line: printLineNode(moved) };
}
