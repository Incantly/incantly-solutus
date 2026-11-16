/**
 * The typed tree: names resolved to object ids and local slots, every node typed, operators
 * resolved to a variant. This is what `compile` turns into closures.
 */
import type { ObjId } from '../contracts/values';
import type { BoundArg, CommandForm, CommandSpec, FunctionForm, FunctionSpec } from './table';
import type { AreaOpImpl, OpVariant, Ty } from './types';
import type { CmpOp } from './ast';
import type { CellRect } from './cells';

interface B {
  readonly ty: Ty;
  readonly s: number;
  readonly e: number;
  /** `'angle'` for an angle-tagged Number. */
  readonly unit?: 'angle';
}

export type RelTree =
  | { readonly t: 'cmp'; readonly ops: readonly CmpOp[]; readonly operands: readonly TNode[] }
  | { readonly t: 'and' | 'or' | 'xor'; readonly l: RelTree; readonly r: RelTree }
  | { readonly t: 'not'; readonly a: RelTree };

export interface PolyNodes {
  readonly xx: TNode;
  readonly xy: TNode;
  readonly yy: TNode;
  readonly x: TNode;
  readonly y: TNode;
  readonly c: TNode;
}

export type TNode =
  | (B & { readonly n: 'num'; readonly v: number })
  | (B & { readonly n: 'bool'; readonly v: boolean })
  | (B & { readonly n: 'text'; readonly parts: readonly (string | { readonly e: TNode; readonly fmt?: string })[] })
  | (B & { readonly n: 'undef' })
  | (B & { readonly n: 'const'; readonly name: string; readonly value: unknown })
  | (B & { readonly n: 'clock'; readonly which: 't' | 'bt' | 'beat' })
  | (B & { readonly n: 'ref'; readonly id: ObjId; readonly name: string })
  | (B & { readonly n: 'local'; readonly slot: number; readonly name: string })
  /** An expression in `x` (or `x, y`) written where a command takes a function: `Limit(sin(x) / x, 0)`. */
  | (B & { readonly n: 'lambda'; readonly params: readonly { readonly name: string; readonly slot: number }[]; readonly body: TNode })
  | (B & { readonly n: 'unary'; readonly op: '-' | '+' | 'not'; readonly arg: TNode; readonly impl?: (a: unknown, env: unknown) => unknown })
  | (B & { readonly n: 'bin'; readonly op: string; readonly l: TNode; readonly r: TNode; readonly variant: OpVariant; readonly impl?: AreaOpImpl })
  /** `impls[i]`: an area's equality for the i-th comparison (`A == B` of matrices), when it has one. */
  | (B & { readonly n: 'cmp'; readonly ops: readonly CmpOp[]; readonly operands: readonly TNode[]; readonly impls?: readonly (AreaOpImpl | undefined)[] })
  | (B & { readonly n: 'fact'; readonly arg: TNode })
  | (B & { readonly n: 'callObj'; readonly id: ObjId; readonly name: string; readonly args: readonly TNode[] })
  | (B & { readonly n: 'builtin'; readonly spec: FunctionSpec; readonly form: FunctionForm; readonly args: readonly TNode[] })
  | (B & { readonly n: 'command'; readonly spec: CommandSpec; readonly form: CommandForm; readonly args: readonly TArg[]; readonly tuple?: readonly Ty[] })
  | (B & { readonly n: 'tick'; readonly id: ObjId; readonly name: string; readonly ticks: number; readonly arg: TNode })
  | (B & { readonly n: 'index'; readonly target: TNode; readonly index: TNode; readonly impl?: AreaOpImpl })
  | (B & { readonly n: 'field'; readonly target: TNode; readonly field: string; readonly args?: readonly TNode[] })
  | (B & { readonly n: 'point'; readonly x: TNode; readonly y: TNode })
  | (B & { readonly n: 'polar'; readonly r: TNode; readonly a: TNode })
  | (B & { readonly n: 'list'; readonly items: readonly TNode[] })
  | (B & { readonly n: 'range'; readonly from: TNode; readonly to: TNode; readonly step?: TNode })
  /**
   * A range of cells (spreadsheet design 3.3): the filled cells it covers, row by row, each a `ref` with its address.
   * `as` says what it evaluates to: a `RangeValue` for a `Range` parameter, a list (one row or column) or a list of rows.
   */
  | (B & { readonly n: 'cells'; readonly rect: CellRect; readonly items: readonly CellItem[]; readonly as: 'range' | 'list' | 'rows' })
  | (B & { readonly n: 'cond'; readonly arms: readonly { readonly c: TNode; readonly v: TNode }[]; readonly otherwise?: TNode })
  | (B & { readonly n: 'relation'; readonly tree: RelTree; readonly slotX: number; readonly slotY: number; readonly poly?: PolyNodes; readonly shape: RelationShape });

/** One filled cell of a range: a `ref` with its address. */
export type CellItem = TNode & { readonly n: 'ref'; readonly col: number; readonly row: number; readonly blank?: boolean };

export type RelationShape = 'line' | 'circle' | 'conic' | 'curve' | 'region';

/** One bound command argument, as the rule factory receives it (`BoundArg` with a typed tree). */
export interface TArg extends BoundArg {
  readonly expr?: TNode;
  /** Local slot of a binder. */
  readonly slot?: number;
  /** Local slots of a list of binders, in order. */
  readonly slots?: readonly number[];
  /** For a body argument with names of its own (`u`, `age` in `Particles`): each name's local slot. */
  readonly scopeSlots?: readonly { readonly name: string; readonly slot: number }[];
  /** Type of the argument (of the body, for a body argument). */
  readonly ty?: Ty;
}

export type TNodeKind = TNode['n'];
