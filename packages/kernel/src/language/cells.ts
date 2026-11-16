/**
 * Cell addresses of the spreadsheet (docs/features/spreadsheet/design.md 3.1): `A1` to `ZZ9999`, columns `A`..`Z` for 1..26
 * and `AA`..`ZZ` for 27..702, rows 1..9999. Pure helpers, shared by the lexer, the checker and the sheet area.
 */

export const MAX_SHEET_COLS = 702;
export const MAX_SHEET_ROWS = 9999;

/** 1-based, as users see them. */
export interface CellAddress {
  readonly col: number;
  readonly row: number;
}

/** A reference as written: the address and its absolute flags (`$A`, `$1`). */
export interface CellRef extends CellAddress {
  readonly colAbs: boolean;
  readonly rowAbs: boolean;
}

const CELL_RE = /^([A-Z]{1,2})([1-9]\d{0,3})$/;

/** The column number of `A`..`ZZ`, or `undefined`. */
export function columnNumber(letters: string): number | undefined {
  if (!/^[A-Z]{1,2}$/.test(letters)) return undefined;
  if (letters.length === 1) return letters.charCodeAt(0) - 64;
  return (letters.charCodeAt(0) - 64) * 26 + (letters.charCodeAt(1) - 64);
}

/** The letters of column 1..702, or `undefined`. */
export function columnLetters(col: number): string | undefined {
  if (!Number.isInteger(col) || col < 1 || col > MAX_SHEET_COLS) return undefined;
  if (col <= 26) return String.fromCharCode(64 + col);
  const a = Math.floor((col - 1) / 26);
  const b = col - a * 26;
  return String.fromCharCode(64 + a) + String.fromCharCode(64 + b);
}

/** The address of a cell name such as `B12`, or `undefined` when the name is not a cell. */
export function parseCellName(name: string): CellAddress | undefined {
  const hit = ADDRESS_CACHE.get(name);
  if (hit !== undefined) return hit === NOT_A_CELL ? undefined : hit;
  const a = readCellName(name);
  if (ADDRESS_CACHE.size > 50_000) ADDRESS_CACHE.clear();
  ADDRESS_CACHE.set(name, a ?? NOT_A_CELL);
  return a;
}

/** Names already read, with their address (or `NOT_A_CELL`): the sheet asks about the same names many times. */
const NOT_A_CELL: CellAddress = Object.freeze({ col: 0, row: 0 });
const ADDRESS_CACHE = new Map<string, CellAddress>();

function readCellName(name: string): CellAddress | undefined {
  const m = CELL_RE.exec(name);
  if (!m) return undefined;
  const col = columnNumber(m[1] as string);
  const row = Number(m[2]);
  if (col === undefined || row > MAX_SHEET_ROWS) return undefined;
  return { col, row };
}

export const isCellName = (name: string): boolean => parseCellName(name) !== undefined;

/** `B12` for column 2, row 12. */
export function cellName(col: number, row: number): string | undefined {
  const l = columnLetters(col);
  return l === undefined || !Number.isInteger(row) || row < 1 || row > MAX_SHEET_ROWS ? undefined : `${l}${row}`;
}

/** The text of a reference with its `$` flags. */
export function refText(r: CellRef): string {
  return `${r.colAbs ? '$' : ''}${columnLetters(r.col) ?? '?'}${r.rowAbs ? '$' : ''}${r.row}`;
}

/**
 * Why a written reference is not one (`$` alone, column `AAA`, row 0, row 10000), or `undefined` when it is fine. `raw` is
 * the text with its `$` signs.
 */
export function referenceProblem(raw: string): string | undefined {
  const m = /^\$?([A-Za-z]*)\$?(\d*)$/.exec(raw);
  if (!m) return 'a reference is letters then digits, such as $A$1';
  const letters = m[1] as string;
  const digits = m[2] as string;
  if (letters === '') return 'a $ must be followed by a column letter, such as $A1';
  if (digits === '') return `the column ${letters} needs a row number after it, such as ${letters.toUpperCase()}1`;
  if (letters !== letters.toUpperCase()) return `cell columns are capital letters: ${letters.toUpperCase()}`;
  if (letters.length > 2) return `the column ${letters} is past ZZ, the last column`;
  const row = Number(digits);
  if (row < 1 || /^0/.test(digits)) return 'rows start at 1';
  if (row > MAX_SHEET_ROWS) return `the row ${digits} is past ${MAX_SHEET_ROWS}, the last row`;
  return undefined;
}

/** A rectangle of cells, `from` at the top left. */
export interface CellRect {
  readonly c0: number;
  readonly r0: number;
  readonly c1: number;
  readonly r1: number;
}

export const rectCols = (r: CellRect): number => r.c1 - r.c0 + 1;
export const rectRows = (r: CellRect): number => r.r1 - r.r0 + 1;

/** The rectangle between two corners, in any order. */
export function rectOf(a: CellAddress, b: CellAddress): CellRect {
  return { c0: Math.min(a.col, b.col), r0: Math.min(a.row, b.row), c1: Math.max(a.col, b.col), r1: Math.max(a.row, b.row) };
}

export const rectHas = (r: CellRect, col: number, row: number): boolean => col >= r.c0 && col <= r.c1 && row >= r.r0 && row <= r.r1;

/** `A1:C5`. */
export function rectText(r: CellRect): string {
  return `${cellName(r.c0, r.r0) ?? '?'}:${cellName(r.c1, r.r1) ?? '?'}`;
}

/** The whole sheet as a rectangle (what `Cell(col, row)` reads). */
export const WHOLE_SHEET: CellRect = Object.freeze({ c0: 1, r0: 1, c1: MAX_SHEET_COLS, r1: MAX_SHEET_ROWS });

/**
 * The names of the cells inside a rectangle that `exists` says are defined, row by row. Asks name by name when the
 * rectangle is smaller than the list of names, else scans the names.
 */
export function cellsIn(rect: CellRect, exists: (name: string) => boolean, names: () => readonly string[]): { name: string; col: number; row: number }[] {
  const area = rectCols(rect) * rectRows(rect);
  const all = area > 4096 ? names() : undefined;
  const out: { name: string; col: number; row: number }[] = [];
  if (all === undefined || area <= all.length) {
    for (let row = rect.r0; row <= rect.r1; row++) {
      for (let col = rect.c0; col <= rect.c1; col++) {
        const n = cellName(col, row) as string;
        if (exists(n)) out.push({ name: n, col, row });
      }
    }
    return out;
  }
  for (const n of all) {
    const a = parseCellName(n);
    if (a && rectHas(rect, a.col, a.row)) out.push({ name: n, col: a.col, row: a.row });
  }
  out.sort((x, y) => x.row - y.row || x.col - y.col);
  return out;
}

/**
 * Cell names a range does not see while the sheet clears them (`ClearCells`), so the objects that read them through a
 * range can be checked again without them before they go. Set and emptied around one synchronous step.
 */
export const EXCLUDED_CELLS = new Set<string>();

/** The value of a range expression (design 3.2): its rectangle and the filled cells, row by row. Holes are absent. */
export interface RangeValue {
  readonly schema: 'Range';
  readonly rect: CellRect;
  readonly cells: readonly { readonly col: number; readonly row: number; readonly name: string; readonly value: unknown }[];
}

export function isRangeValue(v: unknown): v is RangeValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Range';
}
