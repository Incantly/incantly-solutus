/**
 * Copy, cut, paste and import (spreadsheet design 3.11, 3.12; errors 3). Pure planning plus one batch to apply: text from
 * outside becomes free values; cells copied inside the figure keep their definitions with references shifted.
 */
import type { ErrorObject, Notice } from '../../contracts/errors';
import { err } from '../../errors/table';
import { makeNotice } from '../../errors/notices';
import type { Figure } from '../../graph/figure';
import { numberSource } from '../../graph/values';
import type { Expr } from '../../language/ast';
import { EXCLUDED_CELLS, cellName, parseCellName } from '../../language/cells';
import type { CellAddress, CellRect } from '../../language/cells';
import { parseLine } from '../../language/parser';
import { valueText } from '../../language/runtime';
import { ACTION_ORIGIN, applyPlan, literalOf, lockedAmong, lockedError, planClear } from './actions';
import { shiftLine } from './shift';

/** The limits of design 3.11 and 3.12. */
export const PASTE_LIMITS = Object.freeze({ cells: 50_000, fileBytes: 5 * 1024 * 1024 });

export type Separator = ',' | ';' | '\t';

/** A parsed field: a number, or a text (with a warning when it looked like a number). */
export type Field = { readonly k: 'num'; readonly v: number } | { readonly k: 'text'; readonly v: string; readonly looked?: boolean } | { readonly k: 'empty' };

/** Splits text into rows and fields. Quoted fields (`"a, b"`, `""` for a quote) are kept whole, line breaks included. */
export function splitDelimited(text: string, sep: Separator): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const t = text.replace(/^\uFEFF/, '');
  while (i < t.length) {
    const c = t[i] as string;
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      quoted = true;
      field = '';
      i++;
      continue;
    }
    if (c === sep) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' && t[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // a last empty line is not a row
  while (rows.length > 0 && (rows[rows.length - 1] as string[]).every((f) => f.trim() === '')) rows.pop();
  return rows;
}

/** The separator of pasted text: a tab when there is one, else a comma. */
export const pasteSeparator = (text: string): Separator => (text.includes('\t') ? '\t' : ',');

/** The separator of a file, from its first line: tab, then semicolon, then comma. */
export function detectSeparator(text: string): Separator {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  if (first.includes('\t')) return '\t';
  const semis = (first.match(/;/g) ?? []).length;
  const commas = (first.match(/,/g) ?? []).length;
  return semis > 0 && semis >= commas ? ';' : ',';
}

/** One field: a number when the whole field is one (with the decimal separator given), else a text. */
export function parseField(raw: string, decimal: '.' | ','): Field {
  const s = raw.trim();
  if (s === '') return { k: 'empty' };
  const d = decimal === ',' ? ',' : '\\.';
  const re = new RegExp(`^[+-]?(\\d+(${d}\\d*)?|${d}\\d+)([eE][+-]?\\d+)?$`);
  if (re.test(s)) {
    const v = Number(decimal === ',' ? s.replace(',', '.') : s);
    if (Number.isFinite(v)) return { k: 'num', v };
  }
  // `1,2,3` or `1.2.3` look like numbers and are not: kept as text, with a warning
  const looked = /^[+-]?[\d.,\s]+$/.test(s) && /\d/.test(s) && /[.,]/.test(s);
  return looked ? { k: 'text', v: s, looked: true } : { k: 'text', v: s };
}

/* ------------------------------ planning ------------------------------ */

/** What a paste or an import writes. */
export interface PastePlan {
  readonly lines: readonly string[];
  readonly cells: readonly string[];
  readonly range: string;
  readonly header: boolean;
  readonly warnings: readonly Notice[];
}

export interface ImportOptions {
  readonly at: CellAddress;
  readonly separator?: Separator | 'auto';
  readonly decimal?: '.' | ',' | 'auto';
  /** `auto`: the first row is a header when it is all text and the second row has a number. */
  readonly header?: boolean | 'auto';
  /** Default false: an import over filled cells is `import_conflict`. */
  readonly replace?: boolean;
}

function textSource(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\n') + '"';
}

function sizeOf(figure: unknown): { cols: number; rows: number } {
  const w = (figure as { directive?: (n: string) => readonly string[] | undefined }).directive?.('sheet');
  const cols = Number(w?.[0]);
  const rows = Number(w?.[1]);
  return { cols: Number.isInteger(cols) && cols > 0 ? cols : 702, rows: Number.isInteger(rows) && rows > 0 ? rows : 9999 };
}

