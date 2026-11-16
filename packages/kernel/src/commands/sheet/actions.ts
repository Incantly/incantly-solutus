/**
 * The sheet's actions: fills and clears (spreadsheet design 3.8 to 3.10), and the plans the grid uses for its fill handle.
 * Every action is one batch: all or nothing, one undo step. A plan is made in full before anything is applied, tried as a
 * dry run, and only then applied.
 */
import type { ErrorObject, Notice } from '../../contracts/errors';
import { err } from '../../errors/table';
import { makeNotice, registerNotice } from '../../errors/notices';
import type { Figure } from '../../graph/figure';
import type { ActionCall, ActionOutcome, RuleCall } from '../../graph/registry';
import { numberSource } from '../../graph/values';
import type { Expr } from '../../language/ast';
import { EXCLUDED_CELLS, cellName, isRangeValue, parseCellName, rectHas, rectText } from '../../language/cells';
import type { CellRect, CellRef } from '../../language/cells';
import { parseLine } from '../../language/parser';
import type { CommandSpec, ParamSpec } from '../../language/table';
import { shiftLine } from './shift';

/* ------------------------------ shared state ------------------------------ */

/** Who wrote the line that runs an action now (set by the sheet's line check just before the action runs). */
export const ACTION_ORIGIN = new WeakMap<object, string>();

/** Per figure: whether locks stop learners and the model (design 3.15; on unless the teacher's session turns it off). */
const LOCKS = new WeakMap<object, boolean>();

export function setSheetLocks(figure: object, enforce: boolean): void {
  LOCKS.set(figure, enforce);
}

export const sheetLocksOn = (figure: object): boolean => LOCKS.get(figure) ?? true;

/** A cell's marks from its `@cell` lines (the last one wins). */
export interface CellMark {
  readonly locked: boolean;
  readonly input: boolean;
}

/** Every marked cell of the figure: `@cell B2 locked`, `@cell B2 input`, `@cell B2 none`. */
export function cellMarks(figure: unknown): Map<string, CellMark> {
  const out = new Map<string, CellMark>();
  const lines = (figure as { directiveLines?: (n: string) => readonly (readonly string[])[] }).directiveLines?.('cell') ?? [];
  for (const w of lines) {
    const name = w[0];
    if (name === undefined || !parseCellName(name)) continue;
    const words = w.slice(1);
    if (words.includes('none')) out.delete(name);
    else if (words.includes('locked') || words.includes('input')) out.set(name, { locked: words.includes('locked'), input: words.includes('input') });
  }
  return out;
}

/** True when a learner's (or the model's) line may not change these cells; returns the locked ones (all of them). */
export function lockedAmong(figure: unknown, names: readonly string[], origin: string | undefined): string[] {
  if (!figure || typeof figure !== 'object' || origin === undefined || origin === 'host' || !sheetLocksOn(figure)) return [];
  const marks = cellMarks(figure);
  return names.filter((n) => marks.get(n)?.locked === true);
}

export function lockedError(names: readonly string[]): ErrorObject {
  const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : '');
  return err('cell_locked', { line: 0, col: 1, endCol: 1 }, { why: `${names.length === 1 ? 'The cell' : 'The cells'} ${shown} ${names.length === 1 ? 'is' : 'are'} locked; nothing was applied.` }, {
    token: names[0] ?? '',
    hint: 'Ask your teacher to unlock it.',
    recovery: 'report',
    fingerprintKey: names[0] ?? 'locked',
  });
}

/* ------------------------------ helpers ------------------------------ */

const P = (name: string, type: string): ParamSpec => ({ name, type });

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The value of argument `i`: an argument that names an object arrives as the object, so its value is read here. */
function arg(call: ActionCall, i: number): unknown {
  const v = call.values[i];
  const id = call.refs?.[i];
  return v === undefined && id !== undefined ? call.figure.value(id) : v;
}

function textSource(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\n') + '"';
}

/** The literal of a free value and its type, or `undefined` when it has none. */
export function literalOf(v: unknown): { text: string; type: string } | undefined {
  if (typeof v === 'number') return { text: numberSource(v), type: 'Number' };
  if (typeof v === 'string') return { text: textSource(v), type: 'Text' };
  if (typeof v === 'boolean') return { text: String(v), type: 'Bool' };
  if (v && typeof v === 'object' && isNum((v as { x?: unknown }).x) && isNum((v as { y?: unknown }).y)) {
    const p = v as { x: number; y: number };
    return { text: `(${numberSource(p.x)}, ${numberSource(p.y)})`, type: 'Point' };
  }
  return undefined;
}

