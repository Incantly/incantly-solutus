/**
 * The typed tree: names resolved to object ids and local slots, every node typed, operators
 * resolved to a variant. This is what `compile` turns into closures.
 */
import type { ObjId } from '../contracts/values';
import type { BoundArg, CommandForm, CommandSpec, FunctionForm, FunctionSpec } from './table';
import type { OpVariant, Ty } from './types';
import type { CmpOp } from './ast';

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
  | (B & { readonly n: 'unary'; readonly op: '-' | '+' | 'not'; readonly arg: TNode })
  | (B & { readonly n: 'bin'; readonly op: string; readonly l: TNode; readonly r: TNode; readonly variant: OpVariant })
  | (B & { readonly n: 'cmp'; readonly ops: readonly CmpOp[]; readonly operands: readonly TNode[] })
  | (B & { readonly n: 'fact'; readonly arg: TNode })
  | (B & { readonly n: 'callObj'; readonly id: ObjId; readonly name: string; readonly args: readonly TNode[] })
  | (B & { readonly n: 'builtin'; readonly spec: FunctionSpec; readonly form: FunctionForm; readonly args: readonly TNode[] })
  | (B & { readonly n: 'command'; readonly spec: CommandSpec; readonly form: CommandForm; readonly args: readonly TArg[]; readonly tuple?: readonly Ty[] })
  | (B & { readonly n: 'tick'; readonly id: ObjId; readonly name: string; readonly ticks: number; readonly arg: TNode })
  | (B & { readonly n: 'index'; readonly target: TNode; readonly index: TNode })
  | (B & { readonly n: 'field'; readonly target: TNode; readonly field: string })
  | (B & { readonly n: 'point'; readonly x: TNode; readonly y: TNode })
  | (B & { readonly n: 'polar'; readonly r: TNode; readonly a: TNode })
  | (B & { readonly n: 'list'; readonly items: readonly TNode[] })
  | (B & { readonly n: 'range'; readonly from: TNode; readonly to: TNode; readonly step?: TNode })
  | (B & { readonly n: 'cond'; readonly arms: readonly { readonly c: TNode; readonly v: TNode }[]; readonly otherwise?: TNode })
  | (B & { readonly n: 'relation'; readonly tree: RelTree; readonly slotX: number; readonly slotY: number; readonly poly?: PolyNodes; readonly shape: RelationShape });

export type RelationShape = 'line' | 'circle' | 'conic' | 'curve' | 'region';

/** One bound command argument, as the rule factory receives it (`BoundArg` with a typed tree). */
export interface TArg extends BoundArg {
  readonly expr?: TNode;
  /** Local slot of a binder. */
  readonly slot?: number;
  /** Type of the argument (of the body, for a body argument). */
  readonly ty?: Ty;
}

export type TNodeKind = TNode['n'];
