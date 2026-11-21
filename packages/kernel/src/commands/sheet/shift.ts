/**
 * Moving cell references by an offset, on the syntax tree (spreadsheet design 3.4): `A1` copied one row down reads `A2`,
 * `$A$1` stays, `A$1` keeps its row. Names that are not cells are never touched, so a point named `P1` is safe.
 */
import type { Expr, LineNode, NameExpr, ParsedLine } from '../../language/ast';
import { SourceMap } from '../../language/source';
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

interface Shift {
  readonly dCol: number;
  readonly dRow: number;
  readonly b: ShiftBounds;
  /** Cell names the moved tree reads by name (not inside a range), when asked for. */
  readonly reads: string[] | undefined;
  inRange: number;
}

function shiftName(e: NameExpr, s: Shift): NameExpr {
  const a = parseCellName(e.name);
  if (!a) return e;
  const col = e.cabs ? a.col : a.col + s.dCol;
  const row = e.rabs ? a.row : a.row + s.dRow;
  if (col < 1 || row < 1 || col > s.b.cols || row > s.b.rows) throw new OffSheet({ col, row, colAbs: e.cabs === true, rowAbs: e.rabs === true });
  const name = cellName(col, row) as string;
  if (s.reads && s.inRange === 0) s.reads.push(name);
  return name === e.name ? e : { ...e, name };
}

/** The node with its cell names moved; a part with nothing to move is the same object (nothing is copied). */
function shiftAny(v: unknown, s: Shift): unknown {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) {
    let out: unknown[] | undefined;
    for (let i = 0; i < v.length; i++) {
      const x = v[i] as unknown;
      const y = shiftAny(x, s);
      if (y !== x) (out ??= v.slice())[i] = y;
    }
    return out ?? v;
  }
  const o = v as Record<string, unknown>;
  const k = o['k'];
  if (k === 'name') return shiftName(o as unknown as NameExpr, s);
  if (k === 'cells') s.inRange++;
  let out: Record<string, unknown> | undefined;
  for (const key in o) {
    const x = o[key];
    if (typeof x !== 'object' || x === null) continue;
    const y = shiftAny(x, s);
    if (y !== x) (out ??= { ...o })[key] = y;
  }
  if (k === 'cells') s.inRange--;
  return out ?? o;
}

/**
 * Pure: a new tree with the relative parts of every cell reference moved; never mutates. `reads`, when given, collects the
 * cell names the moved tree reads by name (outside ranges).
 */
export function shiftRefs(tree: Expr, dCol: number, dRow: number, bounds: ShiftBounds = { cols: 702, rows: 9999 }, reads?: string[]): ShiftResult {
  try {
    return { ok: true, tree: shiftAny(tree, { dCol, dRow, b: bounds, reads, inRange: 0 }) as Expr };
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

/* ------------------------------ a shifted line without parsing it again ------------------------------ */

const POS_KEYS: ReadonlySet<string> = new Set(['s', 'e', 'cs', 'ce', 'open', 'close', 'ns', 'ne', 'fs', 'fe', 'ks', 'ke']);

interface Replace {
  readonly s: number;
  readonly e: number;
  readonly text: string;
}

/** Where a position of the old text lands in the new one: each rewritten name moves what follows it. */
function mover(reps: readonly Replace[]): (p: number) => number {
  return (p) => {
    let d = 0;
    for (const r of reps) {
      if (r.e <= p) d += r.text.length - (r.e - r.s);
      else break;
    }
    return p + d;
  };
}

function remap(v: unknown, at: (p: number) => number, names: ReadonlyMap<number, string>): unknown {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) return v.map((x) => remap(x, at, names));
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key in o) {
    const x = o[key];
    out[key] = typeof x === 'number' && POS_KEYS.has(key) ? at(x) : typeof x === 'object' && x !== null ? remap(x, at, names) : x;
  }
  // a moved name takes its new spelling (keyed by where it starts in the old text); a line target is a name ref
  if (typeof o['name'] === 'string' && typeof o['s'] === 'number' && (o['k'] === 'name' || o['k'] === undefined)) {
    const n = names.get(o['s'] as number);
    if (n !== undefined) out['name'] = n;
  }
  return out;
}

/**
 * A parsed definition moved from `from` to `to` (design 3.4): the tree's cell names move by the offset, the text is the
 * source text with exactly those names rewritten, and every position follows, so the line is what parsing the new text
 * would give, without parsing it again. `reads` collects the cell names it reads by name (outside ranges).
 */
export function shiftParsed(parsed: ParsedLine, from: string, to: string, bounds: ShiftBounds, reads?: string[]): { ok: true; line: ParsedLine } | { ok: false; reason: 'off_sheet' | 'parse' } {
  const a = parseCellName(from);
  const b = parseCellName(to);
  const node = parsed.node;
  if (!a || !b || (node.k !== 'define' && node.k !== 'function') || node.style || (node.k === 'define' && node.range)) return { ok: false, reason: 'parse' };
  const dCol = b.col - a.col;
  const dRow = b.row - a.row;
  const text = parsed.sm.text;
  const reps: Replace[] = [{ s: node.target.s, e: node.target.e, text: to }];
  const names = new Map<number, string>([[node.target.s, to]]);
  let inRange = 0;
  const walk = (v: unknown): boolean => {
    if (typeof v !== 'object' || v === null) return true;
    if (Array.isArray(v)) return v.every(walk);
    const o = v as Record<string, unknown>;
    if (o['k'] === 'name') {
      const e = o as unknown as NameExpr;
      const c = parseCellName(e.name);
      if (!c) return true;
      const col = e.cabs ? c.col : c.col + dCol;
      const row = e.rabs ? c.row : c.row + dRow;
      if (col < 1 || row < 1 || col > bounds.cols || row > bounds.rows) return false;
      const name = cellName(col, row) as string;
      if (reads && inRange === 0) reads.push(name);
      if (name !== e.name) {
        const m = /^([A-Z]+)(\d+)$/.exec(name) as RegExpExecArray;
        reps.push({ s: e.s, e: e.e, text: `${e.cabs ? '$' : ''}${m[1] as string}${e.rabs ? '$' : ''}${m[2] as string}` });
        names.set(e.s, name);
      }
      return true;
    }
    if (o['k'] === 'cells') inRange++;
    let ok = true;
    for (const key in o) if (ok && typeof o[key] === 'object') ok = walk(o[key]);
    if (o['k'] === 'cells') inRange--;
    return ok;
  };
  if (!walk(node.expr)) return { ok: false, reason: 'off_sheet' };
  reps.sort((x, y) => x.s - y.s);
  let out = '';
  let at = 0;
  for (const r of reps) {
    out += text.slice(at, r.s) + r.text;
    at = r.e;
  }
  out += text.slice(at);
  const moved = remap(node, mover(reps), names) as LineNode;
  return { ok: true, line: { line: parsed.line, source: out, sm: new SourceMap(out, parsed.line), node: moved } };
}