/** The lines that write a value into a cell: a cell of another type is deleted first (design 3.7). */
function writeLines(figure: Figure, name: string, text: string, type: string): string[] {
  const old = figure.get(name);
  if (old && old.type !== type) return [`Delete(${name})`, `${name} = ${text}`];
  return [`${name} = ${text}`];
}

const listItems = (v: unknown): unknown[] | undefined => (v instanceof Float64Array ? Array.from(v) : Array.isArray(v) ? v : undefined);

/** The size of the figure's sheet (`@sheet cols rows`); the largest sheet when it has none. */
function bounds(figure: unknown): { cols: number; rows: number } {
  const w = (figure as { directive?: (n: string) => readonly string[] | undefined }).directive?.('sheet');
  const cols = Number(w?.[0]);
  const rows = Number(w?.[1]);
  return { cols: Number.isInteger(cols) && cols > 0 ? cols : 702, rows: Number.isInteger(rows) && rows > 0 ? rows : 9999 };
}

/* ------------------------------ applying a plan ------------------------------ */

/** What a fill or a clear did. */
export interface SheetWrite {
  readonly written: number;
  readonly range: string;
  readonly sample: readonly string[];
  readonly undefined: readonly string[];
  readonly lines: readonly string[];
}

function sampleOf(lines: readonly string[]): string[] {
  const writes = lines.filter((l) => !l.startsWith('Delete('));
  return writes.length <= 3 ? writes : [writes[0] as string, '…', writes[writes.length - 1] as string];
}

/**
 * Applies the lines as one batch, all or nothing: tried first as a dry run, so a failure leaves no trace, then for real.
 * `done` names what was done for the message (`filled`, `cleared`).
 */
export function applyPlan(figure: Figure, lines: readonly string[], group: string, done: string, opts: { rebind?: boolean } = {}): { ok: true } | { ok: false; error: ErrorObject } {
  if (lines.length === 0) return { ok: true };
  const origin = (ACTION_ORIGIN.get(figure) ?? 'host') as 'host' | 'learner' | 'model';
  const base = { group, mode: 'atomic' as const, origin, ...(opts.rebind ? { rebind: true } : {}) };
  const dry = figure.applyBatch(lines, { ...base, dryRun: true });
  if (!dry.ok) {
    const i = dry.results.findIndex((r) => !r.ok);
    const cause = dry.results[i] as ErrorObject;
    return { ok: false, error: batchFailed(i, lines.length, cause, done) };
  }
  const real = figure.applyBatch(lines, base);
  if (!real.ok) {
    const i = real.results.findIndex((r) => !r.ok);
    return { ok: false, error: batchFailed(i, lines.length, real.results[i] as ErrorObject, done) };
  }
  return { ok: true };
}

function batchFailed(i: number, total: number, cause: ErrorObject, done: string): ErrorObject {
  return err('batch_failed', { line: 0, col: 1, endCol: 1 }, { done, n: i + 1, total }, {
    hint: `Fix line ${i + 1} (${cause.message}) and send the whole batch again.`,
    recovery: 'fix_line',
    cause,
    fingerprintKey: cause.kind,
  }) as ErrorObject & { failedIndex?: number };
}

function outcome(action: string, w: SheetWrite, notices: readonly Notice[] = []): ActionOutcome {
  const data = { action, written: w.written, range: w.range, sample: w.sample, undefined: w.undefined };
  return { summary: `${action}: ${w.written === 1 ? '1 cell' : `${w.written} cells`} in ${w.range}`, data, ...(notices.length > 0 ? { notices } : {}) };
}

const failure = (e: ErrorObject): ActionOutcome => ({ error: e });

/* ------------------------------ free values: FillColumn, FillRow, FillCells ------------------------------ */