const at0 = { line: 0, col: 1, endCol: 1 };

/** Data that is not text: a NUL or many control characters near the start (errors 3). */
function binaryProblem(text: string): string | undefined {
  const head = text.slice(0, 512);
  const ctl = [...head].filter((c) => {
    const n = c.charCodeAt(0);
    return n < 32 && c !== '\t' && c !== '\n' && c !== '\r';
  }).length;
  if (head.includes('\u0000') || ctl > 8) {
    const shown = [...head.slice(0, 8)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    return `This is not text: the first bytes are ${shown}.`;
  }
  if (head.includes('\uFFFD')) return 'The text could not be read as UTF-8: it holds replacement characters.';
  return undefined;
}

/**
 * The plan of writing parsed rows from `at` (free values). Every field is a number or a text; empty fields are left
 * alone. Errors: a target past the sheet, more than 50,000 cells, filled targets without `replace`.
 */
function planRows(figure: Figure, rows: readonly (readonly string[])[], at: CellAddress, decimal: '.' | ',', header: boolean, replace: boolean): PastePlan | ErrorObject {
  const size = sizeOf(figure);
  const lines: string[] = [];
  const cells: string[] = [];
  const warnings: Notice[] = [];
  const conflicts: string[] = [];
  let count = 0;
  let maxC = at.col;
  let maxR = at.row;
  const looked: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as readonly string[];
    for (let j = 0; j < r.length; j++) {
      const f = header && i === 0 ? ({ k: (r[j] as string).trim() === '' ? 'empty' : 'text', v: (r[j] as string).trim() } as Field) : parseField(r[j] as string, decimal);
      if (f.k === 'empty') continue;
      const col = at.col + j;
      const row = at.row + i;
      maxC = Math.max(maxC, col);
      maxR = Math.max(maxR, row);
      if (++count > PASTE_LIMITS.cells) {
        return err('limit', at0, { limit: 'paste_cells', max: PASTE_LIMITS.cells, got: rows.reduce((n, x) => n + x.length, 0), what: 'cells in one paste' }, { recovery: 'rewrite', fingerprintKey: 'paste_cells' });
      }
      if (col > size.cols || row > size.rows) continue;
      const name = cellName(col, row) as string;
      if (f.k === 'text' && f.looked) looked.push(name);
      const lit = f.k === 'num' ? { text: numberSource(f.v), type: 'Number' } : { text: textSource(f.v), type: 'Text' };
      const old = figure.get(name);
      if (old && !replace) conflicts.push(name);
      if (old && old.type !== lit.type) lines.push(`Delete(${name})`);
      lines.push(`${name} = ${lit.text}`);
      cells.push(name);
    }
  }
  if (maxC > size.cols || maxR > size.rows) {
    const token = cellName(Math.min(maxC, 702), Math.min(maxR, 9999)) ?? '';
    const cols = Math.min(702, Math.max(size.cols, maxC));
    const rowsN = Math.min(9999, Math.max(size.rows, maxR));
    return err('cell_out_of_range', at0, { token, cols: size.cols, rows: size.rows }, { token, hint: `Use @sheet ${cols} ${rowsN} to make room for the data.`, suggest: [`@sheet ${cols} ${rowsN}`], recovery: 'create_first', fingerprintKey: 'paste' });
  }
  if (conflicts.length > 0) {
    const shown = conflicts.slice(0, 5).join(', ') + (conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : '');
    return err('import_conflict', at0, { why: `The cells ${shown} are already filled; nothing was imported.` }, { token: conflicts[0] as string, hint: 'Import somewhere empty, or replace the cells.', recovery: 'choose', fingerprintKey: 'conflict' });
  }
  for (const name of looked.slice(0, 20)) warnings.push(makeNotice('text_number_mix', { cell: name }));
  const first = cells[0];
  const last = cellName(maxC, maxR);
  return { lines, cells, range: first === undefined ? '' : `${cellName(at.col, at.row) as string}:${last as string}`, header, warnings };
}

/** Pasted text from outside (design 3.11): rows by newline, columns by tab (or comma), numbers by the decimal setting. */
export function planPaste(figure: Figure, text: string, at: CellAddress, opts: { decimal?: '.' | ',' } = {}): PastePlan | ErrorObject {
  const bad = binaryProblem(text);
  if (bad) return err('import_format', at0, { why: bad }, { recovery: 'report', fingerprintKey: 'paste' });
  const sep = pasteSeparator(text);
  return planRows(figure, splitDelimited(text, sep), at, opts.decimal ?? '.', false, true);
}

