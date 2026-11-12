/**
 * Renaming an object in the stored definitions that read it (kernel design section 14, `Rename`).
 * Definition texts are regenerated from trees: the typed tree says which names are objects (and where they start), and
 * the syntax tree is rebuilt with those names replaced, so a local variable with the same name is never touched.
 */
import type { Arg, Expr, LineNode, StyleItem } from '../language/ast';
import type { CheckedLine } from '../language/check';
import { children } from '../language/relation';
import type { TNode } from '../language/tnode';
import type { ObjId } from '../contracts/values';
import { SELF_ID } from '../language/table';

/** Start offsets of every reference to object `id` in a typed tree. */
export function refStarts(n: TNode | undefined, id: ObjId, out: Set<number> = new Set()): Set<number> {
  if (!n) return out;
  if ((n.n === 'ref' || n.n === 'callObj' || n.n === 'tick') && n.id === id) out.add(n.s);
  for (const c of children(n)) refStarts(c, id, out);
  return out;
}

/** Start offsets of every reference to `id` in everything a checked line reads from. */
export function lineRefStarts(line: CheckedLine, id: ObjId, alsoSelf = false): Set<number> {
  const out = new Set<number>();
  const ids = alsoSelf ? [id, SELF_ID] : [id];
  for (const i of ids) {
    refStarts(line.expr, i, out);
    if (line.range) {
      refStarts(line.range.from, i, out);
      refStarts(line.range.to, i, out);
      refStarts(line.range.step, i, out);
    }
    for (const s of line.style ?? []) if (!('word' in s.value)) refStarts(s.value, i, out);
    if (line.state) {
      refStarts(line.state.initial, i, out);
      refStarts(line.state.velocity, i, out);
    }
  }
  return out;
}

function mapArgs(args: readonly Arg[], f: (e: Expr) => Expr): Arg[] {
  return args.map((a) => ({ ...a, value: f(a.value) }));
}

/** The expression with every name at a start in `starts` (and called `from`) replaced by `to`. */
export function renameExpr(e: Expr, starts: ReadonlySet<number>, from: string, to: string): Expr {
  const r = (x: Expr): Expr => renameExpr(x, starts, from, to);
  switch (e.k) {
    case 'num':
    case 'bool':
    case 'undef':
      return e;
    case 'name':
      return e.name === from && starts.has(e.s) ? { ...e, name: to } : e;
    case 'str':
      return { ...e, parts: e.parts.map((p) => (typeof p === 'string' ? p : { ...p, expr: r(p.expr) })) };
    case 'unary':
      return { ...e, arg: r(e.arg) };
    case 'bin':
      return { ...e, l: r(e.l), r: r(e.r) };
    case 'cmp':
      return { ...e, operands: e.operands.map(r) };
    case 'call':
      return { ...e, callee: e.callee === from && starts.has(e.s) ? to : e.callee, args: mapArgs(e.args, r) };
    case 'tick':
      return { ...e, callee: e.callee === from && starts.has(e.s) ? to : e.callee, args: e.args.map(r) };
    case 'index':
      return { ...e, target: r(e.target), index: r(e.index) };
    case 'field':
      return { ...e, target: r(e.target), ...(e.args ? { args: e.args.map(r) } : {}) };
    case 'fact':
    case 'deg':
      return { ...e, arg: r(e.arg) };
    case 'tuple':
    case 'list':
      return { ...e, items: e.items.map(r) };
    case 'polar':
      return { ...e, r: r(e.r), a: r(e.a) };
    case 'range':
      return { ...e, from: r(e.from), to: r(e.to), ...(e.step ? { step: r(e.step) } : {}) };
    case 'cond':
      return { ...e, args: e.args.map(r) };
  }
}

export function renameStyleItem(it: StyleItem, starts: ReadonlySet<number>, from: string, to: string): StyleItem {
  return { ...it, value: renameExpr(it.value, starts, from, to) };
}

/**
 * The line with references to `from` replaced by `to`. `target` renames the line's own target too (when the line
 * defines the renamed object).
 */
export function renameNode(node: LineNode, starts: ReadonlySet<number>, from: string, to: string, target: boolean): LineNode {
  const r = (x: Expr): Expr => renameExpr(x, starts, from, to);
  const tn = <T extends { name: string }>(t: T): T => (target && t.name === from ? { ...t, name: to } : t);
  switch (node.k) {
    case 'noop':
    case 'directive':
      return node;
    case 'define':
      return {
        ...node,
        target: tn(node.target),
        expr: r(node.expr),
        ...(node.range ? { range: { ...node.range, from: r(node.range.from), to: r(node.range.to), ...(node.range.step ? { step: r(node.range.step) } : {}) } } : {}),
      };
    case 'defmany':
      return { ...node, targets: node.targets.map(tn), expr: r(node.expr) };
    case 'function':
      return { ...node, target: tn(node.target), expr: r(node.expr) };
    case 'rate':
      return { ...node, target: tn(node.target), expr: r(node.expr) };
    case 'restyle':
      return { ...node, target: tn(node.target), style: node.style.map((s) => renameStyleItem(s, starts, from, to)) };
    case 'rerange':
      return { ...node, target: tn(node.target), range: { ...node.range, from: r(node.range.from), to: r(node.range.to), ...(node.range.step ? { step: r(node.range.step) } : {}) } };
    case 'action': {
      const call = r(node.expr);
      return { ...node, expr: call as typeof node.expr };
    }
  }
}