/** The lines that write a grid of values with its top-left cell at (col, row). */
function valueLines(figure: Figure, col: number, row: number, rows: readonly (readonly unknown[])[]): { lines: string[]; names: string[]; error?: ErrorObject } {
  const size = bounds(figure);
  const lines: string[] = [];
  const names: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as readonly unknown[];
    for (let j = 0; j < r.length; j++) {
      const c = col + j;
      const rr = row + i;
      const name = c <= size.cols && rr <= size.rows ? cellName(c, rr) : undefined;
      if (name === undefined) {
        const at = cellName(Math.min(c, 702), Math.min(rr, 9999)) ?? `column ${c}, row ${rr}`;
        return {
          lines, names,
          error: err('cell_out_of_range', { line: 0, col: 1, endCol: 1 }, { token: at, cols: size.cols, rows: size.rows }, { token: at, hint: `Use @sheet ${Math.max(size.cols, c)} ${Math.max(size.rows, rr)} to make the sheet larger.`, suggest: [`@sheet ${Math.min(702, Math.max(size.cols, c))} ${Math.min(9999, Math.max(size.rows, rr))}`], recovery: 'create_first', fingerprintKey: 'fill' }),
        };
      }
      const lit = literalOf(r[j]);
      if (!lit) {
        return { lines, names, error: err('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'Fill', why: `item ${i * r.length + j + 1} is not a number, text, Bool or point` }, { recovery: 'fix_line', fingerprintKey: 'fill_item' }) };
      }
      lines.push(...writeLines(figure, name, lit.text, lit.type));
      names.push(name);
    }
  }
  return { lines, names };
}

function runValues(call: ActionCall, action: string, col: number, row: number, rows: readonly (readonly unknown[])[]): ActionOutcome {
  const figure = call.figure;
  const plan = valueLines(figure, col, row, rows);
  if (plan.error) return failure(plan.error);
  const locked = lockedAmong(figure, plan.names, ACTION_ORIGIN.get(figure));
  if (locked.length > 0) return failure(lockedError(locked));
  const r = applyPlan(figure, plan.lines, action, 'filled');
  if (!r.ok) return failure(r.error);
  const first = plan.names[0];
  const last = plan.names[plan.names.length - 1];
  return outcome(action, { written: plan.names.length, range: first === undefined ? '' : first === last ? first : `${first}:${last}`, sample: sampleOf(plan.lines), undefined: [], lines: plan.lines });
}

const badArg = (command: string, why: string): ActionOutcome => failure(err('bad_argument', { line: 0, col: 1, endCol: 1 }, { command, why }, { recovery: 'fix_line', fingerprintKey: command }));

const FILL_COLUMN: CommandSpec = {
  name: 'FillColumn',
  kind: 'action',
  group: 'sheet',
  forms: [{
    params: [P('col', 'Number'), P('list', 'List')],
    returns: null,
    summary: 'puts the items into rows 1, 2, … of a column as free values',
    rule: () => ({
      run: (call: ActionCall) => {
        const c = arg(call, 0);
        const l = arg(call, 1);
        const items = listItems(l);
        if (!isNum(c) || !Number.isInteger(c) || c < 1) return badArg('FillColumn', 'the column must be a whole number from 1');
        if (!items) return badArg('FillColumn', 'the second argument must be a list');
        return runValues(call, 'FillColumn', c, 1, items.map((x) => [x]));
      },
    }),
  }],
};

const FILL_ROW: CommandSpec = {
  name: 'FillRow',
  kind: 'action',
  group: 'sheet',
  forms: [{
    params: [P('row', 'Number'), P('list', 'List')],
    returns: null,
    summary: 'puts the items into columns A, B, … of a row as free values',
    rule: () => ({
      run: (call: ActionCall) => {
        const r = arg(call, 0);
        const l = arg(call, 1);
        const items = listItems(l);
        if (!isNum(r) || !Number.isInteger(r) || r < 1) return badArg('FillRow', 'the row must be a whole number from 1');
        if (!items) return badArg('FillRow', 'the second argument must be a list');
        return runValues(call, 'FillRow', 1, r, [items]);
      },
    }),
  }],
};

const FILL_CELLS: CommandSpec = {
  name: 'FillCells',
  kind: 'action',
  group: 'sheet',
  forms: [
    {
      params: [P('topLeft', 'CellAddr'), P('data', 'List')],
      returns: null,
      summary: 'a list goes down a column; a list of lists fills rows',
      rule: () => ({
        run: (call: ActionCall) => {
          const at = call.values[0] as CellRef | undefined;
          const items = listItems(arg(call, 1));
          if (!at || !items) return badArg('FillCells', 'it needs a cell and a list');
          const nested = items.length > 0 && items.every((x) => listItems(x) !== undefined);
          return runValues(call, 'FillCells', at.col, at.row, nested ? items.map((x) => listItems(x) as unknown[]) : items.map((x) => [x]));
        },
      }),
    },
    {
      params: [P('topLeft', 'CellAddr'), P('data', 'Matrix')],
      returns: null,
      summary: 'a matrix fills a rectangle',
      rule: () => ({
        run: (call: ActionCall) => {
          const at = call.values[0] as CellRef | undefined;
          const m = arg(call, 1) as { rows: number; cols: number; data: Float64Array } | undefined;
          if (!at || !m || !(m.data instanceof Float64Array)) return badArg('FillCells', 'it needs a cell and a matrix');
          const rows: number[][] = [];
          for (let i = 0; i < m.rows; i++) rows.push(Array.from(m.data.subarray(i * m.cols, (i + 1) * m.cols)));
          return runValues(call, 'FillCells', at.col, at.row, rows);
        },
      }),
    },
  ],
};

/* ------------------------------ fill with series: planFill ------------------------------ */

export type FillDirection = 'down' | 'right' | 'up' | 'left';

export interface FillPlan {
  readonly direction: FillDirection;
  readonly source: CellRect;
  readonly target: CellRect;
  /** Generated lines, in dependency order. */
  readonly lines: readonly string[];
  /** Cells written. */
  readonly cells: readonly string[];
  /** Cells whose copied reference left the sheet: they are written `undefined` with reason `off_sheet`. */
  readonly offSheet: readonly string[];
  readonly warnings: readonly Notice[];
}

/** One cell of the source as the fill sees it: a free number, a text, a free value of another kind, or a definition. */
type Src =
  | { k: 'empty' }
  | { k: 'num'; v: number }
  | { k: 'text'; v: string }
  | { k: 'value'; text: string; type: string }
  | { k: 'def'; name: string; line: string; type: string };

function sourceCell(figure: Figure, name: string): Src {
  const o = figure.get(name);
  if (!o) return { k: 'empty' };
  if (o.free) {
    const v = o.cell.defined ? o.cell.value : undefined;
    if (typeof v === 'number') return { k: 'num', v };
    if (typeof v === 'string') return { k: 'text', v };
    const lit = literalOf(v);
    if (lit) return { k: 'value', text: lit.text, type: lit.type };
  }
  return { k: 'def', name, line: o.definition, type: o.type };
}

const TEXT_NUM = /^(.*?)(-?\d+)$/;

/**
 * The plan of a fill from `source` into `target` (design 3.9), per lane (each column when filling down or up, each row when
 * filling right or left): two or more free numbers with a common step continue the series (`first + step * index`, no
 * drift); texts ending in a whole number with the same prefix count on; one cell is copied with its references shifted;
 * anything else repeats the source block. Up and left run the same rules backwards.
 */
export function planFill(figure: Figure, source: CellRect, target: CellRect, direction: FillDirection): FillPlan {
  const vertical = direction === 'down' || direction === 'up';
  const size = bounds(figure);
  const lines: string[] = [];
  const cells: string[] = [];
  const offSheet: string[] = [];
  const warnings: Notice[] = [];
  const skipped: { cell: string; empty: string }[] = [];
  const written = new Set<string>();
  const lanes = vertical ? [source.c0, source.c1] : [source.r0, source.r1];
  const along0 = vertical ? source.r0 : source.c0;
  const n = vertical ? source.r1 - source.r0 + 1 : source.c1 - source.c0 + 1;
  const t0 = vertical ? target.r0 : target.c0;
  const t1 = vertical ? target.r1 : target.c1;
  const addr = (lane: number, along: number): string | undefined => (vertical ? cellName(lane, along) : cellName(along, lane));
  // targets nearest the source first, so a copied formula reads cells already written
  const order: number[] = [];
  for (let a = t0; a <= t1; a++) order.push(a);
  if (direction === 'up' || direction === 'left') order.reverse();
  for (let lane = lanes[0] as number; lane <= (lanes[1] as number); lane++) {
    const src: Src[] = [];
    for (let i = 0; i < n; i++) src.push(sourceCell(figure, addr(lane, along0 + i) as string));
    const nums = src.every((s) => s.k === 'num') && n >= 2 ? (src as { v: number }[]).map((s) => s.v) : undefined;
    let step: number | undefined;
    if (nums) {
      const d = (nums[1] as number) - (nums[0] as number);
      const tol = 1e-9 * Math.max(1, ...nums.map(Math.abs));
      if (nums.every((v, i) => Math.abs(v - ((nums[0] as number) + d * i)) <= tol)) step = d;
    }
    const texts = src.every((s) => s.k === 'text') ? (src as { v: string }[]).map((s) => TEXT_NUM.exec(s.v)) : undefined;
    let textStep: { prefix: string; first: number; step: number; width: number } | undefined;
    if (texts && texts.every((m) => m !== null) && texts.every((m) => (m as RegExpExecArray)[1] === (texts[0] as RegExpExecArray)[1])) {
      const ks = texts.map((m) => Number((m as RegExpExecArray)[2]));
      const d = ks.length >= 2 ? (ks[1] as number) - (ks[0] as number) : 1;
      if (ks.every((k, i) => k === (ks[0] as number) + d * i)) textStep = { prefix: (texts[0] as RegExpExecArray)[1] as string, first: ks[0] as number, step: d, width: ((texts[0] as RegExpExecArray)[2] as string).length };
    }
    for (const a of order) {
      const name = addr(lane, a);
      if (name === undefined) continue;
      const i = a - along0;
      if (i >= 0 && i < n) continue; // a target cell inside the source stays
      written.add(name);
      if (nums && step !== undefined) {
        const v = (nums[0] as number) + step * i;
        const intLike = nums.every(Number.isInteger) && Number.isInteger(step);
        lines.push(...writeLines(figure, name, numberSource(intLike ? Math.round(v) : v), 'Number'));
        cells.push(name);
        continue;
      }
      if (textStep) {
        const k = textStep.first + textStep.step * i;
        const digits = String(Math.abs(k)).padStart(textStep.width - (k < 0 ? 1 : 0), '0');
        lines.push(...writeLines(figure, name, textSource(`${textStep.prefix}${k < 0 ? '-' : ''}${digits}`), 'Text'));
        cells.push(name);
        continue;
      }
      const j = ((i % n) + n) % n;
      const s = src[j] as Src;
      if (s.k === 'empty') continue;
      if (s.k === 'num') lines.push(...writeLines(figure, name, numberSource(s.v), 'Number'));
      else if (s.k === 'text') lines.push(...writeLines(figure, name, textSource(s.v), 'Text'));
      else if (s.k === 'value') lines.push(...writeLines(figure, name, s.text, s.type));
      else {
        const moved = shiftLine(s.line, s.name, name, size);
        const empty = moved.ok ? emptyRead(figure, moved.line, name, written) : undefined;
        if (empty !== undefined) {
          skipped.push({ cell: name, empty });
          continue;
        }
        // a function cell keeps its parameters: `B1(x, y) = …`
        if (moved.ok && moved.line.startsWith(`${name}(`)) lines.push(...(figure.get(name) && figure.get(name)?.type !== s.type ? [`Delete(${name})`] : []), moved.line);
        else if (moved.ok) lines.push(...writeLines(figure, name, moved.line.slice(moved.line.indexOf('=') + 1).trim(), s.type));
        else if (moved.reason === 'off_sheet') {
          lines.push(...writeLines(figure, name, 'OffSheet()', 'Number'));
          offSheet.push(name);
        } else continue;
      }
      cells.push(name);
      written.add(name);
    }
  }
  if (skipped.length > 0) {
    const first = skipped[0] as { cell: string; empty: string };
    warnings.push(makeNotice('fill_skipped', { count: skipped.length, first: first.cell, empty: first.empty }));
  }
  if (offSheet.length > 0) warnings.push(makeNotice('off_sheet_cells', { count: offSheet.length, names: offSheet.slice(0, 5).join(', ') }));
  return { direction, source, target, lines, cells, offSheet, warnings };
}

/**
 * The first cell a copied line reads by name that is empty, neither filled nor written earlier by the same fill (`C10 =
 * A10 - 2` past the end of the data): such a target is left as it is, with a notice, since an object cannot read a cell
 * that does not exist.
 */
function emptyRead(figure: Figure, line: string, self: string, written: ReadonlySet<string>): string | undefined {
  const pr = parseLine(line, {});
  if (!pr.ok) return undefined;
  const node = pr.value.node;
  let found: string | undefined;
  const walk = (e: unknown): void => {
    if (found !== undefined || !e || typeof e !== 'object') return;
    if (Array.isArray(e)) {
      for (const x of e) walk(x);
      return;
    }
    const o = e as Expr;
    if ((o as { k?: string }).k === 'cells') return;
    if (o.k === 'name' && o.name !== self && parseCellName(o.name) && !written.has(o.name) && figure.get(o.name) === undefined) found = o.name;
    for (const v of Object.values(o as object)) if (v && typeof v === 'object') walk(v);
  };
  walk('expr' in node ? node.expr : undefined);
  return found;
}

/**
 * The fill handle and `Ctrl+D` of the grid (ui 5): plans the fill and applies it as one batch, with the locks of the writer.
 * The plan is returned either way, so a host can show what was written or why nothing was.
 */
export function applyFill(figure: Figure, source: CellRect, target: CellRect, direction: FillDirection, origin: 'host' | 'learner' | 'model' = 'learner'): { ok: true; plan: FillPlan } | { ok: false; plan: FillPlan; error: ErrorObject } {
  const plan = planFill(figure, source, target, direction);
  const locked = lockedAmong(figure, plan.cells, origin);
  if (locked.length > 0) return { ok: false, plan, error: lockedError(locked) };
  ACTION_ORIGIN.set(figure, origin);
  const r = applyPlan(figure, plan.lines, `Fill ${rectText(target)}`, 'filled');
  return r.ok ? { ok: true, plan } : { ok: false, plan, error: r.error };
}

function rangeArg(call: ActionCall): CellRect | undefined {
  const v = call.values[0];
  return isRangeValue(v) ? v.rect : undefined;
}

function runFill(call: ActionCall, action: 'FillDown' | 'FillRight'): ActionOutcome {
  const rect = rangeArg(call);
  if (!rect) return badArg(action, 'it needs a range, such as B2:B9');
  const down = action === 'FillDown';
  if ((down ? rect.r1 - rect.r0 : rect.c1 - rect.c0) < 1) return { summary: `${action}: nothing to fill in ${rectText(rect)}`, data: { action, written: 0, range: rectText(rect), sample: [], undefined: [] } };
  const source: CellRect = down ? { ...rect, r1: rect.r0 } : { ...rect, c1: rect.c0 };
  const target: CellRect = down ? { ...rect, r0: rect.r0 + 1 } : { ...rect, c0: rect.c0 + 1 };
  const plan = planFill(call.figure, source, target, down ? 'down' : 'right');
  const locked = lockedAmong(call.figure, plan.cells, ACTION_ORIGIN.get(call.figure));
  if (locked.length > 0) return failure(lockedError(locked));
  const r = applyPlan(call.figure, plan.lines, action, 'filled');
  if (!r.ok) return failure(r.error);
  return outcome(action, { written: plan.cells.length, range: rectText(target), sample: sampleOf(plan.lines), undefined: plan.offSheet, lines: plan.lines }, plan.warnings);
}

const fillAction = (name: 'FillDown' | 'FillRight', summary: string): CommandSpec => ({
  name,
  kind: 'action',
  group: 'sheet',
  forms: [{ params: [P('range', 'Range')], returns: null, summary, rule: () => ({ run: (call: ActionCall) => runFill(call, name) }) }],
});

/* ------------------------------ ClearCells ------------------------------ */

/** True when the definition reads `cell` by name, not only inside a range. */
function readsDirectly(definition: string, cell: string): boolean {
  const pr = parseLine(definition, {});
  if (!pr.ok) return true;
  const node = pr.value.node;
  let found = false;
  const walk = (e: unknown): void => {
    if (found || !e || typeof e !== 'object') return;
    if (Array.isArray(e)) {
      for (const x of e) walk(x);
      return;
    }
    const o = e as Expr;
    if ((o as { k?: string }).k === 'cells') return;
    if (o.k === 'name' && o.name === cell) found = true;
    for (const v of Object.values(o as object)) if (v && typeof v === 'object') walk(v);
  };
  walk('expr' in node ? node.expr : undefined);
  return found;
}

/**
 * The lines of a clear (design 3.8): objects that read the cells only through a range are checked again without them, so
 * they stay; a cell that another object reads by name becomes `undefined` (an empty cell), so that object stays too; every
 * other cell is deleted.
 */
export function planClear(figure: Figure, rect: CellRect): { rebind: string[]; lines: string[]; blanks: string[]; cells: string[]; deleted: string[]; kept: string[] } {
  // the later cells first: a cell that reads another goes before it, so no delete takes a cell the plan deletes later
  const cells = figure.objects().filter((o) => {
    const a = parseCellName(o.name);
    return a !== undefined && rectHas(rect, a.col, a.row);
  }).sort((a, b) => b.order - a.order);
  const names = new Set(cells.map((c) => c.name));
  const rebind = new Map<string, string>();
  const lines: string[] = [];
  const blanks: string[] = [];
  const deleted: string[] = [];
  const kept: string[] = [];
  for (const c of cells) {
    let direct = false;
    for (const id of figure.dependentsOf(c.id)) {
      const d = figure.get(id);
      if (!d || names.has(d.name) || !d.inputs.includes(c.id)) continue;
      if (readsDirectly(d.definition, c.name)) direct = true;
      else rebind.set(d.name, d.definition);
    }
    if (!direct) {
      lines.push(`Delete(${c.name})`);
      deleted.push(c.name);
    } else if (c.type === 'Number') {
      if (!(c.free && / = undefined$/.test(c.definition))) blanks.push(`${c.name} = undefined`);
    } else kept.push(c.name);
  }
  return { rebind: [...rebind.values()], lines, blanks, cells: cells.map((c) => c.name).filter((n) => !kept.includes(n)), deleted, kept };
}

const CLEAR_CELLS: CommandSpec = {
  name: 'ClearCells',
  kind: 'action',
  group: 'sheet',
  forms: [{
    params: [P('range', 'Range')],
    returns: null,
    summary: 'empties the cells; what reads them through a range stays',
    rule: () => ({
      run: (call: ActionCall) => {
        const rect = rangeArg(call);
        if (!rect) return badArg('ClearCells', 'it needs a range, such as A1:B4');
        const figure = call.figure;
        const plan = planClear(figure, rect);
        const locked = lockedAmong(figure, plan.cells, ACTION_ORIGIN.get(figure));
        if (locked.length > 0) return failure(lockedError(locked));
        // one batch: cells others read by name become empty first; the range readers are checked again while the cells
        // that go are out of their ranges; then those cells go
        for (const c of plan.deleted) EXCLUDED_CELLS.add(c);
        let r: ReturnType<typeof applyPlan>;
        try {
          r = applyPlan(figure, [...plan.blanks, ...plan.rebind, ...plan.lines], 'ClearCells', 'cleared', { rebind: true });
        } finally {
          EXCLUDED_CELLS.clear();
        }
        if (!r.ok) return failure(r.error);
        const notices = plan.kept.length > 0 ? [makeNotice('cells_kept', { names: plan.kept.slice(0, 5).join(', '), count: plan.kept.length })] : [];
        return outcome('ClearCells', { written: plan.cells.length, range: rectText(rect), sample: [], undefined: [], lines: [...plan.blanks, ...plan.rebind, ...plan.lines] }, notices);
      },
    }),
  }],
};

/* ------------------------------ OffSheet ------------------------------ */

/** What a fill writes where a copied reference left the sheet: an undefined value with the reason `off_sheet`. */
const OFF_SHEET: CommandSpec = {
  name: 'OffSheet',
  kind: 'object',
  group: 'sheet',
  forms: [{ params: [], returns: 'Number', summary: 'undefined: a copied reference would point outside the sheet', rule: () => ({ run: (call: RuleCall) => call.fail('off_sheet', 'a copied reference points outside the sheet') }) }],
};

let registered = false;

export function registerSheetActions(): void {
  if (registered) return;
  registered = true;
  registerNotice('off_sheet_cells', { code: 'H102', severity: 'warning', template: 'A copied reference left the sheet in {count} cells ({names}); they are undefined.' });
  registerNotice('fill_skipped', { code: 'H104', severity: 'warning', template: '{count} cells were left as they were, from {first}: {empty} is empty.' });
  registerNotice('text_number_mix', { code: 'H105', severity: 'warning', template: "{cell} looks like a number but is not one; it is stored as text." });
  registerNotice('cells_kept', { code: 'H103', severity: 'info', template: '{names} kept: other objects read them by name.' });
}

export function sheetActionSpecs(): CommandSpec[] {
  return [FILL_COLUMN, FILL_ROW, FILL_CELLS, fillAction('FillDown', 'copies the first row down the range, shifting references'), fillAction('FillRight', 'copies the first column across the range, shifting references'), CLEAR_CELLS, OFF_SHEET];
}