/** A `.csv`, `.txt` or `.dat` file (design 3.12). */
export function planImport(figure: Figure, text: string, opts: ImportOptions): PastePlan | ErrorObject {
  if (typeof text !== 'string') return err('import_format', at0, { why: 'The file is not text.' }, { recovery: 'report', fingerprintKey: 'import' });
  if (text.length > PASTE_LIMITS.fileBytes) {
    return err('limit', at0, { limit: 'file_size', max: PASTE_LIMITS.fileBytes, got: text.length, what: 'bytes in a data file' }, { recovery: 'rewrite', fingerprintKey: 'import_size' });
  }
  const bad = binaryProblem(text);
  if (bad) return err('import_format', at0, { why: bad }, { recovery: 'report', fingerprintKey: 'import' });
  const sep = opts.separator === undefined || opts.separator === 'auto' ? detectSeparator(text) : opts.separator;
  const decimal = opts.decimal === undefined || opts.decimal === 'auto' ? (sep === ';' ? ',' : '.') : opts.decimal;
  const rows = splitDelimited(text, sep);
  let header = opts.header === true;
  if (opts.header === undefined || opts.header === 'auto') {
    const r0 = rows[0] ?? [];
    const r1 = rows[1] ?? [];
    header = r0.length > 0 && r0.every((f) => parseField(f, decimal).k === 'text') && r1.some((f) => parseField(f, decimal).k === 'num');
  }
  return planRows(figure, rows, opts.at, decimal, header, opts.replace === true);
}

/* ------------------------------ copy and paste inside the figure ------------------------------ */

/** What the internal clipboard holds (design 3.11): the source block. Its definitions are read when pasted. */
export interface CellClip {
  readonly rect: CellRect;
  readonly cut: boolean;
}

/** The system clipboard text of a block: tab-separated values, one line per row. */
export function copyText(figure: Figure, rect: CellRect): string {
  const out: string[] = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    const row: string[] = [];
    for (let c = rect.c0; c <= rect.c1; c++) {
      const o = figure.get(cellName(c, r) as string);
      const v = o?.cell.defined ? o.cell.value : undefined;
      row.push(o === undefined || v === undefined ? '' : typeof v === 'string' ? v : valueText(v));
    }
    out.push(row.join('\t'));
  }
  return out.join('\n');
}

