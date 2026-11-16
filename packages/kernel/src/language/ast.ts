/**
 * The syntax tree (docs/features/language/design.md 3.4). Offsets `s`/`e` are normalised
 * positions; `ParsedLine.sm` converts them to line and column in the text the writer sent.
 */
import type { SourceMap } from './source';

export interface Pos {
  readonly s: number;
  readonly e: number;
}

export type CmpOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type BinOp = '+' | '-' | '*' | '/' | '^' | 'and' | 'or' | 'xor';

export interface StrExprPart {
  readonly expr: Expr;
  readonly fmt?: string;
  readonly s: number;
  readonly e: number;
}
export type StrNodePart = string | StrExprPart;

export interface Arg {
  readonly name?: string;
  readonly ns?: number;
  readonly ne?: number;
  readonly value: Expr;
}

interface Base extends Pos {
  /** True when the node was written inside its own round brackets. */
  readonly paren?: boolean;
}

export type Expr =
  | (Base & { readonly k: 'num'; readonly v: number; readonly text: string; readonly int: boolean })
  | (Base & { readonly k: 'str'; readonly parts: readonly StrNodePart[] })
  | (Base & { readonly k: 'bool'; readonly v: boolean })
  | (Base & { readonly k: 'undef' })
  /** `cabs`/`rabs`: a cell reference written with `$` before its column or row (`$A$1`), kept for copying (spreadsheet 3.4). */
  | (Base & { readonly k: 'name'; readonly name: string; readonly cabs?: boolean; readonly rabs?: boolean })
  /** `A1:C5`: a range of cells (spreadsheet design 3.3), only where a range or a list is accepted. */
  | (Base & { readonly k: 'cells'; readonly from: NameExpr; readonly to: NameExpr })
  | (Base & { readonly k: 'unary'; readonly op: '-' | '+' | 'not'; readonly arg: Expr })
  | (Base & { readonly k: 'bin'; readonly op: BinOp; readonly l: Expr; readonly r: Expr; readonly implicit?: boolean })
  | (Base & { readonly k: 'cmp'; readonly ops: readonly CmpOp[]; readonly opPos: readonly Pos[]; readonly operands: readonly Expr[] })
  | (Base & { readonly k: 'call'; readonly callee: string; readonly cs: number; readonly ce: number; readonly args: readonly Arg[]; readonly open: number; readonly close: number })
  | (Base & { readonly k: 'tick'; readonly callee: string; readonly cs: number; readonly ce: number; readonly ticks: number; readonly args: readonly Expr[] })
  | (Base & { readonly k: 'index'; readonly target: Expr; readonly index: Expr })
  | (Base & { readonly k: 'field'; readonly target: Expr; readonly field: string; readonly fs: number; readonly fe: number; readonly args?: readonly Expr[] })
  | (Base & { readonly k: 'fact'; readonly arg: Expr })
  | (Base & { readonly k: 'deg'; readonly arg: Expr })
  | (Base & { readonly k: 'tuple'; readonly items: readonly Expr[] })
  | (Base & { readonly k: 'polar'; readonly r: Expr; readonly a: Expr })
  | (Base & { readonly k: 'list'; readonly items: readonly Expr[] })
  | (Base & { readonly k: 'range'; readonly from: Expr; readonly to: Expr; readonly step?: Expr })
  | (Base & { readonly k: 'cond'; readonly args: readonly Expr[] });

export type ExprKind = Expr['k'];

export type NameExpr = Extract<Expr, { k: 'name' }>;

export interface NameRef extends Pos {
  readonly name: string;
}

export interface RangeClause extends Pos {
  readonly from: Expr;
  readonly to: Expr;
  readonly step?: Expr;
}

export interface StyleItem extends Pos {
  readonly key: string;
  readonly ks: number;
  readonly ke: number;
  readonly value: Expr;
}

export interface DirectiveWord extends Pos {
  readonly text: string;
  /** For a quoted text, its content. */
  readonly str?: string;
  readonly num?: number;
}

export type LineNode =
  | { readonly k: 'noop'; readonly comment?: string }
  | { readonly k: 'directive'; readonly name: string; readonly ns: number; readonly ne: number; readonly words: readonly DirectiveWord[] }
  | { readonly k: 'define'; readonly target: NameRef; readonly expr: Expr; readonly range?: RangeClause; readonly style?: readonly StyleItem[] }
  | { readonly k: 'defmany'; readonly targets: readonly NameRef[]; readonly expr: Expr }
  | { readonly k: 'function'; readonly target: NameRef; readonly params: readonly NameRef[]; readonly expr: Expr; readonly domain?: readonly RangeClause[]; readonly style?: readonly StyleItem[] }
  | { readonly k: 'rate'; readonly target: NameRef; readonly order: number; readonly expr: Expr }
  | { readonly k: 'restyle'; readonly target: NameRef; readonly style: readonly StyleItem[] }
  | { readonly k: 'rerange'; readonly target: NameRef; readonly range: RangeClause }
  | { readonly k: 'action'; readonly expr: Expr & { readonly k: 'call' } };

export type LineKind = LineNode['k'];

export interface ParsedLine {
  /** 1-based number of the first physical line. */
  readonly line: number;
  /** The text as sent (may span several physical lines while a bracket is open). */
  readonly source: string;
  readonly sm: SourceMap;
  readonly node: LineNode;
}