/** True when a definition reads by name a cell that is empty and not in `written`. */
function readsEmpty(figure: Figure, line: string, self: string, written: ReadonlySet<string>): string | undefined {
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

export interface PasteCellsOptions {
  /** `values`: paste values only; `all` (default): definitions with shifted references. */
  readonly mode?: 'all' | 'values';
  readonly transpose?: boolean;
}

/**
 * Pasting a copied block at `at`: each cell's definition with references moved by the offset (a free value as it is);
 * `values` writes the values only; `transpose` swaps rows and columns. A reference leaving the sheet writes `OffSheet()`;
 * a copy that would read an empty cell is left out with a notice.
 */
export function planPasteCells(figure: Figure, rect: CellRect, at: CellAddress, opts: PasteCellsOptions = {}): PastePlan | ErrorObject {
  const size = sizeOf(figure);
  const lines: string[] = [];
  const cells: string[] = [];
  const warnings: Notice[] = [];
  const written = new Set<string>();
  const skipped: string[] = [];
  let maxC = at.col;
  let maxR = at.row;
  for (let r = rect.r0; r <= rect.r1; r++) {
    for (let c = rect.c0; c <= rect.c1; c++) {
      const from = cellName(c, r) as string;
      const o = figure.get(from);
      if (!o) continue;
      const dc = opts.transpose ? r - rect.r0 : c - rect.c0;
      const dr = opts.transpose ? c - rect.c0 : r - rect.r0;
      const col = at.col + dc;
      const row = at.row + dr;
      maxC = Math.max(maxC, col);
      maxR = Math.max(maxR, row);
      if (col > size.cols || row > size.rows) continue;
      const to = cellName(col, row) as string;
      const old = figure.get(to);
      const value = o.cell.defined ? o.cell.value : undefined;
      const lit = o.free || opts.mode === 'values' || opts.transpose ? literalOf(value) : undefined;
      if (lit) {
        if (old && old.type !== lit.type) lines.push(`Delete(${to})`);
        lines.push(`${to} = ${lit.text}`);
      } else if (opts.mode === 'values' || opts.transpose) {
        continue;
      } else {
        const moved = shiftLine(o.definition, from, to, size);
        if (!moved.ok && moved.reason === 'off_sheet') {
          if (old && old.type !== 'Number') lines.push(`Delete(${to})`);
          lines.push(`${to} = OffSheet()`);
        } else if (!moved.ok) continue;
        else {
          const empty = readsEmpty(figure, moved.line, to, written);
          if (empty !== undefined) {
            skipped.push(to);
            continue;
          }
          if (old && old.type !== o.type) lines.push(`Delete(${to})`);
          lines.push(moved.line);
        }
      }
      cells.push(to);
      written.add(to);
    }
  }
  if (maxC > size.cols || maxR > size.rows) {
    const token = cellName(Math.min(maxC, 702), Math.min(maxR, 9999)) ?? '';
    return err('cell_out_of_range', at0, { token, cols: size.cols, rows: size.rows }, { token, hint: `Use @sheet ${Math.min(702, Math.max(size.cols, maxC))} ${Math.min(9999, Math.max(size.rows, maxR))} to make room.`, recovery: 'create_first', fingerprintKey: 'paste' });
  }
  if (skipped.length > 0) warnings.push(makeNotice('fill_skipped', { count: skipped.length, first: skipped[0] as string, empty: 'a cell it reads' }));
  return { lines, cells, range: `${cellName(at.col, at.row) as string}:${cellName(maxC, maxR) as string}`, header: false, warnings };
}

/* ------------------------------ applying ------------------------------ */

export type PasteResult = { readonly ok: true; readonly plan: PastePlan } | { readonly ok: false; readonly error: ErrorObject };

type Origin = 'host' | 'learner' | 'model';

function run(figure: Figure, plan: PastePlan | ErrorObject, group: string, origin: Origin, extra: { lines: string[]; excluded: string[] } = { lines: [], excluded: [] }): PasteResult {
  if ('ok' in plan) return { ok: false, error: plan };
  const locked = lockedAmong(figure, plan.cells, origin);
  if (locked.length > 0) return { ok: false, error: lockedError(locked) };
  ACTION_ORIGIN.set(figure, origin);
  for (const c of extra.excluded) EXCLUDED_CELLS.add(c);
  try {
    const r = applyPlan(figure, [...plan.lines, ...extra.lines], group, 'pasted', extra.lines.length > 0 ? { rebind: true } : {});
    return r.ok ? { ok: true, plan } : { ok: false, error: r.error };
  } finally {
    EXCLUDED_CELLS.clear();
  }
}

/** Pastes outside text at `at` as one batch: all or nothing, one undo step. */
export function applyPaste(figure: Figure, text: string, at: CellAddress, opts: { decimal?: '.' | ','; origin?: Origin } = {}): PasteResult {
  return run(figure, planPaste(figure, text, at, opts), `Paste at ${cellName(at.col, at.row) ?? ''}`, opts.origin ?? 'learner');
}

/** Imports a data file as one batch. */
export function applyImport(figure: Figure, text: string, opts: ImportOptions & { origin?: Origin }): PasteResult {
  return run(figure, planImport(figure, text, opts), 'Import', opts.origin ?? 'learner');
}

/**
 * Pastes a copied block (or a cut one: the source is cleared in the same batch, and what read the cut cells by name keeps
 * reading the now empty cells, design 3.11). One undo step.
 */
export function applyPasteCells(figure: Figure, clip: CellClip, at: CellAddress, opts: PasteCellsOptions & { origin?: Origin } = {}): PasteResult {
  const plan = planPasteCells(figure, clip.rect, at, opts);
  if (!clip.cut || 'ok' in plan) return run(figure, plan, `Paste at ${cellName(at.col, at.row) ?? ''}`, opts.origin ?? 'learner');
  const target = new Set(plan.cells);
  const clear = planClear(figure, clip.rect);
  const keep = (l: string): boolean => {
    const m = /^(?:Delete\()?([A-Z]{1,2}\d+)/.exec(l);
    return m === null || !target.has(m[1] as string);
  };
  const lines = [...clear.blanks.filter(keep), ...clear.rebind.filter(keep), ...clear.lines.filter(keep)];
  const locked = lockedAmong(figure, clear.cells, opts.origin ?? 'learner');
  if (locked.length > 0) return { ok: false, error: lockedError(locked) };
  return run(figure, plan, `Cut to ${cellName(at.col, at.row) ?? ''}`, opts.origin ?? 'learner', { lines, excluded: clear.deleted.filter((c) => !target.has(c)) });
}

